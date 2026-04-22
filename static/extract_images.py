"""
extract_images.py

Walk ./pdfs/ and save one representative drawing image per patent to
./extracted_images/{patent_number}.jpg

Strategy (simple & effective for HK patents):
    - Page 1 is almost always the bibliographic front page, skip it
    - Page 2 is almost always the first drawing page, use it
    - If the PDF has only 1 page, use that

The PDF is rendered at 150 DPI (good balance between quality and speed).

USAGE:
    pip install pymupdf pillow tqdm
    python extract_images.py
    python extract_images.py --dpi 200          # higher quality
    python extract_images.py --page 3           # pick a different page
    python extract_images.py --overwrite        # redo existing
"""

import argparse
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image
from tqdm import tqdm

BASE_DIR   = Path(__file__).parent.resolve()
PDF_DIR    = BASE_DIR / "pdfs"
IMG_DIR    = BASE_DIR / "extracted_images"


def extract_one(pdf_path: Path, out_path: Path, dpi: int, target_page: int) -> bool:
    """Render the target drawing page of a PDF to a JPG. Return True on success."""
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return False

    if len(doc) == 0:
        doc.close()
        return False

    # Page index is 0-based, but user thinks 1-based
    page_idx = min(target_page - 1, len(doc) - 1)
    if page_idx < 0:
        page_idx = 0

    try:
        page = doc.load_page(page_idx)
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        # Resize to max 1024px on the long side to keep files small and CLIP-friendly
        img.thumbnail((1024, 1024), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=85, optimize=True)
        return True
    except Exception:
        return False
    finally:
        doc.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpi",       type=int, default=150, help="render DPI (default: 150)")
    ap.add_argument("--page",      type=int, default=2,   help="which page to extract (1-based, default: 2)")
    ap.add_argument("--overwrite", action="store_true",   help="redo images that already exist")
    args = ap.parse_args()

    if not PDF_DIR.exists():
        sys.exit(f"PDF folder not found: {PDF_DIR}")
    IMG_DIR.mkdir(exist_ok=True)

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"No PDFs found in {PDF_DIR}")

    ok = skip = fail = 0

    for pdf in tqdm(pdfs, desc="extracting"):
        patent_num = pdf.stem.split("_")[0]  # strip _1, _2 suffixes
        out = IMG_DIR / f"{patent_num}.jpg"

        if out.exists() and not args.overwrite:
            skip += 1
            continue

        if extract_one(pdf, out, args.dpi, args.page):
            ok += 1
        else:
            fail += 1

    print(f"\nDone. Extracted: {ok}  |  Skipped existing: {skip}  |  Failed: {fail}")
    print(f"Images saved to: {IMG_DIR}")


if __name__ == "__main__":
    main()
