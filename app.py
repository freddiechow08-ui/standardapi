"""
app.py - HK Patent Search with Semantic Search
"""

import torch
import clip
import pickle
from PIL import Image
import numpy as np
import csv
import logging
import os
import re
import sqlite3
import urllib.parse
import pickle
from contextlib import contextmanager
from typing import Any, Dict, List

import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', 'AIzaSyAV3w_Iad9HLCxtxxs3tZAiN-M0ubctdYY')
GEMINI_MODEL = 'gemini-2.5-flash'

app = Flask(__name__, static_folder='static')
CORS(app)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'patents_clean.db')
SEMANTIC_INDEX_FILE = os.path.join(BASE_DIR, 'semantic_index.pkl')

PATENT_COLUMNS = [
    'patent_number', 'publication_number', 'application_number',
    'title', 'title_cn', 'inventor', 'assignee', 'assignee_address',
    'assignee_country', 'agent', 'agent_address', 'abstract',
    'ipc', 'patent_type', 'status', 'language',
    'filing_date', 'grant_date', 'publication_date',
    'priority_date', 'priority_country', 'priority_app_number',
    'renewal_due_date', 'journal_date', 'image_path',
]

@contextmanager
def get_db():
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL;')
    try:
        yield con
    finally:
        con.close()

def row_to_dict(row) -> Dict[str, str]:
    keys = row.keys()
    return {col: (row[col] or '') for col in PATENT_COLUMNS if col in keys}

def _tokenize(query: str) -> List[str]:
    tokens = re.findall(r'"[^"]+"|NEAR/\d+|\S+', query, re.I)
    return [
        t.strip('"') for t in tokens
        if t.upper() not in {'AND', 'OR', 'NOT'}
        and not re.match(r'NEAR/\d+', t, re.I)
        and len(t.strip('"')) > 1
    ]

def search_patents(query: str, limit: int = 20):
    keywords = _tokenize(query)
    if not keywords:
        return [], 0
    kw0 = keywords[0]
    with get_db() as con:
        try:
            fts_query = ' AND '.join(f'"{kw}"' for kw in keywords)
            sql = """
            SELECT p.*,
                (
                    (LENGTH(p.title) - LENGTH(REPLACE(LOWER(p.title), LOWER(:kw), ''))) / MAX(LENGTH(:kw),1) * 3 +
                    (LENGTH(p.assignee) - LENGTH(REPLACE(LOWER(p.assignee), LOWER(:kw), ''))) / MAX(LENGTH(:kw),1) * 3 +
                    (LENGTH(p.inventor) - LENGTH(REPLACE(LOWER(p.inventor), LOWER(:kw), ''))) / MAX(LENGTH(:kw),1) +
                    (LENGTH(p.abstract) - LENGTH(REPLACE(LOWER(p.abstract), LOWER(:kw), ''))) / MAX(LENGTH(:kw),1)
                ) AS _score
            FROM patents_fts f
            JOIN patents p ON p.id = f.rowid
            WHERE patents_fts MATCH :fts_q
            ORDER BY _score DESC
            LIMIT 200
            """
            rows = con.execute(sql, {'fts_q': fts_query, 'kw': kw0}).fetchall()
        except sqlite3.OperationalError:
            conditions, params = [], []
            for kw in keywords:
                like = f'%{kw}%'
                conditions.append('(title LIKE ? OR inventor LIKE ? OR assignee LIKE ? OR abstract LIKE ?)')
                params.extend([like, like, like, like])
            rows = con.execute(
                f'SELECT * FROM patents WHERE {" AND ".join(conditions)} LIMIT 200', params
            ).fetchall()
        total = len(rows)
        results = [row_to_dict(r) for r in rows[:limit]]
    return results, total

def load_semantic_index():
    if not os.path.exists(SEMANTIC_INDEX_FILE):
        return None
    with open(SEMANTIC_INDEX_FILE, 'rb') as f:
        return pickle.load(f)

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/workspace')
def workspace_page():
    return send_from_directory('static', 'workspace.html')


@app.route('/whiteboard')
def whiteboard_page():
    return send_from_directory('static', 'whiteboard.html')

