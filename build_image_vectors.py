"""
build_image_vectors.py

Run CLIP ViT-B/32 on every image in ./extracted_images/ and save
the vectors to ./patent_vectors.pkl in the format expected by
app.py's /api/blueprint-search endpoint:

    { 'vectors': { patent_number: np.ndarray(512,), ... },
      'paths':   [ 'extracted_images/HK1262848.jpg', ... ] }

USAGE:
    pip install torch torchvision ftfy regex tqdm git+https://github.com/openai/CLIP.git
    python build_image_vectors.py

    python build_image_vectors.py --batch 16        # bigger batches if you have a GPU
    python build_image_vectors.py --rebuild         # redo even if pkl exists
"""

import argparse
import pickle
import sys
from pathlib import Path

import clip
import numpy as np
import torch
from PIL import Image
from tqdm import tqdm

BASE_DIR     = Path(__file__).parent.resolve()
IMG_DIR      = BASE_DIR / "extracted_images"
VECTORS_FILE = BASE_DIR / "patent_vectors.pkl"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def load_model():
    print(f"[clip] Loading ViT-B/32 on {DEVICE}...")
    model, preprocess = clip.load("ViT-B/32", device=DEVICE)
    model.eval()
    return model, preprocess


def embed_batch(model, preprocess, paths):
    """Encode a list of image paths into CLIP vectors. Returns (paths_ok, vectors)."""
    tensors, kept_paths = [], []
    for p in paths:
        try:
            img = Image.open(p).convert("RGB")
            tensors.append(preprocess(img))
            kept_paths.append(p)
        except Exception as e:
            print(f"  skip {p.name}: {e}")
    if not tensors:
        return [], None

    batch = torch.stack(tensors).to(DEVICE)
    with torch.no_grad():
        feats = model.encode_image(batch)
        feats = feats / feats.norm(dim=-1, keepdim=True)  # L2-normalize
    return kept_paths, feats.cpu().numpy().astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch",   type=int, default=8,  help="batch size (default: 8)")
    ap.add_argument("--rebuild", action="store_true",  help="ignore existing .pkl and rebuild from scratch")
    args = ap.parse_args()

    if not IMG_DIR.exists():
        sys.exit(f"Image folder not found: {IMG_DIR}\nRun extract_images.py first.")

    images = sorted(IMG_DIR.glob("*.jpg")) + sorted(IMG_DIR.glob("*.png"))
    if not images:
        sys.exit(f"No images in {IMG_DIR}. Run extract_images.py first.")

    # Resume support: load existing vectors and skip those
    existing = {}
    if VECTORS_FILE.exists() and not args.rebuild:
        with open(VECTORS_FILE, "rb") as f:
            data = pickle.load(f)
        existing = data.get("vectors", {})
        print(f"[resume] Loaded {len(existing)} existing vectors")

    todo = [p for p in images if p.stem not in existing]
    print(f"[main] Images: {len(images)}  |  Already embedded: {len(existing)}  |  To do: {len(todo)}")
    if not todo:
        return

    model, preprocess = load_model()

    vectors = dict(existing)
    paths_out = [str(IMG_DIR / f"{k}.jpg") for k in vectors.keys()]

    pbar = tqdm(total=len(todo), desc="embedding")
    for i in range(0, len(todo), args.batch):
        chunk = todo[i:i + args.batch]
        kept, feats = embed_batch(model, preprocess, chunk)
        if feats is None:
            pbar.update(len(chunk))
            continue
        for path, vec in zip(kept, feats):
            patent_num = path.stem
            vectors[patent_num] = vec
            paths_out.append(str(path))
        pbar.update(len(chunk))

        # Checkpoint every 50 batches so we don't lose work on Ctrl+C
        if (i // args.batch) % 50 == 49:
            with open(VECTORS_FILE, "wb") as f:
                pickle.dump({"vectors": vectors, "paths": paths_out}, f)
    pbar.close()

    # Final save
    with open(VECTORS_FILE, "wb") as f:
        pickle.dump({"vectors": vectors, "paths": paths_out}, f)

    print(f"\nDone. {len(vectors)} vectors saved to {VECTORS_FILE.name}")
    print(f"Vector dim: {next(iter(vectors.values())).shape}")


if __name__ == "__main__":
    main()
