"""Flask service: page image -> flat rectangle + figure outlines.

Endpoints:
  GET  /health     -> liveness + whether models are loaded
  POST /v1/process -> ONE call: dewarp + detect. Returns the rectified page
                      (base64 PNG) and figure/caption outlines together.

Both pipeline steps run server-side in a single request — no second roundtrip.

Auth: every endpoint except /health requires an `X-API-Key` header matching the
FIGURE_SERVICE_API_KEY env var (constant-time). If the var is unset, auth is off
(local dev).

Request: multipart/form-data with `file` = the image. Optional form fields:
  conf  (float, default 0.2)  detection confidence threshold
  imgsz (int,   default 1024) detection inference size

Step 3 (matching figures to questions, e.g. via Sonnet) is a separate follow-up.
"""

import hmac
import os

from flask import Flask, abort, jsonify, request
from PIL import Image, UnidentifiedImageError

import pipeline

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB

# Shared-secret API auth. Callers (the QuestionBank server) send X-API-Key; we
# compare it constant-time against FIGURE_SERVICE_API_KEY. When the var is unset
# (local dev) auth is disabled. /health is always open so k8s probes work.
API_KEY = os.environ.get("FIGURE_SERVICE_API_KEY", "")


@app.before_request
def _require_api_key():
    if request.path == "/health":
        return None
    if not API_KEY:
        return None
    if not hmac.compare_digest(request.headers.get("X-API-Key", ""), API_KEY):
        abort(401, description="missing or invalid X-API-Key")
    return None


def _image_from_request() -> Image.Image:
    if "file" not in request.files:
        abort(400, description="multipart form field 'file' (an image) is required")
    try:
        return Image.open(request.files["file"].stream).convert("RGB")
    except UnidentifiedImageError:
        abort(400, description="uploaded file is not a readable image")


def _params():
    try:
        conf = float(request.form.get("conf", 0.2))
        imgsz = int(request.form.get("imgsz", 1024))
    except (TypeError, ValueError):
        abort(400, description="conf must be a float and imgsz an int")
    return conf, imgsz


@app.get("/health")
def health():
    return jsonify(
        status="ok",
        detector_loaded=pipeline._detector is not None,
        dewarper_loaded=pipeline._dewarper is not None,
    )


@app.post("/v1/process")
def process():
    """Dewarp + detect in one call.

    Returns the rectified image (base64 PNG) plus figure/caption outlines in the
    rectified image's pixel space — everything the client needs to show the flat
    page and let the user drag figure corners before cutting. Both pipeline steps
    run here server-side, so the client makes a single request.
    """
    image = _image_from_request()
    conf, imgsz = _params()
    rectified = pipeline.dewarp(image)
    figs = pipeline.detect_figures(rectified, conf=conf, imgsz=imgsz)
    return jsonify(
        rectified={
            "png_base64": pipeline.to_png_b64(rectified),
            "width": rectified.width,
            "height": rectified.height,
        },
        figures=figs,
    )


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(413)
@app.errorhandler(500)
def _json_error(err):
    code = getattr(err, "code", 500)
    return jsonify(error=getattr(err, "description", str(err)), status=code), code


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
