# LearnPage — Component Breakdown

Build order step 5: the "view question" screen. The student sees the next due
question rendered with LaTeX, and chooses to photograph or type their solution
(both route to the grade page).

## API dependency

The server already provides:
- `GET /api/learn/next` → `{ question: Question, book: Book }` or `{ question: null }`
- The response includes `question.canonicalText` (LaTeX-mixed) and `book.title`/`book.author`.

No new server endpoints are needed. The mock's "Skip 12h" was a snooze API that
no longer exists (removed per `learn-next.ts` comment: "skip/snooze are gone —
Skip is client-only"). The real Skip simply advances to the next un-attempted
question, which means re-fetching `/api/learn/next` after the page skips one.
But since learn-next returns the *first* un-attempted question globally, skipping
requires either:
- A client-side "skipped this session" set (ephemeral, resets on page leave), or
- We drop Skip entirely for now and just show the next question.

**Decision:** Keep Skip as a client-side session skip. Maintain a `Set<string>`
of skipped question IDs in the page closure; on Skip, add the current ID and
re-fetch. If the fetched question is in the skipped set, advance again. This
matches the mock's spirit without needing server changes.

Actually, re-reading learn-next.ts: it returns the first *un-attempted* question.
Skip doesn't mark it attempted — so re-fetching gives the same question.
Therefore client-side skip needs a local exclusion list to filter the response.
Simpler alternative: fetch *all* candidates and iterate locally. But learn-next
returns only one. So we need a small server change OR a client workaround.

**Revised decision:** Add an optional `?exclude=id1,id2` query param to
`GET /api/learn/next` so the client can pass skipped IDs. This is minimal (3
lines of server code) and avoids fetching the entire question corpus client-side.

Note: the exclude list is ephemeral (lives in the page closure). If the user
navigates away and back, skipped questions reappear. This is intentional — skip
is "not now" not "never."

## Components needed

### 1. `QuestionCard` (new)

The rendered question body — a card with LaTeX content.

```ts
interface QuestionCardProps {
  canonicalText: string;
}
function QuestionCard(props: QuestionCardProps): HTMLElement
```

Uses `renderLatex` from `lib/latex.ts` to render the question into a styled
`.qbody` card. The card includes overflow-x scrolling for wide display math.

This is a pure render component with no interactivity. KaTeX's `throwOnError:
false` (already set in renderLatex) renders broken math as red text rather than
throwing — so no additional error boundary is needed at the card level.

### 2. Reused: `TopBar`

Back button (left) → navigates to landing (`#/`).
Right slot: Skip button (advances to next question).

### 3. `LearnPage` (new page)

The page function that composes everything.

## Page composition

```
┌─────────────────────────────────┐
│ TopBar: [← Back]     [Skip 12h] │
├─────────────────────────────────┤
│ Eyebrow: "Book Title · Problem X"│
│ ─────────────────────────────── │
│                                  │
│    ┌──────────────────────┐     │
│    │   QuestionCard        │     │
│    │   (rendered LaTeX)    │     │
│    └──────────────────────┘     │
│         (scrolls if tall)       │
│                                  │
├─────────────────────────────────┤
│  [📷 Upload picture of solution] │
│     or type it instead           │
└─────────────────────────────────┘
```

Grid layout: `grid-template-rows: auto 1fr auto` (topbar / stage / actions).

### Stage area

- `.learn-stage` with `.gridpad` (engineering-pad background)
- Eyebrow: `"{book.title} · {question.label}"` — pinned, non-scrolling
- `.qscroll` wrapper: flex with `justify-content: safe center` so short
  questions are vertically centered, tall ones scroll from top
- Inside: `QuestionCard` renders the question

### Actions footer

- Primary button: "Upload picture of solution" (green, camera icon) → `#/grade?questionId={id}&mode=photo`
- Secondary link: "or type it instead" → `#/grade?questionId={id}&mode=type`

(The grade page doesn't exist yet, so these routes will 404 for now. That's fine;
it's next in the build order.)

### Empty state

When `GET /api/learn/next` returns `{ question: null }`:
- Show a centered message: "All caught up! No new questions to learn."
- Hide the actions footer
- Back button still works

### Skip behavior

- Skip button in the TopBar right slot
- On click: add current question ID to the ephemeral skipped set, fetch
  `/api/learn/next?exclude=id1,id2,...`
- If the response is null or the returned question is already skipped (race
  condition), show the empty state
- Transition: brief fade or instant swap (match the mock's behavior: instant)

## Key interactions

1. **Page load** → fetch `/api/learn/next` → render or show empty state
2. **Skip** → add to excluded set → re-fetch with `?exclude=...` → render next or empty
3. **Upload/Type** → navigate to `#/grade?questionId={id}&mode={photo|type}`
4. **Back** → navigate to `#/`

## File plan

```
client:
  src/components/QuestionCard.ts    (new)
  src/components/QuestionCard.css   (new)
  src/pages/LearnPage.ts            (new)
  src/pages/LearnPage.css           (new)
  src/styles/gridpad.css            (new — ported from mocks.css, shared)
  src/main.ts                       (add /learn route)

server:
  src/routes/learn.ts               (add ?exclude param to /next)
  src/services/learn-next.ts        (accept excludeIds param)
```

## CSS notes

- `.learn-stage` / `.qscroll` / `.qbody` styling ported from `learn.css` mock
- `.learn-actions` / `.solution-btn` / `.type-link` ported from `learn.css` mock
- `.qbody-display` for wide math horizontal scroll
- Cascade animation (`animate-in` with `--i`) on the question card entry
- `gridpad` class: the pseudo-element engineering-paper background from
  `mocks.css` is NOT yet in the real client. Port `.gridpad` + `.gridpad::before`
  rules into a new `src/styles/gridpad.css` (imported by LearnPage). This keeps
  it available for the grade page too (which also uses gridpad in the mock).

## Error handling

- `GET /api/learn/next` network failure: show a retry-able error state (message +
  "Try again" button). No toast — the whole page is the error.
- Empty response (`{ question: null }`): show empty state as described above.
- LaTeX rendering: KaTeX's `throwOnError: false` renders broken math as red
  fallback text. No additional handling needed at the component level.
