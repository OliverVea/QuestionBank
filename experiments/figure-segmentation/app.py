"""Figure-segmentation validation spike (phase 1).

A throwaway Streamlit app to eyeball how well a document-layout model segments
figures out of physics-textbook pages. NOT part of the QuestionBank app — see
../README.md and docs/investigations/figure-extraction.md.

Pipeline validated by this spike:
    UVDoc flatten  ->  auto-orient  ->  DocLayout-YOLO  ->  crop
On a worst-case angled 2-page-spread photo this took figure recall 1 -> 7.

Run:  uv run streamlit run app.py --server.address 0.0.0.0 --server.port 8601
Then open http://bulwark-m2:8601 (drop pages into ./samples first).
"""

import io
from pathlib import Path

import cv2
import numpy as np
import streamlit as st
from PIL import Image, ImageDraw
from huggingface_hub import hf_hub_download
from doclayout_yolo import YOLOv10

SAMPLES_DIR = Path(__file__).parent / "samples"
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

MODELS = {
    "DocLayout-YOLO (DocStructBench)": (
        "juliozhao/DocLayout-YOLO-DocStructBench",
        "doclayout_yolo_docstructbench_imgsz1024.pt",
    ),
}

st.set_page_config(page_title="Figure segmentation spike", layout="wide")


@st.cache_resource(show_spinner="Downloading + loading detector…")
def load_model(repo_id: str, filename: str) -> YOLOv10:
    return YOLOv10(hf_hub_download(repo_id=repo_id, filename=filename))


@st.cache_resource(show_spinner="Loading UVDoc…")
def load_uvdoc():
    from py_reform.models.uvdoc_model import UVDocModel

    return UVDocModel(device="cpu")


NATIVE_GRID = (31, 45)  # (Gh, Gw) — fixed by the trained UVDoc head


def _uvdoc_grid(model, pil: Image.Image, rows: int | None = None) -> np.ndarray:
    """The UVDoc net's predicted backward map: (2, Gh, Gw) normalized input coords
    for each output grid node. Native is 31×45; `rows` < 31 *coarsens* it (control
    points downsampled, keeping the 45/31 aspect) → a smoother warp with less local
    detail (toward a global transform). Can't go finer than native without retraining."""
    import torch

    inp = pil.convert("RGB").resize((model.img_size[0], model.img_size[1]))
    t = torch.from_numpy(np.array(inp).astype(np.float32).transpose(2, 0, 1)[None] / 255)
    with torch.no_grad():
        pp, _ = model.model(t)
    g = pp[0].numpy()  # (2, 31, 45)
    if rows is not None and rows < NATIVE_GRID[0]:
        cols = max(2, round(rows * NATIVE_GRID[1] / NATIVE_GRID[0]))
        g = np.stack([cv2.resize(g[c], (cols, rows), interpolation=cv2.INTER_LINEAR) for c in range(2)])
    return g


def _dewarp_fullgrid(model, pil: Image.Image, rows: int | None = None) -> Image.Image:
    """Apply the (optionally coarsened) grid as a dense warp via bilinear_unwarping
    (equivalent to model.process when rows is native)."""
    import torch

    from py_reform.models.uvdoc_model import bilinear_unwarping

    g = _uvdoc_grid(model, pil, rows)
    pp = torch.from_numpy(g)[None]
    arr = np.array(pil.convert("RGB")).astype(np.float32).transpose(2, 0, 1)[None] / 255
    w, h = pil.size
    out = bilinear_unwarping(torch.from_numpy(arr), pp, [w, h])
    return Image.fromarray((out[0].numpy().transpose(1, 2, 0) * 255).astype(np.uint8))


def _correspondences(grid: np.ndarray, size):
    """Output-pixel <-> input-pixel point pairs from the grid (for fitting a global
    transform)."""
    _, gh, gw = grid.shape
    w, h = size
    out_pts, in_pts = [], []
    for i in range(gh):
        for j in range(gw):
            out_pts.append([j / (gw - 1) * (w - 1), i / (gh - 1) * (h - 1)])
            in_pts.append([(grid[0, i, j] + 1) / 2 * (w - 1), (grid[1, i, j] + 1) / 2 * (h - 1)])
    return np.float32(in_pts), np.float32(out_pts)


