# Investigation: Attaching figures to problems

Status: **exploration** — no decision made yet. Goal of this doc is to compare directions and pick what to prototype.

## The problem we want to solve

The next book to ingest is Knight's undergraduate Physics textbook. Unlike the
text-heavy books we've ingested so far, **a large fraction of Knight's problems
depend on a figure/diagram that is required to understand and solve the
problem.** A problem like "the block in Figure P5.32 slides down the incline…"
is unsolvable without the figure.

Today our pipeline assumes problems are **self-contained text** (see
`packages/server/src/llm/extraction-contract.ts`, which explicitly tells the LLM
to fold any shared figure/table context *into the text*). That works when a
figure can be described in a sentence. It breaks down for Knight, where figures
carry geometry, vectors, circuit topology, waveforms, and labeled measurements
that are impractical or lossy to describe in prose.

So we need a way to **capture each problem's figure(s) and attach them to the
problem** so they render alongside the problem text on LearnPage / ViewBookPage /
EditBookPage.

### Assumptions this builds on

See the app-wide **Assumptions** in the [README](../../README.md). In short: the
user supplies **page images** (never PDF internals) + an Anthropic API key; the
operator can run **normal, non-heavy infrastructure incl. small ML models, but
not billion-parameter models**.

**Key consequences for this feature:**

