"""Figure-extraction pipeline: page image -> flat rectangle -> figure outlines.

Two steps, validated in experiments/figure-segmentation (see
docs/investigations/figure-extraction.md):

  1. dewarp(): flatten the page with UVDoc (full grid, the chosen baseline).
  2. detect_figures(): DocLayout-YOLO figure + caption boxes on the flat image.

Models are heavy (torch CPU) so they're loaded once, lazily, and reused.
"""

import base64
import io

from PIL import Image

DETECTOR_REPO = "juliozhao/DocLayout-YOLO-DocStructBench"
DETECTOR_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"

_detector = None
_dewarper = None


def detector():
    """DocLayout-YOLO, loaded once."""
    global _detector
    if _detector is None:
        from doclayout_yolo import YOLOv10
        from huggingface_hub import hf_hub_download

        _detector = YOLOv10(hf_hub_download(repo_id=DETECTOR_REPO, filename=DETECTOR_FILE))
    return _detector


def dewarper():
    """UVDoc model (CPU), loaded once."""
    global _dewarper
    if _dewarper is None:
        from py_reform.models.uvdoc_model import UVDocModel

        _dewarper = UVDocModel(device="cpu")
    return _dewarper


def warmup():
    """Force both models to load (and download weights). Call at startup/build."""
    detector()
    dewarper()


def dewarp(image: Image.Image) -> Image.Image:
    """Step 1: flatten a photographed page to a flat-looking rectangle (UVDoc full grid)."""
    return dewarper().process(image.convert("RGB"))


def _is_figure(cls: str) -> bool:
    c = cls.lower()
    return ("figure" in c and "caption" not in c) or "picture" in c or "image" in c


def _area(box):
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _overlap_frac(a, b):
    """Intersection as a fraction of the SMALLER box (== max of the two
    per-box fractions, i.e. ">50% from either figure")."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    smaller = min(_area(a), _area(b))
    return inter / smaller if smaller else 0.0


def _suppress_overlaps(figures, thresh=0.5):
    """Greedy: keep the largest box; drop any box overlapping a kept one by
    >thresh of either box."""
    kept = []
    for f in sorted(figures, key=lambda f: _area(f["box"]), reverse=True):
        if all(_overlap_frac(f["box"], k["box"]) <= thresh for k in kept):
            kept.append(f)
    return kept


def detect_figures(image: Image.Image, conf: float = 0.2, imgsz: int = 1024):
    """Step 2: detect figure outlines on a (rectified) page image. Only figures —
    text/captions/other classes are ignored. Coordinates are pixels in `image`'s
    space. Returns a list, ordered top-to-bottom, left-to-right.
    """
    image = image.convert("RGB")
    res = detector().predict(image, conf=conf, imgsz=imgsz, verbose=False)[0]
    names = res.names
    figures = []
    for b in res.boxes:
        cls = names[int(b.cls)]
        if not _is_figure(cls):
            continue
        x1, y1, x2, y2 = (round(float(v), 1) for v in b.xyxy[0])
        figures.append({
            "cls": cls,
            "score": round(float(b.conf), 4),
            "box": [x1, y1, x2, y2],
            # 4 corners (TL, TR, BR, BL) — axis-aligned to start; the client lets
            # the user drag these when cutting the figure out of the rectified image.
            "corners": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
        })
    figures = _suppress_overlaps(figures)  # drop >50%-overlapping dupes, keep largest
    figures.sort(key=lambda f: (f["box"][1], f["box"][0]))  # top-to-bottom, left-to-right
    for i, f in enumerate(figures):
        f["id"] = i
    return figures


def to_png_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