@app.route('/api/search')
def search():
    query = request.args.get('q', '').strip()
    query = urllib.parse.unquote(query)
    if not query:
        return jsonify({'results': [], 'total': 0, 'query': ''})
    results, total = search_patents(query)
    return jsonify({'results': results, 'total': total, 'query': query})

@app.route('/api/semantic-search')
def semantic_search():
    query = request.args.get('q', '').strip()
    query = urllib.parse.unquote(query)
    limit = min(int(request.args.get('limit', 20)), 50)
    
    if not query:
        return jsonify({'results': [], 'total': 0, 'query': query, 'mode': 'semantic'})
    
    if not HAS_NUMPY:
        return jsonify({'error': 'numpy not installed'}), 500
    
    idx = load_semantic_index()
    if idx is None:
        return jsonify({'error': 'Semantic index not built. Run python build_semantic.py'}), 422
    
    try:
        vec = idx['vectorizer']
        matrix = idx['matrix']
        pn_list = idx['pn_list']
        
        q_vec = vec.transform([query])
        scores = (matrix @ q_vec.T).toarray().flatten()
        
        top_idx = scores.argsort()[::-1]
        top_idx = [i for i in top_idx if scores[i] > 0][:limit * 2]
        
        if not top_idx:
            return jsonify({'results': [], 'total': 0, 'query': query, 'mode': 'semantic'})
        
        top_pns = [(pn_list[i], float(scores[i])) for i in top_idx[:limit]]
        score_map = {pn: s for pn, s in top_pns}
        
        pn_vals = [pn for pn, _ in top_pns]
        placeholders = ','.join('?' * len(pn_vals))
        
        with get_db() as con:
            rows = con.execute(
                f'SELECT * FROM patents WHERE patent_number IN ({placeholders})',
                pn_vals
            ).fetchall()
        
        results = []
        max_score = max(score_map.values()) or 1
        for row in rows:
            d = row_to_dict(row)
            raw = score_map.get(d['patent_number'], 0)
            d['_similarity'] = round((raw / max_score) * 100, 1)
            results.append(d)
        results.sort(key=lambda x: x['_similarity'], reverse=True)
        
        return jsonify({'results': results, 'total': len(results), 'query': query, 'mode': 'semantic'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/semantic-search/status')
def semantic_search_status():
    idx = load_semantic_index()
    with get_db() as con:
        total = con.execute('SELECT COUNT(*) FROM patents').fetchone()[0]
    if idx:
        n = len(idx.get('pn_list', []))
        return jsonify({'available': True, 'total_patents': total, 'embedded': n})
    return jsonify({'available': False, 'total_patents': total, 'embedded': 0})

@app.route('/api/patents/count')
def count():
    with get_db() as con:
        row = con.execute('SELECT COUNT(*) FROM patents').fetchone()
        n = row[0] if row else 0
    return jsonify({'count': n})

@app.route('/api/patent/<patent_number>')
def get_patent(patent_number: str):
    with get_db() as con:
        row = con.execute(
            'SELECT * FROM patents WHERE UPPER(patent_number) = ?',
            (patent_number.strip().upper(),)
        ).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(row_to_dict(row))

@app.route('/api/ai/generate', methods=['POST'])
def ai_generate():
    try:
        payload = request.get_json(silent=True) or {}
        messages = payload.get('messages', [])
        system = payload.get('system', '')
        max_tokens = min(payload.get('max', 1000), 4096)

        contents = []
        for m in messages:
            role = 'model' if m.get('role') == 'assistant' else 'user'
            text = m.get('content', '')
            contents.append({'role': role, 'parts': [{'text': str(text)}]})

        body = {
            'contents': contents,
            'generationConfig': {'maxOutputTokens': max_tokens},
        }
        if system:
            body['systemInstruction'] = {'parts': [{'text': system}]}

        url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
        resp = requests.post(url, headers={'content-type': 'application/json'}, json=body, timeout=60)
        data = resp.json()

        if not resp.ok:
            return jsonify({'error': str(data)}), resp.status_code

        text = ''
        for cand in data.get('candidates', []):
            parts = cand.get('content', {}).get('parts', [])
            for p in parts:
                if p.get('text'):
                    text += p['text']
            if text:
                break

        return jsonify({'text': text, 'model': GEMINI_MODEL})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

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


import json


def _gemini_call(system: str, user_text: str, max_tokens: int = 2048) -> dict:
    """Synchronous Gemini call returning parsed JSON where possible."""
    body = {
        'contents': [{'role': 'user', 'parts': [{'text': user_text}]}],
        'generationConfig': {
            'maxOutputTokens': max_tokens,
            'responseMimeType': 'application/json',
        },
        'systemInstruction': {'parts': [{'text': system}]},
    }
    url = (f'https://generativelanguage.googleapis.com/v1beta/models/'
           f'{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}')
    resp = requests.post(url, headers={'content-type': 'application/json'},
                         json=body, timeout=60)
    data = resp.json()
    text = ''
    for cand in data.get('candidates', []):
        for p in cand.get('content', {}).get('parts', []):
            if p.get('text'):
                text += p['text']
        if text:
            break
    try:
        return json.loads(text)
    except Exception:
        return {'_raw': text}


@app.route('/api/ai-search/analyze', methods=['POST'])
def ai_search_analyze():
    """
    Step 1: parse user's invention description into structured search terms.
    Input : { description: str }
    Output: { keywords, ipc_codes, technical_field, search_queries, rationale }
    """
    payload = request.get_json(silent=True) or {}
    desc = (payload.get('description') or '').strip()
    if not desc:
        return jsonify({'error': 'description required'}), 400

    system = (
        "You are a patent analysis assistant. Given an invention description, "
        "extract information useful for searching a Hong Kong patent database. "
        "Reply ONLY with JSON in this exact schema: "
        '{"technical_field": str, "keywords": [str, str, ...], '
        '"ipc_codes": [{"code": "A01B", "description": "..."}], '
        '"search_queries": [str, str, ...], "rationale": str} '
        "Keywords must be single words or short phrases. Include both "
        "specific technical terms AND broader synonyms. Search queries "
        "should be 2-4 words each, designed for a full-text search. "
        "Provide 3-6 queries that approach the invention from different angles. "
        "IPC codes are the international patent classification prefixes."
    )
    try:
        result = _gemini_call(system, desc, max_tokens=1500)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ai-search/judge', methods=['POST'])
def ai_search_judge():
    """
    Step 4: given the user's description and a list of candidate patents,
    have Gemini rate each patent's relevance and explain why.
    Input : { description, candidates: [{patent_number, title, abstract}, ...] }
    Output: { judgements: [{patent_number, relevance: 0-100, reason}, ...] }
    """
    payload = request.get_json(silent=True) or {}
    desc = (payload.get('description') or '').strip()
    candidates = payload.get('candidates') or []
    if not desc or not candidates:
        return jsonify({'error': 'description and candidates required'}), 400

    # Cap at 20 — more than that burns tokens without much added value
    candidates = candidates[:20]

    lines = []
    for i, c in enumerate(candidates, 1):
        pn = c.get('patent_number', '')
        title = (c.get('title') or '')[:150]
        abstract = (c.get('abstract') or '')[:400]
        lines.append(f"[{i}] {pn} — {title}\nAbstract: {abstract}")

    user_text = (
        f"USER'S INVENTION:\n{desc}\n\n"
        f"CANDIDATE PATENTS:\n" + "\n\n".join(lines)
    )

    system = (
        "You are a patent prior-art analyst. For each candidate patent, "
        "rate how closely it relates to the user's invention on a 0-100 scale "
        "(100 = essentially the same invention, 0 = unrelated). Give a "
        "concise one-sentence reason explaining the technical overlap. "
        "Respond ONLY with JSON in this schema: "
        '{"judgements": [{"patent_number": str, "relevance": int, '
        '"reason": str}, ...]} '
        "Include an entry for EVERY candidate in the same order. Be critical; "
        "most candidates should score below 60 unless truly similar."
    )
    try:
        result = _gemini_call(system, user_text, max_tokens=3000)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print('\n-- HK Patent Search --')
    print(f'   Database: {DB_FILE}')
    print('   Server: http://localhost:5000\n')
    app.run(host='0.0.0.0', port=5000, debug=False)