# ============================================================
# CLIP VISUAL SEARCH — replace the existing block in your app.py
# ============================================================
# What changed:
#   - /api/blueprint-search now accepts EITHER image upload OR 'q' text param
#   - Returns '_similarity' field (matches the semantic-search convention)
#   - Caches the preprocess transform so we don't reload the model each call
#   - Handles missing patent numbers gracefully (not everything in the
#     vectors dict will be in the patents DB)
#   - Adds /api/blueprint-search/status for the frontend to detect availability
# ============================================================

CLIP_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
CLIP_MODEL = None
CLIP_PREPROCESS = None
CLIP_VECTORS = None


def get_clip():
    """Lazy-load CLIP model + preprocess. Cached after first call."""
    global CLIP_MODEL, CLIP_PREPROCESS
    if CLIP_MODEL is None:
        print("Loading CLIP ViT-B/32...")
        CLIP_MODEL, CLIP_PREPROCESS = clip.load("ViT-B/32", device=CLIP_DEVICE)
        CLIP_MODEL.eval()
    return CLIP_MODEL, CLIP_PREPROCESS


def load_patent_vectors():
    global CLIP_VECTORS
    if CLIP_VECTORS is None:
        vector_file = os.path.join(BASE_DIR, 'patent_vectors.pkl')
        if os.path.exists(vector_file):
            with open(vector_file, 'rb') as f:
                CLIP_VECTORS = pickle.load(f)
            # Pre-stack vectors into a matrix for fast cosine similarity
            pn_list = list(CLIP_VECTORS['vectors'].keys())
            mat = np.array([CLIP_VECTORS['vectors'][p] for p in pn_list], dtype=np.float32)
            # Normalize rows (if not already)
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            norms[norms == 0] = 1
            mat = mat / norms
            CLIP_VECTORS['_pn_list'] = pn_list
            CLIP_VECTORS['_matrix'] = mat
            print(f"Loaded {len(pn_list)} patent vectors (dim={mat.shape[1]})")
        else:
            CLIP_VECTORS = {'vectors': {}, 'paths': [], '_pn_list': [], '_matrix': None}
    return CLIP_VECTORS


def _clip_encode_image(img):
    """PIL.Image -> 512-dim normalized CLIP vector (numpy)."""
    model, preprocess = get_clip()
    tensor = preprocess(img).unsqueeze(0).to(CLIP_DEVICE)
    with torch.no_grad():
        v = model.encode_image(tensor)
        v = v / v.norm(dim=-1, keepdim=True)
    return v.cpu().numpy().flatten().astype(np.float32)


def _clip_encode_text(text):
    """String -> 512-dim normalized CLIP vector (numpy)."""
    model, _ = get_clip()
    tokens = clip.tokenize([text], truncate=True).to(CLIP_DEVICE)
    with torch.no_grad():
        v = model.encode_text(tokens)
        v = v / v.norm(dim=-1, keepdim=True)
    return v.cpu().numpy().flatten().astype(np.float32)


def _visual_search_with_vector(query_vec, limit=20):
    """Run cosine similarity against the patent matrix, return ranked results."""
    data = load_patent_vectors()
    if data.get('_matrix') is None or len(data['_pn_list']) == 0:
        return [], 0

    mat = data['_matrix']
    pn_list = data['_pn_list']

    scores = mat @ query_vec  # cosine since both sides are L2-normalized
    top_idx = np.argsort(scores)[::-1][:limit]
    top = [(pn_list[i], float(scores[i])) for i in top_idx]

    score_map = {pn: s for pn, s in top}
    pn_vals = [pn for pn, _ in top]
    placeholders = ','.join('?' * len(pn_vals))

    with get_db() as con:
        rows = con.execute(
            f'SELECT * FROM patents WHERE patent_number IN ({placeholders})',
            pn_vals
        ).fetchall()

    # Build results in score order (and keep patents even if missing from DB)
    results = []
    row_map = {r['patent_number']: r for r in rows}
    for pn, raw in top:
        row = row_map.get(pn)
        if row is None:
            # Patent is in the vectors but not in the DB (edge case)
            d = {col: '' for col in PATENT_COLUMNS}
            d['patent_number'] = pn
        else:
            d = row_to_dict(row)
        # Map cosine [-1..1] -> 0..100 similarity score
        d['_similarity'] = round(max(0.0, raw) * 100, 1)
        results.append(d)

    return results, len(results)


@app.route('/api/blueprint-search', methods=['POST', 'GET'])
def blueprint_search():
    """
    Visual search. Accepts:
      POST multipart with 'image' file  -> image-to-image CLIP search
      POST or GET with 'q' parameter    -> text-to-image CLIP search
    """
    limit = min(int(request.args.get('limit', 20)), 50)

    try:
        # Branch 1: image upload
        if 'image' in request.files and request.files['image'].filename:
            f = request.files['image']
            img = Image.open(f.stream).convert('RGB')
            qvec = _clip_encode_image(img)
            mode = 'visual-image'
        else:
            # Branch 2: text-to-image (from form, json, or query string)
            q = (request.form.get('q')
                 or (request.get_json(silent=True) or {}).get('q')
                 or request.args.get('q', '')).strip()
            q = urllib.parse.unquote(q)
            if not q:
                return jsonify({'error': 'Provide either image upload or q= text'}), 400
            qvec = _clip_encode_text(q)
            mode = 'visual-text'

        results, total = _visual_search_with_vector(qvec, limit=limit)
        return jsonify({
            'results': results,
            'total': total,
            'mode': mode,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/blueprint-search/status')
def blueprint_search_status():
    """Frontend calls this to know if Visual search is available."""
    data = load_patent_vectors()
    n = len(data.get('_pn_list', []))
    return jsonify({
        'available': n > 0,
        'embedded': n,
    })
