"""Before/after dewarp on the skewed photo (829): does flattening recover recall?"""

from pathlib import Path

from PIL import Image, ImageDraw
from huggingface_hub import hf_hub_download
from doclayout_yolo import YOLOv10

from dewarp import dewarp

HERE = Path(__file__).parent
IMG = next((HERE / "samples").glob("*829.jpg"))
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
CONF, IMGSZ = 0.20, 1024


def is_figure(c: str) -> bool:
    c = c.lower()
    return ("figure" in c and "caption" not in c) or "picture" in c or "image" in c


model = YOLOv10(hf_hub_download(
    repo_id="juliozhao/DocLayout-YOLO-DocStructBench",
    filename="doclayout_yolo_docstructbench_imgsz1024.pt",
))


def count(img):
    res = model.predict(img, conf=CONF, imgsz=IMGSZ, verbose=False)[0]
    dets = [(res.names[int(b.cls)], float(b.conf), tuple(float(v) for v in b.xyxy[0])) for b in res.boxes]
    return dets


def save_annotated(img, dets, name):
    ann = img.copy()
    dr = ImageDraw.Draw(ann)
    for cls, score, (x1, y1, x2, y2) in dets:
        color = (220, 40, 40) if is_figure(cls) else (40, 170, 60) if "caption" in cls.lower() else (50, 110, 220)
        dr.rectangle([x1, y1, x2, y2], outline=color, width=4)
    ann.thumbnail((1100, 1100))
    ann.save(OUT / name)


orig = Image.open(IMG).convert("RGB")
raw_dets = count(orig)
print(f"original             : {sum(is_figure(d[0]) for d in raw_dets)} figures / {len(raw_dets)} regions")

for rot in (0, 90, 180, 270):
    warped, found = dewarp(orig, rotate_deg=rot)
    dets = count(warped)
    nfig = sum(is_figure(d[0]) for d in dets)
    print(f"dewarp rotate={rot:<3}     : {nfig} figures / {len(dets)} regions  (page_found={found})")
    if rot == 0:
        save_annotated(warped, dets, "829_dewarped_rot0__annotated.png")
    if rot == 180:
        save_annotated(warped, dets, "829_dewarped_rot180__annotated.png")