- Any **segmentation model must be small and self-hosted** server-side (YOLO-class
  layout detectors fit; that's the budget). The user needs nothing but
  "take pictures + an API key."
- Any **heavyweight vision/reasoning** (e.g. binding a figure to its problem when
  there's no caption to OCR) must go through the **Anthropic API** — we can't
  self-host a billion-param VLM.
- So the ML route is an *operator-side* enhancement of the existing `POST
  /api/extract` pipeline, fully invisible to the user.

### What makes this hard (constraints from the source material)

- **Must work for *any* book, from page images.** This is a general app, not a
  Knight-specific importer. We **cannot assume a born-digital PDF** with embedded
  figure objects — the real input is the existing photo/scan flow (`POST
  /api/extract` accepts 1–5 page images). So PDF-structure tools like PDFFigures
  2.0 are off the table as a *baseline*; everything must work from pixels.
- **Many figures per page.** Page 1 of the problem set alone has ~8 distinct
  figures. A page is not "one figure"; extraction must segment *multiple*
  regions per page and bind each to the right problem.
- **Wildly variable aspect ratios.** Figures can be square, very tall (a falling
  object / a tall circuit), very wide (a long ray diagram or timeline), or
  anything between. Any cropping/segmentation approach must not assume a shape.
- **Usually few colors.** Most figures are black-line-on-white with sparse
  accent color. This is good news for vector/SVG and for compression, and may
  help simple CV segmentation.
- **Often complex, not matplotlib-shaped.** *Some* figures are plots that
  matplotlib (or similar) could reproduce. **Many are not** — free-body
  diagrams, ray optics, circuit schematics, annotated apparatus sketches. We
  must assume we **cannot** programmatically regenerate the majority, and design
  for "capture the original" as the baseline, with regeneration as an
  opportunistic optimization at best.
- **Binding, not just detection.** Detecting a figure region is only half the
  job; we must associate each figure with the correct problem (by "Figure
  P5.32" label, caption, or spatial proximity).

## Where the current system stands (grounding)

Relevant facts from the codebase that constrain the options:

- A problem is `Question.canonicalText: string` — a single LaTeX/markdown string
  (`packages/server/src/domain/types.ts`). There is **no** structured slot for
  media today.
- Rendering is **KaTeX only** (`packages/client/src/lib/latex.ts`). No markdown,
  no HTML, **no image or SVG** rendering exists yet. (Markdown support is already
  an open TODO, item 3f.)
- **Images are deliberately never persisted** (DONE.md, TODO 3e). Student-answer
  photos are sent transiently to the LLM and dropped. There is an `ImageRef`
  abstraction (`packages/server/src/llm/image-ref.ts`) supporting in-memory and
  on-disk image bytes, and a multipart `POST /api/extract` route already accepts
  1–5 page images.
- Storage is JSON files behind a swappable Repository
  (`packages/server/src/storage/`).

**Implication:** problem *figures* are a different lifecycle from student-answer
*photos*. Figures are permanent content that must be stored and re-rendered.
This is the first real exception to the "never persist images" rule and the
"problem is one string" model — both will likely need to change regardless of
which extraction approach we pick.

## Decided pipeline (baseline)

After validating on real Knight phone photos, the chosen extraction baseline is
deliberately minimal:

> **Flatten (UVDoc full grid, keep 0°) → detect figures
> (DocLayout-YOLO @ imgsz 1024) → crop from the rectified page → NO post-processing.**

- **Flatten** with UVDoc's **full dense grid** (`py-reform`); cheap (~0.7s, CPU).
  *Transform-family comparison (grid vs homography vs affine, fitting a global
  transform to UVDoc's own correspondence grid):*
  - Detection **recall is identical** across all three — the family doesn't change
    *what's found*.
  - But on **real captures the full grid lands visibly flattest** — it squares the
    page completely (straight edges, level header, no border), because the real
    distortion is mildly *nonlinear* (perspective + slight curl + lens) and only the
    dense grid fits all of it.
  - **Homography (8 DOF)** captures only the pure-projective part → leaves residual
    skew/trapezoid + black borders. **Affine (6 DOF)** can't undo perspective at all.
  - The "waviness" worry about the grid was a **pathological-input artifact** (the
    829 far/steep 2-page spread), not present on real single-page photos.

  **Edge case, explicitly out of scope:** 829-style captures (far, steep,
  two-page spreads) are *not* a target — we don't optimize the baseline for them.
  Capture-side guidance (one upright page, shot roughly straight, or a PDF
  screenshot) covers it; the auto-orient toggle is the only fallback if one slips
  through.
  - **Ranking on real pages: full grid ≻ homography ≻ affine.** Selectable in the
    spike via the "Transform model" control.

- *Per-figure quad rectification — evaluated, deprioritized.* Idea: fit a
  quadrilateral to each figure from its own straight lines (frame/axes) and warp
  to a rectangle, instead of (or after) the page warp. Spike finding: **fragile.**
  On clean framed figures (circuit boxes) the line-fit found *no frame* (and the
  page dewarp had already squared them — nothing to fix); on a B-field vector
  diagram it **corrupted** the figure (treated the parallel field arrows as a
  frame and warped). It can't reliably distinguish a real frame from content
  lines, and forcing rectilinearity on intentionally-angled physics content is a
  fidelity bug. Left in the spike as an **opt-in experimental toggle** only; not
  part of the baseline.

- *Grid resolution:* native control grid is **31×45 (fixed by the trained head)** —
  can't go finer without retraining/tiled inference. Coarsening (fewer rows) smooths
  toward a global transform; bicubic interpolation *between* control points is the
  only "more resolution" lever and gives only a marginal visible gain. Both exposed
  in the spike ("Grid resolution" slider).
- **Keep 0°** — real captures are upright single pages, so the 4×-detection
  auto-orient is unnecessary overhead (and a rotation risk). It stays available as
  a *rescue* for misoriented captures (e.g. a landscape 2-page spread like the 829
  test), not as a default.
- **No figure post-processing** — raw crops beat flat-field/denoise/quantize on
  clean captures. Those remain *opt-in, gated rescues* for the occasional glary or
  faint figure (see "Figure image quality" below), not part of the baseline.

Everything below is the supporting investigation that led here.

## Candidate approaches

Framing the four directions you raised, plus how they interact. They split into
two questions that are mostly independent:

- **(A) How do we obtain the figure?** generate vs. crop-original vs. ML-segment
- **(B) How do we store & render it?** SVG vs. raster vs. external file/URL

### A1. Agent writes Python (matplotlib/etc.) to regenerate the plot
- ✅ Output is clean, scalable, theme-able vector; tiny storage.
- ✅ Great for the subset that *are* standard plots.
- ❌ Fails for the majority (free-body, circuits, ray diagrams, apparatus).
- ❌ Running agent-authored Python is a code-execution + sandbox concern.
- ❌ High risk of subtle inaccuracy (wrong angle, wrong label) that silently
  corrupts a physics problem. Verification is expensive.
- **Verdict:** opportunistic only, not a baseline.

### A2. Agent writes raw SVG to recreate the figure
- ✅ Vector, scalable, few-color material is a good fit; no code execution.
- ✅ SVG can embed text/labels and LaTeX-ish markup.
- ❌ LLMs are mediocre at authoring accurate complex SVG geometry from an image;
  error-prone for anything beyond simple diagrams.
- ❌ Same silent-inaccuracy risk as A1.
- **Verdict:** opportunistic; maybe viable for *simple* line diagrams. Worth a
  spike to see how good current models are, but not a baseline.

### A3. Crop/transform the original page image (capture the original)
- ✅ **Lossless fidelity** — it *is* the textbook figure. No hallucination risk.
- ✅ Works for every figure type uniformly.
- ✅ Few-color line art compresses extremely well (PNG, or even SVG-traced).
- ❌ Requires accurate per-figure bounding boxes (the segmentation problem, A4).
- ❌ Raster unless we vectorize; need to handle DPI/quality.
- ❌ Copyright: storing verbatim textbook figures (acceptable for personal/study
  use here, but worth noting).
- **Verdict:** strongest **baseline** — fidelity is non-negotiable for physics.
  The open question it pushes onto us is purely "how do we get good crops," i.e.
  A4.

### A4. ML / automated segmentation to find figure regions on a page image
This is the enabler for A3 (and could feed A1/A2 by giving the model a tight
crop to work from). Since the input is **page images**, the right model class is
**document layout detection** — it outputs labeled bounding boxes including a
`figure`/`picture` class. (Note: these do *detection*, i.e. boxes, not
pixel-mask *segmentation* — and a box is exactly what we crop on, so that's what
we want. True instance masks would be overkill. Also: **don't** reach for the
LayoutLM family despite the name — that's document *understanding* over OCR
tokens, not figure-region finding.)

Concrete HuggingFace-hosted picks, best-fit first:

1. **DocLayout-YOLO** (opendatalab) — best starting point. 2024 YOLO-v10-based,
   real-time, CPU-friendly, detects figures/tables/titles. Loads straight from
   HF via `hf_hub_download(repo_id="juliozhao/DocLayout-YOLO-DocStructBench")`
   then `YOLOv10(filepath)`. Being ultralytics/YOLO, it's trivial to fine-tune
   later.
2. **PP-DocLayout-L** (PaddleOCR, RT-DETR) — the granular option, 23 categories
   including **separate `figure`, `figure caption`, and `figure title` classes**.
   That caption-as-its-own-box is valuable *specifically for us*: get the figure
   box and its caption box, OCR the caption for "FIGURE P5.32", and you have the
   **join key to bind figure → problem in one pass.**
3. **hantian/yolo-doclaynet** — YOLO trained on DocLayNet (80k+ annotated pages),
   simple ultralytics API, includes a `Picture` class.

Two non-model alternatives for completeness:

4. **Classical CV** — connected-components / whitespace-gap analysis on the
   mostly-binary line art. Cheap, no model, but brittle on dense pages and on
   binding figure↔caption.
5. **VLM-driven** — hand the page to a vision LLM and ask for figure bounding
   boxes + which problem each belongs to. Flexible, handles the *binding*
   problem in one shot, but VLM bbox precision is often loose and needs a
   crop-refine/verify step.

**Caveats that will bite us:** these models are trained mostly on clean
PDFs/scans, so accuracy drops on a skewed phone photo — **dewarp to a flat page
first** and they behave much better. If accuracy still isn't there, the YOLO
models **fine-tune cheaply**: a couple dozen hand-boxed pages move the needle a
lot, because our domain (one publisher's consistent layout) is narrow.

**Most promising:** a **hybrid** — layout detector (A4.1/A4.2) for precise figure
*and caption* boxes → OCR the caption to get the "Figure P5.32" key → bind to the
matching problem (with a VLM as fallback for the *binding* when no caption key
exists). Then crop the original (A3) and store the raster (trace simple line art
to SVG opportunistically).

### Infrastructure note
The layout detectors here are **small enough to self-host** within our
"normal, non-heavy infra" budget: DocLayout-YOLO and the DocLayNet YOLO are
YOLO-v10-class and CPU-friendly; PP-DocLayout (RT-DETR) is heavier but still far
from billion-param and fine on a box we control. So segmentation runs locally as
a step in `POST /api/extract` — no per-page API cost. **The VLM-binding fallback
(A4.5) is the exception** — that's billion-param-class, so it goes through the
Anthropic API rather than a self-hosted model.

## Storage & rendering implications (question B)

Whatever we pick, we need:

1. **A media slot on the problem.** Either extend `canonicalText` to a richer
   type, or (cleaner) add `Question.figures: Figure[]` with each figure
   referenced inline from the text by an anchor/id. Inline-by-reference matches
   how the textbook works ("see Figure P5.32").
2. **Persistence** — first content-images we keep. Options:
   - Separate files under the data dir + a `figureId → path` reference (mirrors
     the swappable-store pattern; cleanest).
   - Base64 data URIs inline in the field (no separate storage, but bloats JSON
     and the LLM context every time the problem is sent).
   - SVG stored as text (great for the regenerated/traced subset).
3. **Rendering** — `renderLatex()` must learn to render an image/SVG block. This
   likely rides along with the already-planned markdown support (TODO 3f):
   support `![](…)` / inline `<svg>` / a custom figure token.

## Recommended direction to explore first

1. **Baseline = capture the original (A3) from page images.** Treat fidelity as
   the requirement; regeneration (A1/A2) is a later optimization for the easy
   plots only. Input is always images — no PDF-structure dependency.
2. **Prototype the segmentation+binding spike (operator-side):** stand up
   **DocLayout-YOLO** on this box, run it on a few real Knight page photos → get
   figure (and caption) boxes → OCR the caption for the "Figure P5.32" key,
   falling back to a VLM for binding when there's no caption → crop → eyeball the
   results. Add a **dewarp** pre-step and see how much it helps. This tells us how
   much the "binding" problem really costs and whether we need fine-tuning.

   *Tooling for this lives in `experiments/figure-segmentation/`* — a throwaway
   **Streamlit** app (CPU-only, `uv`-managed) that loads DocLayout-YOLO's
   DocStructBench checkpoint (its classes include both `figure` and
   `figure_caption`, so the caption join-key comes for free), runs it on a
   dropped page image, and shows boxed detections + each figure crop with its
   size/aspect-ratio. Phase split: **validate** (this spike) → **integrate** (wrap
   the winning model as a small local service `POST /api/extract` calls) →
   **render/store** (`figures[]` slot + `renderLatex` renders an image).
3. **In parallel, a tiny rendering/storage spike:** add a `figures[]` slot +
   make `renderLatex` render one PNG, end-to-end through LearnPage. De-risks
   question B independently of question A.

## Phase 1 findings (DocLayout-YOLO on real Knight phone photos)

First validation run, DocStructBench checkpoint, conf 0.20, imgsz 1024, CPU, on
four phone photos of physical Knight pages (`experiments/figure-segmentation/`):

| page | regions | figures | captions | note |
|------|---------|---------|----------|------|
| ...708 | 19 | 6 | 2 | mixed figures + MCQ text; 3 figures high-conf, 3 low (0.34–0.42) |
| ...144 | 48 | **11** | 9 | dense conceptual-questions page — all ~11 small diagrams cleanly boxed |
| ...166 | 44 | **11** | 5 | dense page — same, tight boxes per diagram |
| ...829 | 1 | **1** | 0 | **skewed/angled photo — recall collapsed** (several figures missed) |

**Verdict: the approach works, out of the box, no fine-tuning needed for a first
pass.** On reasonably flat photos DocLayout-YOLO separates even ~11 small
diagrams per dense page with tight, crop-ready boxes, and emits `figure_caption`
boxes next to most figures — confirming the **caption→"Figure P5.32" join key is
viable**.

**Confirmed caveat — skew kills recall.** The one photo shot at an angle (...829)
dropped to 1 figure of several. This is the predicted dewarp problem: **a
flatten/dewarp pre-step is the single highest-value addition** before inference.
(Screenshots from a PDF won't have this issue; phone photos of a physical book
will.)

**Minor:** low-confidence detections (0.34–0.42 on ...708) need a threshold
sweep / light verification to separate real figures from noise.

### Next steps off this finding
1. Add a **dewarp** pre-step (OpenCV page-rectification, or a doc-scanner model)
   and re-test ...829-style skewed shots.
2. Prototype **binding**: OCR each `figure_caption` box → parse "Figure P5.32" →
   attach the figure crop to that problem; VLM (Anthropic API) fallback when no
   caption.
3. Then move to phase 2 (wrap as a local service behind `POST /api/extract`).

## Dewarping the page (how it's really done)

Research survey of real-world document-rectification practice, against our
constraints (CPU-only small models; Anthropic vision API for hard cases).

**Reframe — for *figure detection*, rotation hurts far more than curl.** On the
RoDLA perturbation benchmark a layout model drops 93.7→83.3 mAP under *warping*,
→61.3 under *perspective/keystone*, but →39.0 under *rotation (5–15°)*. So:
- Page-**curl** flattening (the full warped-grid, pixel-to-pixel ideal) is mostly
  an **OCR** win, not a detection win — overkill for us unless figures sit on the
  spine.
- **Planar perspective correction is good enough** for figure detection; getting
  axis-alignment/rotation right matters most.
- ⚠️ **DocLayout-YOLO/Ultralytics applies NO perspective/rotation augmentation by
  default** (`perspective`, `degrees`, `shear` all 0.0). So tilt-robustness isn't
  free — but it's *cheaply trainable in*.

**Why our classical attempt failed (confirmed):** the OpenCV largest-quad recipe
keys off page-edge contrast — white-page-on-light-background has none, so it
fails by design. And `deskew`-style methods only estimate *in-plane rotation*,
which is why ours read ~0° on a *perspective*-tilted page. The classical methods
that survive no-edge-contrast are **text-line-driven** (your instinct): fit
text-line slopes → vanishing points → a perspective-correcting homography. No
page border needed.

**Your two instincts both check out — and the "ideal warped grid" already exists
off the shelf, so it's not a 2-week build:**
- *"detect text lines, fit an affine/perspective"* → the recommended **cheap**
  path (text-line vanishing-point homography), ~ms/page, no ML.
- *"warped grid, pixel-to-pixel"* → **UVDoc**: ~8M params, MIT repo /
  Apache-2.0 checkpoint, **already shipped in PaddleOCR as `TextImageUnwarping`**,
  CPU/ONNX. Best accuracy/effort with a permissive license. (The stronger academic
  models — DocTr/DocTr++/DocGeoNet/DocScanner, the `fh2019ustc` family — are
  **non-commercial-licensed**; avoid in product. `page-dewarp` (mzucker, MIT, pip)
  is the zero-ML classical curl+perspective option at seconds/page.)

**VLM (Claude) option:** fine as a *reader*/hard-case fallback (tolerates moderate
skew for text), but a **weak bounding-box detector** (Claude/GPT-4o localization
mAP is near-zero vs YOLO/DETR). Don't make it the primary figure-box detector;
if used for boxes, rasterize yourself to ≤1568 px long edge and ask for absolute
pixel coords.

### Recommended dewarp stack (cheapest viable first)
0. **(if we ever retrain) enable `perspective`/`degrees`/`shear` augmentation** in
   DocLayout-YOLO — directly attacks the tilt-recall drop, no inference-time cost.
1. **Text-line planar correction** (vanishing-point homography + residual deskew),
   `cv2.warpPerspective` as executor. ms/page, survives white-on-white.
2. **UVDoc** as a drop-in preprocessing step if (1) isn't enough — MIT/Apache,
   ~8M params, CPU, proven via PaddleOCR.
3. **Claude vision** strictly as a hard-case reader/fallback, never primary boxes.

### ✅ Validated end-to-end (UVDoc + auto-orient on the worst-case photo)

Ran it. On 829 (angled 2-page spread, the photo that gave **1** figure raw):

| stage | figures |
|-------|---------|
| original (any imgsz) | 1 |
| UVDoc dewarp, wrong orientation | 1 |
| **UVDoc dewarp + rotate to correct orientation** | **7** |

So the robust path works — **flatten → orient → detect recovered 7× recall** and
the crops are clean, captioned figures. Two concrete lessons:
- **UVDoc** (via the `py-reform` pip package, MIT, bundles the ~8M-param model,
  runs on our CPU) fixes the perspective — *but it can emit a 90°-rotated result*.
- **Orientation correction is therefore mandatory**, and rotation is the
  detector's worst enemy (matches the RoDLA finding). "Run detection at all 4
  rotations, keep the highest figure+caption confidence" is a cheap, reliable
  auto-orient — implemented in the spike app.

The validated pipeline is now in `experiments/figure-segmentation/app.py`:
**`py-reform`/UVDoc flatten → auto-orient (best of 4) → DocLayout-YOLO → crop.**

Caveat: 829 is a pathological capture (far, steep, 2-page spread); near-frontal
single-page shots (144/166) already gave 11/11 with no preprocessing. So the
dewarp path is the *rescue* for sloppy captures, not a requirement for good ones —
which keeps capture-side guidance (shoot one page, roughly straight) as the
cheapest first line of defense, with UVDoc behind it.

Sources: RoDLA benchmark (arxiv 2403.14442), UVDoc (github.com/tanguymagne/UVDoc,
huggingface.co/PaddlePaddle/UVDoc), page-dewarp (pypi.org/project/page-dewarp),
Dropbox doc-rectification (dropbox.tech/machine-learning/fast-document-rectification-and-enhancement),
Claude vision docs (platform.claude.com/docs/en/build-with-claude/vision).

## Figure image quality (glare / sheen)

Real issue on glossy textbook pages: not blown-out white pixels (a hard-white
threshold finds ~0%), but **soft specular sheen** — diagonal bright bands and
uneven gray backgrounds that wreck a cropped figure's quality. Since figures are
**line art (dark ink + a little color on white)**, this is the easy case to fix.

Ladder, cheapest first (demoed in the spike, `out/glare_fix_demo.png`):
1. **Flat-field background normalization** (recommended default): estimate the
   illumination field per channel (dilate to wipe ink → median/Gaussian blur),
   divide it out, renormalize. Flattens sheen, whitens paper, **preserves colored
   arrows**. Pure OpenCV, ~ms. Scanner-app "magic color". Fixes most cases.
2. **Conditional binarization** (Sauvola/adaptive) for *pure B&W* figures →
   pristine; auto-detect "is it colored?" and skip color figures so vectors stay.
3. **Targeted specular inpainting** for residual hard glare *bands* — detect the
   bright streak, `cv2.inpaint` / small highlight-removal net. Few crops only.
4. **Capture-side**: clip-on polarizer kills specular reflection optically;
   off-axis lighting helps. Best ROI if glare is common.

This is a **post-crop enhancement step**, independent of dewarp.

> **Conclusion after testing in the app: leave enhancement OFF by default — raw
> crops look best in general.** On clean captures (the majority) flat-field +
> quantize trade a small win on the few glary figures for visible artifacts
> (posterization, softening, slight color shifts) on the many good ones. So these
> are **opt-in rescues for the occasional bad figure, not an always-on pipeline** —
> same lesson as dewarp: good captures need no processing. Defaults flipped to off
> in the spike; a future product could apply them *selectively* to figures flagged
> glary/noisy.

**Refinements found while tuning (all in the spike app):**
- *Denoise:* the first flat-field used `absdiff + MINMAX` whose contrast stretch
  **amplified background noise**. Fix = flat-field by **division** (divide each
  channel by its illumination field) — background flattens to uniform white with
  no stretch, so no noise amplification — plus an edge-preserving **non-local-means
  denoise** for residual grain. Optional white-clip for a crisper paper-white.
- *Color quantization ("keep only meaningful colors"):* snap to a small palette
  (K≈6) → paper→one white, ink→one black, accents→flat hues. **Erases residual
  sheen/noise as a side effect**, fits the "few colors" nature of the figures, and
  yields a tiny indexed PNG (helps storage).
  - **Pick the most *different* colors, not the most *populous*.** Plain k-means is
    frequency/variance-driven — it splits near-white paper into shades before
    giving a rare accent (a lone red/green arrow at <1% of pixels) its own slot,
    so accents get lost. Instead: generate candidate colors with a fine k-means
    (each a real, denoised cluster), then **farthest-first selection in Lab** picks
    the K most perceptually-distinct → rare accent hues survive.
  - **Small frequency bias + floor** to avoid the opposite failure: pure
    farthest-first chases *outliers* (sparse anti-aliased text-edge fringe colors).
    Drop candidates below ~0.3% of pixels (kills fringe), and score selection by
    `distance × weight^0.35` so picks are distinct *and* not vanishingly rare. Real
    accents (a coherent arrow) clear the floor; edge fringe doesn't. (Implemented in
    the spike's `quantize`: `freq_bias`, `min_frac`.)

Recommended enhancement chain: **flat-field division + NL-means denoise → k-means
quantize (K≈6)**. Toggles + K slider live in the spike for tuning per book.

**How it's done in general (research — validates "raw is best, cleanup optional"):**
- *Archival/production practice keeps figures in grayscale/color and never
  binarizes/quantizes them* — FADGI/NARA treat bitonal as a derivative, not a
  master; **ScanTailor "Mixed mode"** keeps picture zones in color and binarizes
  only surrounding text. Our enhancement-off default mirrors this exactly.
- *Make cleanup a **gated, per-defect classical rescue*** that preserves color:
  background-division for glare → gentle bilateral/guided denoise for grain →
  contrast-stretch for faint. Decide *when* with cheap no-reference quality
  heuristics: **bright-clip ratio (glare), RMS contrast (faint), Laplacian
  variance (blur)** — only rescue crops that fail; pass clean ones through. (Same
  tools power the v2 "user plays with histogram/color settings" idea.)
- *Avoid generative cleanup for these figures* — binarization nets, super-res
  (Real-ESRGAN/waifu2x), and VLM redraw/vectorize all risk **inventing or altering
  strokes/labels** (disqualifying for physics diagrams). The one small commercially
  OK ML model (SauvolaNet, MIT, ~40K params) only yields *bitonal* — loses color.
  Faithful vectorization, if ever wanted, = classical tracing (VTracer/potrace).
- *Claude vision = verifier, not redrawer:* triage "does this need rescue?" and
  before/after "does the cleaned figure still match the original?" — never
  regenerate the figure.

- *Histogram equalization — evaluated and rejected.* Global HE amplifies the
  near-white background into noisy gray + color blotches (same failure mode as the
  min-max stretch) and drags in neighboring content. CLAHE-on-L is harmless but
  redundant — it lifts global contrast, which flat-field already does more cleanly;
  even as a pre-step it didn't beat the chain above. For a genuinely faint scan,
  use the `flatfield` white-clip levels, not HE.

## Phase 2 design — labelling, binding & import UX (product direction)

Decision: **the extraction quality is good enough to build the feature.** Scope:

**Cutting figures (user in control).**
- Auto-detected boxes (DocLayout-YOLO) are *proposals*. In the import/review UI
  the user can **adjust/resize/delete** a box and **add a new figure by drawing a
  box on the rectified page** (catches anything the model missed).
- Crops come from the rectified (dewarped+oriented) page.
- *v2:* let the user **play with histogram / color settings** per figure (the
  flat-field / quantize / levels tools we built, opt-in — defaults off since raw
  wins on clean captures).

**Figure labels + binding to problems (the core new problem).** A ladder, with
manual override as the floor:
1. **Caption key (cheap):** OCR each `figure_caption` box → parse "Figure P5.32" →
   match to the problem that references that label. Deterministic when present.
2. **Claude (Sonnet) matcher (primary for the rest):** feed the **full-page image +
   the set of cropped figures + the extracted problem texts**, ask it to pair each
   figure with its figure-label and owning problem. This is an *association/
   reasoning* task (not localization), which VLMs do well — and it's the user's
   proposed approach. Runs through the existing Anthropic provider.
3. **Positional fallback:** when caption/VLM are unsure, guess by spatial
   proximity of the figure box to problem text on the page.
4. **Manual override (always):** the user reviews and corrects figure↔problem
   pairings **before accepting the questions into the DB.**

**Where it slots in.** This extends the existing extraction flow rather than
replacing it: `POST /api/extract` already returns a problem delta reviewed in
ScanProblemsPage. Add figures to that contract (detect → rectify → crop → label →
bind) and add figure review (adjust boxes, add boxes, fix pairings) to the same
human-in-the-loop review screen before commit. Then phase 3 (storage + render):
`Question.figures[]` + `renderLatex` image support.

## Open questions

- Do we want figures as raster (faithful, simple) or trace simple line art to
  SVG (smaller, scalable, theme-able)? Probably raster baseline, SVG later.
- Where do persisted figures live — separate files vs. inline data URIs?
- How do we want the binding UX: fully automated, or a human-in-the-loop review
  step in ScanProblemsPage (like the existing extraction-delta review)?
- Copyright/licensing posture for storing verbatim textbook figures.
- **Test-sample caveat + a stability test idea.** Our 10-photo sample has one page
  shot 3× (128/123/623), so it's over-represented — don't let dupes skew aggregate
  metrics. Upside: those 3 identical-page shots are a built-in **repeatability
  test** for later — same page, different captures should yield stable figure
  counts/crops; measure the variance as a separate check.

## References

**Layout-detection models (the recommended route — work from page images):**
- [DocLayout-YOLO (opendatalab) — YOLO-v10 layout detection, HuggingFace demo](https://github.com/opendatalab/DocLayout-YOLO) · [paper](https://arxiv.org/pdf/2410.12628) · HF: `juliozhao/DocLayout-YOLO-DocStructBench`
- PP-DocLayout-L (PaddleOCR, RT-DETR) — 23 classes incl. separate figure/caption/title (caption box = join key)
- `hantian/yolo-doclaynet` — YOLO trained on DocLayNet (80k+ pages), `Picture` class
- [ScanBank — figure extraction from *scanned* documents (benchmark)](https://arxiv.org/pdf/2106.15320)

**PDF-structure tools (NOT used — require born-digital PDF, which we don't assume; kept for reference):**
- [PDFFigures 2.0 (IEEE)](https://ieeexplore.ieee.org/document/7559577/) · [figure-extractor Flask service](https://github.com/Huang-lab/figure-extractor) · [deepfigures-open (AllenAI)](https://github.com/allenai/deepfigures-open)
