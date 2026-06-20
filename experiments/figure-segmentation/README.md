# Figure-segmentation spike (phase 1: validate)

Throwaway tooling to answer one question: **can a small, self-hostable
document-layout model segment the figures out of physics-textbook pages well
enough to crop and attach them to problems?**

This is **not** part of the QuestionBank app (which is TypeScript). It's a
Python/Streamlit scratch tool. See the design context in
`../../docs/investigations/figure-extraction.md`.

## What it does

Loads **DocLayout-YOLO** (DocStructBench checkpoint, pulled from HuggingFace),
runs it on a textbook page image, and shows:

- the page with detected regions boxed (red = figure, green = caption, blue = other),
- a table of every region with confidence + width/height/aspect-ratio,
- each **figure crop** on its own, sized and AR-labelled — i.e. exactly what
  we'd attach to a problem.

The DocStructBench classes include both `figure` and `figure_caption`, so we can
also see whether the caption box (our figure→"Figure P5.32"→problem join key) is
detected.

## Setup & run

```bash
cd experiments/figure-segmentation
uv sync                      # creates .venv and installs deps (CPU torch)
uv run streamlit run app.py --server.address 0.0.0.0 --server.port 8601
```

Then open **http://bulwark-m2:8601**.

CPU-only is fine — no GPU needed for validation.

## Test images

Drop page images into `./samples/` (any png/jpg/webp; subfolders ok). To exercise
the hard cases, aim for:

- the dense page with ~8 figures (recall test),
- a very tall and a very wide figure (aspect-ratio test),
- the **same** page as a clean PDF screenshot **and** a phone photo (tells us how
  much a dewarp pre-step matters).

`samples/` is gitignored — textbook pages don't go in the repo.

## What we're looking for

- **Recall:** are all figures on the page found?
- **Precision:** are the boxes tight enough to crop cleanly (no cut-off labels,
  no merging two figures)?
- **Captions:** is `figure_caption` reliably detected next to each figure?
- **Photo robustness:** how much worse on a phone photo vs a clean screenshot?

Findings get written back into `docs/investigations/figure-extraction.md`.
