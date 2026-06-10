# AGENTS.md — mocks

Guidance for agents working on the UI mocks in `docs/mocks/`. These are
static HTML/CSS/JS prototypes of screens, used to design before building the
real client. See the repo-root `AGENTS.md` for project-wide rules.

## Treat this as a small CSS library — don't copy-paste

`mocks.css` is the **shared stylesheet** for every mock. Before adding styles
for a new screen:

1. **Read the existing CSS first** — `mocks.css` and every `*-screen.css` /
   per-screen stylesheet already present. Know what's there before writing.
2. **Reuse what exists.** If a component (banner, card, list row, pill, press
   feedback) already fits, use its class — don't restyle from scratch.
3. **Lift reusable components up.** When two or more mocks need the same
   visual pattern, **promote it into `mocks.css`** under a documented class
   and use it from each screen. Keep only genuinely screen-specific layout in
   the per-screen file.
4. **Use the design tokens.** Colors, etc. come from the `:root` variables in
   `mocks.css` (`--fg`, `--muted`, `--border`, `--revisit`, `--learn`, …).
   Don't hard-code hex values that duplicate a token — add a token if one is
   missing.

The goal: a growing, consistent little component library, not N divergent
copies of the same button.

### JS: keep it inline and disposable

The same "lift it up" instinct applies far less to JavaScript here. These are
**mocks** — most of their JS is per-screen demo data and throwaway stubs
(`alert('→ open book')`), and real interaction logic belongs in the actual
client, not a polished mock helper. So keep mock JS **inline and disposable**;
don't build a shared interactivity library pre-emptively. The one exception is
genuinely cross-page chrome — like `footer.js` — which earned a shared file
because it repeats on every page. If another truly reusable interactive
pattern shows up across multiple mocks, lift it into a shared script the same
way; otherwise, leave it inline.

### What currently lives in `mocks.css` (shared)

- **Design tokens** — `:root` color variables (base + `--revisit`/`--learn`
  accents and their `-dark` variants).
- **Base reset** — `box-sizing`, full-height `html/body`, base typography.

Screen-specific layout (the `.app` shell, `.banner`, `.book` rows, etc.)
lives in `single-screen.css` (the home screen's stylesheet). If you find
yourself reaching for one of those on a *second* screen, that's the signal to
lift it into `mocks.css`.

## Phone-first

These mocks are **primarily for phone use**. Design mobile-first:

- Touch-sized tap targets; thumb-reachable actions; single-column layouts.
- Provide **`:active` press feedback** — it's the real cue on touch.
- Gate hover effects behind `@media (hover: hover)` so they don't stick after
  a tap on touchscreens. Treat hover as desktop-only enhancement.
- Use `100dvh` for full-height shells and `env(safe-area-inset-*)` for fixed
  elements near screen edges.

## Served by a tiny static server

Mocks are served over http, **not** opened from `file://`. Run them with:

```
npm run mocks      # serves docs/mocks at http://localhost:4173 (+ LAN via --host)
```

(`sirv-cli`, a zero-config static server.) For installing the PWA on a phone
(needs a trusted-HTTPS origin), expose the local server over your tailnet with
`tailscale serve --bg --https=443 http://localhost:4173` — that gives a real
Let's Encrypt cert, no self-signed-cert trusting needed.

Because there's a real origin:

- **`fetch()` of local files works** — mocks may read served data/assets
  directly. The old `file://` CORS workarounds are no longer needed.
- **Vendor heavy assets locally** rather than hot-linking a CDN, so mocks work
  offline. KaTeX is vendored under `vendor/katex/` (copied from the repo's
  `katex` dependency); reference `vendor/katex/katex.min.css` + `.min.js`.
- Shared cross-page chrome can be injected with a shared script (see
  `footer.js`, which applies the `?anim=` load-in style on every page).
- External assets that need the network (e.g. Open Library covers) must still
  degrade gracefully offline.

## Navigation

The mocks form a navigable flow, not a gallery. `index.html` is the home
screen (the library) and the default landing page the server serves at `/`.
From there: the Revisit/Learn banners open `learn.html`; the add-a-book footer
row opens `add-book.html`; the library-header pencil opens `manage-books.html`;
tapping a row in `manage-books.html` opens `edit-book.html?isbn=NNN`;
in `edit-book.html` the "Scan a problems page" button opens the OS camera/photo
picker and then hands off to `scan-problems.html?isbn=NNN` (the chosen photo is
passed via `sessionStorage`); `scan-problems.html` → back to `edit-book.html`
on "Add to book" (accepted problems handed back via `sessionStorage`);
`learn.html` → `grade.html` on upload; Back/back actions return to the previous
screen. Wire new screens into this flow with
plain `window.location.href` links (real interaction logic belongs in the
client, not the mock).

## Skeleton-first, navigable-first

**Always start a new screen as a navigable skeleton.** The first
implementation step for any new mock is a bare screen (chrome + layout
placeholders, no real interactivity) that is already **reachable from the
screen that leads to it** via a real `window.location.href` link. Land that
first; flesh out behavior in later steps.

Why: it keeps the flow walkable at every step, surfaces navigation/layout
problems before logic is built on top of them, and gives a real thing to look
at on a narrow viewport early.

## Installable (PWA)

The mocks are an installable PWA so the app can be added to a home screen and
run **fullscreen** (no browser or OS status-bar chrome). `manifest.webmanifest`
(`display: fullscreen` with a `standalone` fallback via `display_override`,
brand theme color, `icon.svg` + `icon-maskable.svg`) is linked from every
page's `<head>`, alongside `theme-color` and the `apple-mobile-web-app-*` meta
tags (iOS ignores the manifest `display`, so `apple-mobile-web-app-capable` +
`status-bar-style: black-translucent` drive the fullscreen feel there). The
viewport uses `viewport-fit=cover` so `env(safe-area-inset-*)` works on
notched/fullscreen displays. New mocks should copy the same `<head>` block.

**Note:** `display` mode only applies to the *installed* app (Add to Home
Screen → launch from the icon) — in a normal browser tab you'll still see
browser chrome no matter what.

## Adding a new mock

1. Create `<name>.html`; link `mocks.css` first, then a `<name>.css` for
   screen-specific layout.
2. **Skeleton first:** ship the bare, navigable screen wired into the flow
   (see **Skeleton-first, navigable-first** and **Navigation**) before any
   real interaction logic.
3. Reuse shared components; lift anything reusable into `mocks.css`.
4. Add `<script src="footer.js" defer></script>` before `</body>` so the
   load-in animation switch applies.
5. Run `npm run mocks` and check it on a narrow viewport before calling it done.
