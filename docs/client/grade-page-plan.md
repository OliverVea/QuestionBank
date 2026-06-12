# Grade Page — Component Breakdown (revised)

Step 6 in the build order: **Learn — grading** (`docs/mocks/grade.html`).

## Summary

A chat-based grading screen. The user submits their answer (photo transcription or typed text), the LLM grades it turn-by-turn, and the user can clarify or accept a final grade. Navigated to from `LearnPage` via `#/grade?questionId={id}&mode={photo|type}`.

## Shared chat components (extract from ScanProblemsPage)

The grade page and scan-problems page share the same chat scaffolding. Extract these as shared components in `src/components/`:

### 1. `ChatContainer` — the scrollable message area
A styled `<main>` with vertical flex, gap, overflow-y auto, and a `scrollToBottom()` utility. Both pages mount messages into it.

### 2. `ChatBubble` — base message bubble
Takes `kind: 'user' | 'agent'` + child content. Handles alignment (user right, agent left), background tint, border-radius, shadow. Children are whatever the page wants inside.

### 3. `ReplyRow` — the textarea + send button pill
Auto-growing textarea, fused send button, Enter-to-send / Shift+Enter for newline. Takes an `onSend(text: string)` callback. Already exists in ScanProblemsPage as `.sp-reply-row` — extract and generalize.

### 4. `ThinkingBubble` — the dots animation
The "Reading the page..." / thinking indicator. Returns the element so the caller can `.remove()` it when the response arrives.

## Grade-page-specific components (new, inlined in GradePage.ts)

### 5. `QuestionFold`
Collapsible `<details>` showing the question eyebrow (book title + label) in the summary, and the full LaTeX body when open. Starts closed. The mock calls this `.qfold`.

### 6. Grade badge + issue list + reasoning (grader bubble content)
Rendered inline: a colored capsule for the grade, severity-tagged issue list with LaTeX descriptions, and a collapsible "Show reasoning" details block. These are grade-page-specific (they render grading API responses).

## Page composition (`GradePage`)

```
┌─────────────────────────────────┐
│ TopBar (← Back  |  Skip 12h)   │
├─────────────────────────────────┤
│ QuestionFold (collapsed)        │
├─────────────────────────────────┤
│ ChatContainer (gridpad bg)      │
│   ChatBubble(user) — answer     │
│   ChatBubble(agent) — grading   │
│   ChatBubble(user) — clarify    │
│   ...                           │
├─────────────────────────────────┤
│ ReplyRow                        │
│ [Incorrect] [Partial] [Correct] │
└─────────────────────────────────┘
```

## Data flow

1. **Page load** — parse `questionId` and `mode` from URL params.
2. **Fetch question** — `GET /api/questions/{questionId}` to get `canonicalText`, `label`, `bookId`; then `GET /api/books/{bookId}` for book title.
3. **Initial answer acquisition**:
   - `mode=photo`: GradePage shows its own file input (camera picker) inline in the chat → upload image → `POST /api/questions/{id}/transcribe` → show transcription in a user bubble for confirmation → on confirm, trigger grading.
   - `mode=type`: ReplyRow focused, send creates first user turn → trigger grading.
4. **Grading turn** — after each user message, `POST /api/questions/{id}/grade` with the full `conversation` array. Show ThinkingBubble while waiting. On response, render grader bubble (badge + issues + reasoning). On failure, show inline error with retry.
5. **Clarify** — user types a follow-up in ReplyRow → append user bubble → re-grade (repeat step 4).
6. **Save** — user taps one of the three grade buttons (Incorrect/Partial/Correct) → `POST /api/questions/{id}/attempts` with `{ answer, recommendedGrade, rating, issues }` → navigate to `#/learn`. On failure, show error inline, don't navigate.
7. **Skip** — navigate to `#/learn`.

## Suggested grade highlighting

The last grader turn's `recommendedGrade` is reflected on the grade buttons: the matching button gets a `.suggested` class with a "Suggested" capsule below it (as in the mock).

## Refactoring ScanProblemsPage

After extracting the shared components, ScanProblemsPage shrinks — it imports `ChatContainer`, `ChatBubble`, `ReplyRow`, `ThinkingBubble` instead of building them inline. This is a refactor of existing code, not a behavioral change.

## CSS plan

- Shared chat component styles: `ChatContainer.css`, `ChatBubble.css`, `ReplyRow.css` (extracted from ScanProblemsPage.css).
- `GradePage.css` — page grid layout + grade-specific styles (grade badge, issue list, reasoning fold, grade buttons, question fold).
- Reuse `gridpad.css` for the engineering-paper background on the chat area.

## File plan

```
# New shared components (extracted from ScanProblemsPage)
client/src/components/ChatContainer.ts + .css
client/src/components/ChatBubble.ts + .css
client/src/components/ReplyRow.ts + .css
client/src/components/ThinkingBubble.ts + .css

# Grade page
client/src/pages/GradePage.ts + .css
client/src/main.ts (add /grade route)

# Refactor
client/src/pages/ScanProblemsPage.ts (import shared components)
client/src/pages/ScanProblemsPage.css (remove extracted styles)
```

## Server changes

None needed. All required endpoints already exist.
