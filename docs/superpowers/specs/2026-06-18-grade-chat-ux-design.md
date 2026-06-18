# Grade Chat UX Pass — Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorming completed; mock walkthrough pending — mocks are part of this work).
**Backs:** TODO 3g (edit a chat message + revert/regrade), plus a broader UX quality pass of the grading chat requested directly.
**Mocks:** `docs/mocks/grade.html` (+ `grade.css`) and `docs/mocks/scan-problems.html` — to be **resynced then extended** as part of this work (see Mock Strategy).

## Goal

Raise the quality of the grading chat (`GradePage`) across five concrete pain points,
and do it on shared chat primitives so the scan/ingestion flow (`ScanProblemsPage`) gets
the same baseline UX. The five changes:

1. **Edit & revert (3g)** — edit an earlier *user* message; doing so truncates everything
   after it and regrades from that point.
2. **Scroll position** — the chat currently lands you "way off screen" (past a long grader
   reply, into empty space). Open at the top; when a grader reply arrives, land on the
   **top** of that reply; keep the bottom in view for your own messages. Also fix the
   content area being taller than the posted messages.
3. **Compose while busy** — let the user draft a message while a grade is in flight. The
   textarea stays editable; only the send button locks until the response lands.
4. **Transcription review turn** — in the photo flow, don't auto-grade the transcription.
   Surface it first in an editable review checkpoint.
5. **Editable transcription** — that review checkpoint is directly editable before grading;
   later corrections reuse the same inline edit as (1).

## Resolved decisions

- **Architecture = render-from-state** (chosen over imperative DOM surgery and over pulling
  in a framework). `conversation` becomes the single source of truth; one `render()`
  rebuilds the message list from it. Edit/revert, retry, and the review→grade handoff all
  reduce to "mutate the model → `render()`" — no array/DOM sync, no special cases.
- **Compose-while-busy = type-only.** Textarea stays live; send disabled until the in-flight
  grade returns. No queue, no concurrent grade requests (rejected: queue-and-auto-send,
  and fire-overlapping-requests — both add ordering/race complexity for little gain).
- **Transcription review = a dedicated review panel** (not an inline editable bubble): an
  editable textarea pre-filled with the transcription + a "Looks good, grade" button, shown
  above the reply row. It appears only in the photo flow, only the first time. After confirm,
  the text becomes a normal (inline-editable) user turn.
- **Edit scope = user messages only.** Grader bubbles are read-only. Editing a user turn
  **discards** all downstream turns (matches 3g "revert the conversation to that point").
  Full-transcript retention for the Attempt record is out of scope (that is TODO 3b).
- **Shared primitives across Grade + Scan**, page-specific behavior stays separate. Scan
  adopts the upgraded primitives (scroll/sizing/compose/photo) but keeps its own
  envelope/card/`needsSection` interaction and its `sp-superseded` logic.
- **Zero server changes.** Edit/revert re-POSTs the existing `/grade`; the review panel only
  *delays* the existing transcribe→grade handoff; compose/scroll are client-only. The grade,
  transcribe, attempt, and skip endpoints are untouched, so `api-uat.test.ts` stays green.

## Architecture

`conversation` is the source of truth; the DOM is only ever produced by `render()` reading
the model. **Invariant:** no code path mutates a bubble node after creating it, and all
mutations go through `conversation.ts`. This is what keeps every feature's logic trivial.

Full re-render (clear + rebuild) is chosen over diffing: grading conversations are a handful
of turns, so rebuilding is simple and fast and avoids the array/DOM-sync bug class. Transient
overlays (the thinking bubble, the photo-capture picker, the transcription review panel) are
appended *after* `render()` as ephemeral nodes and cleared on the next `render()`; they are
not part of the model.

## Module breakdown

A pure model, dumb render functions (data → DOM, no fetch/state), and a thin orchestrator.

### Shared primitives (Grade + Scan both consume)

