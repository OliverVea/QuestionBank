"""One-off headless pass: run DocLayout-YOLO over every sample and report.

Writes annotated overlays + per-figure crops to ./out/, prints a per-image
summary table. Lets me eyeball detection quality without the UI.
"""

from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw
from huggingface_hub import hf_hub_download
from doclayout_yolo import YOLOv10

HERE = Path(__file__).parent
SAMPLES = HERE / "samples"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

CONF = 0.20
IMGSZ = 1024


def is_figure(c: str) -> bool:
    c = c.lower()
    return "figure" in c and "caption" not in c or "picture" in c or "image" in c


path = hf_hub_download(
    repo_id="juliozhao/DocLayout-YOLO-DocStructBench",
    filename="doclayout_yolo_docstructbench_imgsz1024.pt",
)
model = YOLOv10(path)

SELECT = ("708", "144", "166", "829")  # user's picks (filename suffixes)
imgs = sorted(p for p in SAMPLES.glob("*.jpg") if p.stem.endswith(SELECT))
print(f"{len(imgs)} images, conf={CONF}, imgsz={IMGSZ}\n")
print(f"{'image':<32}{'regions':>8}{'figures':>9}  classes")

for p in imgs:
    image = Image.open(p).convert("RGB")
    res = model.predict(image, conf=CONF, imgsz=IMGSZ, verbose=False)[0]
    names = res.names
    dets = []
    for b in res.boxes:
        cls = names[int(b.cls)]
        score = float(b.conf)
        box = tuple(float(v) for v in b.xyxy[0])
        dets.append((cls, score, box))

    cc = Counter(d[0] for d in dets)
    n_fig = sum(is_figure(d[0]) for d in dets)
    print(f"{p.name:<32}{len(dets):>8}{n_fig:>9}  {dict(cc)}")

    # annotated overlay
    ann = image.copy()
    dr = ImageDraw.Draw(ann)
    for cls, score, (x1, y1, x2, y2) in dets:
        color = (220, 40, 40) if is_figure(cls) else (40, 170, 60) if "caption" in cls.lower() else (50, 110, 220)
        dr.rectangle([x1, y1, x2, y2], outline=color, width=4)
        dr.text((x1 + 5, y1 + 5), f"{cls} {score:.2f}", fill=color)
    ann.thumbnail((1100, 1100))
    ann.save(OUT / f"{p.stem}__annotated.png")

    # figure crops
    for i, (cls, score, (x1, y1, x2, y2)) in enumerate(d for d in dets if is_figure(d[0])):
        image.crop((x1, y1, x2, y2)).save(OUT / f"{p.stem}__fig{i}_{score:.2f}.png")

print(f"\nwrote overlays + crops to {OUT}")