def _dewarp(model, pil: Image.Image, mode: str, rows: int | None = None) -> Image.Image:
    """Dewarp by transform family: full grid (UVDoc dense, fits perspective+curl),
    homography (8 DOF, projective only), or affine (6 DOF, can't fix perspective).
    `rows` coarsens the underlying grid (see _uvdoc_grid)."""
    if mode == "Full grid (UVDoc)":
        return _dewarp_fullgrid(model, pil, rows)
    ip, op = _correspondences(_uvdoc_grid(model, pil, rows), pil.size)
    arr = np.array(pil.convert("RGB"))
    w, h = pil.size
    if mode == "Homography":
        M, _ = cv2.findHomography(ip, op, 0)
        return Image.fromarray(cv2.warpPerspective(arr, M, (w, h)))
    A, _ = cv2.estimateAffine2D(ip, op, method=cv2.LMEDS)
    return Image.fromarray(cv2.warpAffine(arr, A, (w, h)))


@st.cache_data(show_spinner="Flattening page…")
def straighten_cached(img_bytes: bytes, mode: str, rows: int) -> bytes:
    """Dewarp; cached on (source bytes, transform mode, grid rows). Returns PNG bytes."""
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    out = _dewarp(load_uvdoc(), im, mode, rows)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


@st.cache_data(show_spinner="Computing UVDoc grid…")
def grid_overlay_png(img_bytes: bytes, rows: int) -> bytes:
    """Draw UVDoc's predicted mesh on the ORIGINAL page. Each node maps an output
    grid point back to where it samples in the input; connecting them shows the
    deformed grid following the warped page surface — i.e. the distortion the model
    is correcting. `rows` matches the (coarsened) grid actually used for the warp."""
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    g = _uvdoc_grid(load_uvdoc(), im, rows)  # (2, Gh, Gw) normalized input coords
    w, h = im.size
    _, gh, gw = g.shape
    px = (g[0] + 1) / 2 * (w - 1)
    py = (g[1] + 1) / 2 * (h - 1)
    ov = im.copy()
    d = ImageDraw.Draw(ov)
    lw = max(2, w // 700)
    for i in range(gh):
        for j in range(gw):
            if j + 1 < gw:
                d.line([(px[i, j], py[i, j]), (px[i, j + 1], py[i, j + 1])], fill=(255, 40, 40), width=lw)
            if i + 1 < gh:
                d.line([(px[i, j], py[i, j]), (px[i + 1, j], py[i + 1, j])], fill=(255, 40, 40), width=lw)
    buf = io.BytesIO()
    ov.save(buf, format="PNG")
    return buf.getvalue()


def flatfield(pil: Image.Image, white_clip: bool = False) -> Image.Image:
    """Deglare + denoise a line-art figure crop.

    Edge-preserving denoise first, then flat-field *division* (not absdiff+stretch
    — the stretch is what amplified background noise): divide each channel by its
    illumination field so glossy sheen flattens to uniform white while colored ink
    is preserved. Optional white-clip pushes near-white paper to pure white for a
    crisper background (can clip faint content)."""
    bgr = cv2.cvtColor(np.array(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
    den = cv2.fastNlMeansDenoisingColored(bgr, None, 7, 7, 7, 21).astype(np.float32)
    out = []
    for ch in cv2.split(den):
        bg = cv2.medianBlur(cv2.dilate(ch.astype(np.uint8), np.ones((7, 7), np.uint8)), 31).astype(np.float32) + 1
        out.append(np.clip(ch / bg * 255, 0, 255).astype(np.uint8))
    img = cv2.merge(out)
    if white_clip:
        lo = 140.0
        img = np.clip((img.astype(np.float32) - lo) / (250 - lo) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def quantize(pil: Image.Image, k: int, ncand: int = 48, freq_bias: float = 0.35, min_frac: float = 0.003) -> Image.Image:
    """Snap to k 'meaningful' colors — the most *different* ones, with a small bias
    toward *frequent* ones. Plain k-means is purely frequency-driven (splits paper
    into shades before giving a rare red arrow a slot). Pure farthest-first fixes
    that but chases outliers — sparse anti-aliased text-edge fringe colors. So:
    fine k-means -> candidate clusters; drop negligible ones (< min_frac of pixels,
    kills fringe); farthest-first selection in Lab scored by distance * weight^bias,
    so picks are distinct AND not vanishingly rare. Real accents (a coherent arrow)
    clear the floor; edge fringe doesn't."""
    rgb = np.array(pil.convert("RGB"))
    flat = rgb.reshape(-1, 3).astype(np.float32)
    n = len(flat)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 15, 1.0)
    _, idx, cen = cv2.kmeans(flat, min(ncand, len(np.unique(flat, axis=0))), None, crit, 2, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(idx.flatten(), minlength=len(cen))
    keep = counts >= max(1, int(min_frac * n))
    cand, cc = cen[keep], counts[keep].astype(np.float32)
    w = cc / cc.sum()
    cand_lab = cv2.cvtColor(cand.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    chosen = [int(np.argmax(cc))]  # seed: the dominant color (paper)
    while len(chosen) < min(k, len(cand)):
        d = np.min(np.linalg.norm(cand_lab[:, None, :] - cand_lab[chosen][None, :, :], axis=2), axis=1)
        score = d * (w ** freq_bias)
        score[chosen] = -1.0
        chosen.append(int(np.argmax(score)))
    pal = cand[chosen]
    pal_lab = cv2.cvtColor(pal.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    px_lab = cv2.cvtColor(rgb.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    lbl = np.argmin(np.linalg.norm(px_lab[:, None, :] - pal_lab[None, :, :], axis=2), axis=1)
    return Image.fromarray(pal[lbl].reshape(rgb.shape).astype(np.uint8))


def quad_rectify(crop: Image.Image, min_frac: float = 0.30):
    """EXPERIMENTAL per-figure rectification: detect long straight lines, take the
    extreme horizontal/vertical ones as a frame quad, warp it to a rectangle.
    Returns (image, fit_ok). Caveats: needs a real rectangular frame (circuit box,
    plot axes); returns the crop unchanged if it can't fit; and it will CORRUPT
    figures whose dominant lines are content (vectors/rays/inclines), so it's
    opt-in only."""
    g = cv2.cvtColor(np.array(crop.convert("RGB")), cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(g, 50, 150)
    L = cv2.HoughLinesP(edges, 1, np.pi / 180, 60, minLineLength=int(min(crop.size) * min_frac), maxLineGap=8)
    if L is None:
        return crop, False
    hs, vs = [], []
    for x1, y1, x2, y2 in L[:, 0, :]:
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180
        if a < 20 or a > 160:
            hs.append((x1, y1, x2, y2))
        elif 70 < a < 110:
            vs.append((x1, y1, x2, y2))
    if len(hs) < 2 or len(vs) < 2:
        return crop, False

    def inter(l1, l2):
        x1, y1, x2, y2 = l1
        x3, y3, x4, y4 = l2
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-6:
            return None
        return (((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den,
                ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den)

    w, h = crop.size
    top = min(hs, key=lambda l: (l[1] + l[3]) / 2)
    bot = max(hs, key=lambda l: (l[1] + l[3]) / 2)
    lft = min(vs, key=lambda l: (l[0] + l[2]) / 2)
    rgt = max(vs, key=lambda l: (l[0] + l[2]) / 2)
    cs = [inter(top, lft), inter(top, rgt), inter(bot, rgt), inter(bot, lft)]
    if any(c is None for c in cs):
        return crop, False
    M = cv2.getPerspectiveTransform(np.float32(cs), np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    return Image.fromarray(cv2.warpPerspective(np.array(crop.convert("RGB")), M, (w, h))), True


def is_figure(cls: str) -> bool:
    c = cls.lower()
    return ("figure" in c and "caption" not in c) or "picture" in c or "image" in c


def is_caption(cls: str) -> bool:
    return "caption" in cls.lower()


def detect(model, image, conf, imgsz):
    res = model.predict(image, conf=conf, imgsz=imgsz, verbose=False)[0]
    names = res.names
    dets = []
    for b in res.boxes:
        dets.append({
            "cls": names[int(b.cls)],
            "score": float(b.conf),
            "box": tuple(float(v) for v in b.xyxy[0]),
        })
    return dets


def fig_score(dets) -> float:
    """Orientation score: total confidence over figure + caption regions."""
    return sum(d["score"] for d in dets if is_figure(d["cls"]) or is_caption(d["cls"]))


# ── sidebar controls ──────────────────────────────────────────────────────────
st.sidebar.title("Controls")
# Decided baseline: flatten (UVDoc) + keep 0° + extract + NO post-processing.
# Auto-orient stays available as a rescue for misoriented captures (e.g. a
# landscape 2-page spread), but real upright single-page captures don't need it.
do_dewarp = st.sidebar.checkbox("Flatten page (UVDoc)", value=True)
transform_mode = st.sidebar.selectbox(
    "Transform model", ["Full grid (UVDoc)", "Homography", "Affine"], index=0, disabled=not do_dewarp,
    help="Full grid: best — fits perspective + curl, lands flattest on real pages. Homography: 8-DOF projective only, leaves residual skew. Affine: 6-DOF, can't fix perspective.",
)
grid_rows = st.sidebar.slider(
    "Grid resolution (rows)", 2, 31, 31, disabled=not do_dewarp,
    help="UVDoc native is 31×45. Lower = coarser control points → smoother warp (toward a global transform). Can't exceed native without retraining. Width auto = round(rows·45/31).",
)
auto_orient = st.sidebar.checkbox("Auto-orient (best of 4 rotations)", value=False)
manual_rot = st.sidebar.selectbox("…or manual rotate", [0, 90, 180, 270], index=0, disabled=auto_orient)
model_label = st.sidebar.selectbox("Detector", list(MODELS))
conf = st.sidebar.slider("Confidence threshold", 0.05, 0.95, 0.20, 0.05)
imgsz = st.sidebar.select_slider("Inference image size", [640, 1024, 1280, 1600, 2048], 1024)
pad = st.sidebar.slider("Crop padding (px)", 0, 40, 6, 2)
# Default OFF: raw crops look best on clean captures. These are opt-in rescues
# for the occasional glary/noisy figure, not an always-on pipeline.
quad_rect = st.sidebar.checkbox("Per-figure quad rectify (experimental)", value=False,
                                help="Fit a frame quad from each figure's straight lines and square it. Helps framed figures (circuits/plots); CORRUPTS figures with angled content (vectors/inclines). Crops with no detectable frame pass through unchanged.")
enhance = st.sidebar.checkbox("Enhance figures (flat-field deglare)", value=False)
quant = st.sidebar.checkbox("Quantize colors (meaningful palette)", value=False)
quant_k = st.sidebar.slider("Palette size (K)", 3, 10, 6, disabled=not quant)

samples = sorted(p for p in SAMPLES_DIR.glob("**/*") if p.suffix.lower() in IMG_EXTS)
uploaded = st.sidebar.file_uploader("Upload a page", type=[e[1:] for e in IMG_EXTS])
picked = st.sidebar.selectbox("…or pick a dropped sample", ["—"] + [str(p.relative_to(SAMPLES_DIR)) for p in samples])

st.title("Figure segmentation — validation spike")
st.caption("Pipeline: UVDoc flatten → auto-orient → DocLayout-YOLO. Red = figure, green = caption, blue = other.")

if uploaded is not None:
    src_bytes = uploaded.getvalue()
elif picked != "—":
    src_bytes = (SAMPLES_DIR / picked).read_bytes()
else:
    st.info(f"No page selected. Drop images into `{SAMPLES_DIR}` or upload one in the sidebar.")
    st.stop()

raw = Image.open(io.BytesIO(src_bytes)).convert("RGB")
model = load_model(*MODELS[model_label])

# ── flatten ─────────────────────────────────────────────────────────────────────
if do_dewarp:
    flat = Image.open(io.BytesIO(straighten_cached(src_bytes, transform_mode, grid_rows))).convert("RGB")
else:
    flat = raw

# ── orient ──────────────────────────────────────────────────────────────────────
if auto_orient:
    scored = []
    for rot in (0, 90, 180, 270):
        cand = flat.rotate(rot, expand=True)
        scored.append((fig_score(detect(model, cand, 0.20, 1024)), rot, cand))
    best_score, chosen_rot, image = max(scored, key=lambda t: t[0])
    st.caption(f"Auto-orient → rotated {chosen_rot}° (scores: " + ", ".join(f"{r}°={s:.1f}" for s, r, _ in scored) + ")")
else:
    chosen_rot = manual_rot
    image = flat.rotate(manual_rot, expand=True)

if do_dewarp:
    with st.expander(f"Pre-processing — UVDoc flatten + rotate {chosen_rot}°", expanded=False):
        c1, c2, c3 = st.columns(3)
        c1.image(raw, caption="original", use_container_width=True)
        c2.image(Image.open(io.BytesIO(grid_overlay_png(src_bytes, grid_rows))), caption=f"UVDoc grid {grid_rows}×{max(2, round(grid_rows * 45 / 31))} (deformation it corrects)", use_container_width=True)
        c3.image(image, caption="flattened + oriented", use_container_width=True)

# ── detect (final, at user settings) ─────────────────────────────────────────────
dets = detect(model, image, conf, imgsz)
dets.sort(key=lambda d: (d["box"][1], d["box"][0]))

annotated = image.copy()
draw = ImageDraw.Draw(annotated)
for d in dets:
    x1, y1, x2, y2 = d["box"]
    color = (220, 40, 40) if is_figure(d["cls"]) else (40, 170, 60) if is_caption(d["cls"]) else (50, 110, 220)
    draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
    draw.text((x1 + 4, y1 + 4), f"{d['cls']} {d['score']:.2f}", fill=color)

n_fig = sum(is_figure(d["cls"]) for d in dets)
n_cap = sum(is_caption(d["cls"]) for d in dets)

left, right = st.columns([3, 2])
with left:
    st.subheader(f"Detections — {len(dets)} regions ({n_fig} figures, {n_cap} captions)")
    st.image(annotated, use_container_width=True)
with right:
    st.subheader("All regions")
    st.dataframe(
        [{
            "class": d["cls"],
            "score": round(d["score"], 2),
            "w": round(d["box"][2] - d["box"][0]),
            "h": round(d["box"][3] - d["box"][1]),
            "AR": round((d["box"][2] - d["box"][0]) / max(1, d["box"][3] - d["box"][1]), 2),
        } for d in dets],
        use_container_width=True,
        height=520,
    )

st.subheader(f"Figure crops ({n_fig})")
fig_dets = [d for d in dets if is_figure(d["cls"])]
if not fig_dets:
    st.warning("No figure regions detected — lower the confidence threshold or try another imgsz.")
else:
    cols = st.columns(3)
    W, H = image.size
    for i, d in enumerate(fig_dets):
        x1, y1, x2, y2 = d["box"]
        crop = image.crop((max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)))
        w, h = crop.size
        fit_note = ""
        if quad_rect:
            crop, ok = quad_rectify(crop)
            fit_note = " · quad ✓" if ok else " · quad: no frame"
        if enhance:
            crop = flatfield(crop)
        if quant:
            crop = quantize(crop, quant_k)
        with cols[i % 3]:
            st.image(crop, caption=f"{d['cls']} {d['score']:.2f} — {w}×{h}px, AR {w / max(1, h):.2f}{fit_note}")
