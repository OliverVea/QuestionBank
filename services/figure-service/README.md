# figure-service

A standalone Flask service for the **image** half of figure extraction. It turns a
photographed/screenshotted textbook page into a flat rectangle and proposes figure
outlines on it. Deployed on its own (Python/torch), separate from the main
TypeScript app.

Pipeline (validated in `experiments/figure-segmentation/`, see
`docs/investigations/figure-extraction.md`):

1. **Dewarp** — flatten the page to a flat-looking rectangle with **UVDoc** (full
   grid, the chosen baseline).
2. **Detect figure outlines** — **DocLayout-YOLO** figure boxes on the flattened
   image (figures only; text/captions/other dropped; >50%-overlapping dupes
   suppressed). Each figure is returned with **4 corners** so the client can let
   the user drag them when cutting the figure out.

Both steps run server-side in a **single request** — `/v1/process`. The client
never makes a second roundtrip.

**Step 3 — matching figures to questions (e.g. via Claude Sonnet) — is a separate
follow-up** and intentionally not part of this service.

## Auth

Every endpoint except `/health` requires an **`X-API-Key`** header matching the
`FIGURE_SERVICE_API_KEY` env var (constant-time compare; `401` on mismatch). If the
var is unset the check is disabled (local dev). In the cluster the key lives in the
`figure-service-auth` secret and the QuestionBank server sends the same value.

## API

`multipart/form-data` with `file` = the image. Optional form fields: `conf`
(float, default `0.2`), `imgsz` (int, default `1024`).

| Method | Path          | Returns |
| ------ | ------------- | ------- |
| GET    | `/health`     | `{status, detector_loaded, dewarper_loaded}` |
| POST   | `/v1/process` | dewarp + detect in one call: rectified image (base64 PNG) + outlines |

`/v1/process` response shape:

```json
{
  "rectified": { "png_base64": "...", "width": 2480, "height": 3508 },
  "figures": [
    { "id": 0, "cls": "figure", "score": 0.94,
      "box": [x1, y1, x2, y2],
      "corners": [[x1,y1],[x2,y1],[x2,y2],[x1,y2]] }
  ]
}
```

Coordinates are pixels in the **rectified** image. Only **figures** are returned
(text/captions/other classes are dropped). Figure boxes overlapping by >50% of
either box are suppressed, keeping the largest. The step-3 matcher reads figure
labels ("Figure P5.32") off the page image directly.

## Run locally

```bash
cd services/figure-service
uv sync
uv run flask --app app run --host 0.0.0.0 --port 8000   # dev
# or production:
uv run gunicorn -w 1 -k gthread --threads 4 --timeout 120 -b 0.0.0.0:8000 app:app
```

CPU-only is fine (no GPU needed). First start downloads the DocLayout-YOLO weight
from HuggingFace (cached); UVDoc weights ship inside `py-reform`.

### Try it

```bash
curl -s -F file=@page.jpg http://localhost:8000/v1/process | jq '.figures | length'
```

## Docker

```bash
docker build -t figure-service .
docker run -p 8000:8000 -e FIGURE_SERVICE_API_KEY=dev figure-service
```

The image bakes both models in at build time so the first request is fast.

## Deploy

Deployed via the QuestionBank Olve.Pipelines pipeline (`.pipelines/config.yaml`),
not separately:

- production step **`package-figures`** Kaniko-builds the image (writes
  `figures-version.txt` so it doesn't collide with the QB build's bundle selector).
- processing steps **`deploy-figures-beta`** / **`deploy-figures`** import the image,
  create the `figure-service-auth` secret (from the `FIGURE_SERVICE_API_KEY` pipeline
  secret) in `apps-beta` / `apps`, and `helm upgrade` the chart in `helm/`. They run
  *before* the QB deploy in each env, so the secret + Service exist first.

The chart (`helm/`) is in-cluster only (ClusterIP, no ingress). The QuestionBank
server reaches it at `FIGURE_SERVICE_URL` (`http://questionbank-figures.<ns>.svc.cluster.local`)
and mounts the same `figure-service-auth` secret as `FIGURE_SERVICE_API_KEY`.