| Unit | Responsibility | Interface |
|------|----------------|-----------|
| `ChatContainer.ts` (extend) | Scroll + sizing. | add `scrollToTop()`, `scrollToNode(el)` (top-align a node in view), `clear()` |
| `ReplyRow.ts` (extend) | Compose-while-busy. | replace `disable()/enable()` with `setSending(busy)` — disables the send button only; textarea stays editable |
| `PhotoBubble.ts` (new) | Photo thumbnails as a user bubble (unifies grade `photo-bubble` + scan `sp-photo`). | `PhotoBubble(files, { notes? }) → HTMLElement` |
| `ThinkingBubble.ts` (extend) | Mutable label (folds in scan's `setThinkingLabel`). | add `setLabel(text)` method/handle |

### Grade-specific

| Unit | Responsibility | Interface |
|------|----------------|-----------|
| `conversation.ts` (new) | Source-of-truth model. Pure — no DOM, no fetch. **Unit-test target.** | `addUser(text) → id`, `addAssistant(payload)`, `editUserTurn(id, text)` (rewrite + truncate everything after), `truncateAfter(id)`, `turns`, `firstAnswer`, `toApiPayload()` |
| `grade-api.ts` (new) | All grade-page network; typed returns, throws on failure. | `grade(qId, payload)`, `transcribe(qId, files, notes)`, `saveAttempt(...)`, `skip(qId)` |
| `GraderBubble.ts` (new) | Grader payload → bubble DOM (badge/issues/reasoning). Extracted from `renderGraderBubble`. | `GraderBubble(payload) → HTMLElement` |
| `UserBubble.ts` (new) | User turn → bubble DOM, with an edit affordance. | `UserBubble(turn, { editable, onEdit }) → HTMLElement` |
| `TranscriptionReview.ts` (new) | Pre-grade review panel: editable textarea + "Looks good, grade". | `TranscriptionReview({ text, onConfirm }) → handle` |
| `GradePage.ts` (slim orchestrator) | Owns `state`, one `render()` that rebuilds from the model and sets scroll/compose/grade-row, plus flow functions (`handleUserMessage`, `doGrade`, photo flow) that call `grade-api` then `render()`. | route export |

`Turn` gains a stable `id` (for keying/edit), keeps `role`/`text`; assistant turns store the
parsed grader payload (not a `JSON.stringify`'d string) so re-render doesn't re-parse.

## Feature behavior

**Edit & revert (3g).** Each user bubble carries an edit affordance, shown only when not
mid-grade. Tapping swaps the bubble body for a pre-filled textarea with Save/Cancel. Save →
`conversation.editUserTurn(id, text)` (rewrites that turn, truncates all turns after it) →
`render()` (downstream bubbles vanish) → `doGrade()` re-runs from the new tail. `firstAnswer`
recomputes from turn 0. Grader bubbles never editable.

**Scroll.** Three rules in `ChatContainer`: (a) on open, scroll to top; (b) after a *user*
message is appended, keep the bottom in view; (c) when a *grader* reply lands, `scrollToNode`
the **top** of that bubble so it reads from the start. The **content-sizing** fix (chat area
taller than its messages → you start scrolled into empty space) is implemented alongside and
**shown to the user to confirm visually** before finalizing — it was explicitly flagged as
needing a look. Likely root cause: `.grade-page` grid `1fr` chat row + `scrollTop =
scrollHeight` dropping you below a long reply; verify against the mock.

**Compose while busy.** `reply.setSending(true)` on grade/transcribe start — textarea stays
editable so the user can draft; only send locks. `setSending(false)` when the response lands.

**Transcription review (photo flow only).** After `transcribe` returns, do **not** auto-grade.
Render the photo thumbnails as a `PhotoBubble`, then show `TranscriptionReview` above the
reply row (editable textarea pre-filled with the transcription, "Looks good, grade" button,
confirm disabled while empty). On confirm: `conversation.addUser(editedText)` → `render()`
(it becomes a normal, inline-editable user turn) → `doGrade()`. The panel is the first-time
checkpoint; later corrections use the inline edit from 3g. Typed-answer mode is unchanged.

## Error handling

- Grade fails → error bubble; last user turn stays put; retry = re-send or edit-and-regrade.
- Transcribe fails → "Try typing your answer instead" error; reply row re-enabled.
- Save fails → "Failed to save. Try again."
- Edit affordance hidden while a grade is in flight (`setSending`) so edit and grade can't race.
- Review panel rejects empty transcription (confirm disabled until non-empty).

## Mock strategy

`docs/mocks/` are static HTML/CSS/JS design prototypes built/approved **before** the real
client (see `docs/mocks/AGENTS.md`). The grade/scan mocks have drifted from prod, so:

1. **Resync commit — "mock = today's prod, no new design."** Align the mock's class
   vocabulary to prod's current names (`chat`/`msg`/`badge` → `chat-container`/`chat-bubble`/
   `grade-badge`), port the photo→transcribe flow into `grade.html`, reflect the real Skip
   (`12h` sub-label). Pure catch-up. **Prod behavior wins** where mock and prod disagree.
2. **New-UX commit — layer the five changes** onto the resynced mock (edit/revert,
   transcription review panel, compose-while-busy, scroll + sizing fix, shared `PhotoBubble`).
   This is the artifact the user eyeballs and approves.
3. **Then implement** the real components to match the approved mock — a near 1:1 port since
   the vocabulary now lines up.

Rejected: delete-and-rewrite-from-prod (throws away reusable scaffolding — PWA `<head>`, the
`learn.html ↔ grade.html` nav wiring, `footer.js`, the vendored-KaTeX renderer, the demo
conversation, `mocks.css` tokens — and would drag prod-only `fetch`/`FormData`/XHR complexity
into mocks that AGENTS.md says stay inline/disposable). Also rejected: skip mocks entirely
(loses the cheap design-iteration surface and the visual confirm for the sizing fix).

Principle: **prod is the source of truth for current behavior; the mock is the source of
truth for intended design.** Resync closes the behavior gap; then the mock leads on new design.

## Testing

- `conversation.ts` — real vitest unit coverage (pure, no DOM): `editUserTurn` truncation,
  `toApiPayload`, `firstAnswer` recompute, add/assistant ordering.
- `GraderBubble` / `UserBubble` / `TranscriptionReview` — light jsdom render smoke tests
  (correct data → expected nodes).
- Scroll behavior — not unit-tested (jsdom has no layout); verified via the **mock visual
  check**, which doubles as the human-in-the-loop confirmation of the sizing fix.
- `api-uat.test.ts` — unchanged and untouched (no server changes).

## Out of scope

- Persisting the full critique transcript on the Attempt (TODO 3b) — edit/revert *discards*
  downstream turns here.
- Migrating `ScanProblemsPage` to the render-from-state model — it adopts the shared
  primitives only; its scanning behavior and `sp-superseded` logic are unchanged.
- Any server-side change.
- Streaming token-by-token grader output (grading is a single JSON response today).
