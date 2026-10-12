# Assumptions

These are the foundational assumptions of the app as a whole — every feature is designed within them.

**What we require of the user:**

1. **A book** — physical or PDF. Either way the user can produce **page images** (photos of a physical page, or screenshots/exports of a PDF). Images are the universal input; we never assume access to PDF internals or any particular file format.
2. **An Anthropic API key** — the only credential/compute we require of the user (ideally something the app eventually provides, so users don't each supply their own).

**What we (the operator) can run:**

- **Normal, non-heavy infrastructure.** We can host conventional services and **small ML models** (e.g. YOLO-class document-layout detectors, CPU-friendly). We **cannot** host billion-parameter models. Any heavyweight vision/reasoning therefore goes through the **Anthropic API**, not a self-hosted model.
