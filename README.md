# Question Bank

A question bank for books. Client-side app backed by a small server.

## What this is

A self-study question bank for working through physics and math textbooks. It solves two problems:

**1. Grading handwritten solutions.** Capture questions from a textbook (photo or text), then submit a handwritten solution and get LLM-assisted feedback. The flow separates concerns deliberately: one agent faithfully transcribes your answer to LaTeX (blind to the problem, no hints), a second agent critiques the transcribed answer and suggests a rating, and you set the final rating (DNM / partial / full).

**2. Retaining understanding.** A spaced-repetition system resurfaces questions over time (1 week, then 1 month) so the material sticks, prioritizing weaker results.

### Principles

- **Server-side LLM.** The server runs 24/7 and shells out to the local Claude Code CLI, so no per-client auth is needed. The LLM layer is modular — swappable for the Anthropic API, Bedrock, or a self-hosted model.
- **History is immutable.** Review outcomes are an append-only log; scheduling is derived from it, so the algorithm can evolve without data migrations.
- **Framework-free.** Express on the server, vanilla TypeScript on the client. Reachable from PC and mobile.

## Stack

- **Server:** Node + Express (TypeScript, ESM)
- **Client:** Vanilla TypeScript + Vite
- **Storage:** JSON files on disk (under `./data/`)
- **Tests:** Vitest
- **Layout:** npm workspaces — `packages/server`, `packages/client`

The goal is to stay close to framework-free. Express is the one concession on the server; the client is plain TypeScript against the DOM.

## Requirements

- Node.js >= 20
- npm >= 10

## Getting started

```bash
npm install
npm run dev
```

This starts:

- Server on http://localhost:3001 (health check at `/api/health`)
- Client on http://localhost:5173 (proxies `/api/*` to the server)

Open http://localhost:5173 — the page should show `Server status: ok`.

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Run server and client together in watch mode  |
| `npm run build`    | Type-check and build both packages            |
| `npm run typecheck`| Type-check the whole project                  |
| `npm test`         | Run tests with Vitest                         |

## Layout

```
packages/
  server/   Express API
  client/   Vite + vanilla TS frontend
data/       JSON storage (gitignored)
```
