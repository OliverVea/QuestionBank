"""Page flatten + upright pre-step.

Phase-1 finding: DocLayout-YOLO segments figures well on flat, upright pages but
recall collapses on skewed phone photos. This module rectifies a photographed
page to a flat, front-on rectangle (planar perspective transform) before
detection.

Approach: classical OpenCV — find the largest 4-corner quadrilateral that looks
like the page, then a perspective warp. This is the cheap, "normal infra" first
attempt. If curved/folded pages defeat the planar assumption, the fallback is a
learned document-rectification model (DocTr / DewarpNet-class) — heavier, noted
in the investigation doc.

`rotate_deg` applies a manual 0/90/180/270 turn afterward for uprightness, since
robust auto text-orientation detection (OSD) is out of scope for the spike.
"""

import cv2
import numpy as np
from PIL import Image


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left  (smallest x+y)
    rect[2] = pts[np.argmax(s)]  # bottom-right (largest x+y)
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right (smallest y-x)
    rect[3] = pts[np.argmax(diff)]  # bottom-left
    return rect


def find_page_quad(bgr: np.ndarray) -> np.ndarray | None:
    """Return the page's 4 corners in full-res coords, or None if not found."""
    h, w = bgr.shape[:2]
    scale = 1000.0 / max(h, w)
    small = cv2.resize(bgr, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 40, 130)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)

    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:6]
    area_small = small.shape[0] * small.shape[1]
    for c in cnts:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.contourArea(approx) > 0.30 * area_small:
            return approx.reshape(4, 2).astype("float32") / scale
    return None


def dewarp(pil_img: Image.Image, rotate_deg: int = 0) -> tuple[Image.Image, bool]:
    """Flatten a photographed page. Returns (image, page_found)."""
    bgr = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)
    quad = find_page_quad(bgr)

    if quad is None:
        out = pil_img
        found = False
    else:
        rect = _order_corners(quad)
        (tl, tr, br, bl) = rect
        width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], "float32")
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(bgr, M, (width, height))
        out = Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB))
        found = True

    if rotate_deg:
        out = out.rotate(-rotate_deg, expand=True)  # PIL rotates CCW; negate for CW
    return out, found
