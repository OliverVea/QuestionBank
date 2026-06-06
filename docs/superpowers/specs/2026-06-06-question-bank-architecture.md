# Question Bank — System Architecture

**Status:** Approved design (overview). Durable big-picture reference for the whole system.
**Date:** 2026-06-06

This document describes the system as a whole. Each sub-project (foundation/registration, grading, spaced repetition) gets its own dated spec that references this one.

## Purpose

A self-study question bank for working through physics and math textbooks. It solves two problems:

1. **Grading handwritten solutions.** Capture questions from a textbook, submit a handwritten solution, and get LLM-assisted feedback ending in a rating (DNM / partial / full).
2. **Retaining understanding.** A spaced-repetition system resurfaces questions over time so the material sticks.

## Deployment shape

A single Node/Express server runs 24/7 on the user's server machine, which has the Claude Code CLI installed. PC and mobile reach it as responsive browser clients over the user's VPN.

There is no per-client LLM auth: the **server** shells out to the Claude Code CLI, so "use my Claude subscription" is satisfied server-side and clients stay thin. Mobile vs. PC is purely responsive layout.

Assume a **single server instance** that owns its storage exclusively — no concurrent writers.

## Layers

### Storage layer

- JSON files on disk under `data/`, thin and swappable (SQLite/SQL/DDB/S3-ready later).
- **In-memory working set:** load everything on startup; reads serve from memory; writes update memory and **write through** to disk so a restart recovers the latest state.
- Exposed behind a typed **repository interface** so the JSON-ness stays hidden:

  ```
  interface Repository<T> {
    getAll(): T[]
    getById(id): T | undefined
    create(entity): T
    update(id, patch): T
    delete(id): void
  }
  ```

  Concrete repos per entity (`books`, `chapters`, `questions`, …). Cross-cutting queries (e.g. "all questions due today across every book") are plain filters over `getAll()` in the service layer above.

- **Backups are first-class** in the storage abstraction — not a hidden JSON detail. Any backend must answer "how do I snapshot and restore?":

  ```
  interface BackupStore {
    create(): Promise<BackupId>       // snapshot current state
    list(): Promise<BackupMeta[]>     // [{ id, createdAt, ... }]
    load(id): Promise<void>           // restore state from a backup
    delete(id): Promise<void>
  }
  ```

  - **Scope: everything** — all JSON data files *and* `data/images/`. A backup is a complete, self-contained, coherent snapshot.
  - **JSON implementation:** `create()` copies data files + images into `data/.backups/<timestamp>/`; `list()` reads that directory; `load()` copies a backup back over live data and reloads the in-memory set; `delete()` removes the directory.
  - **Automatic retention policy** (a layer on top of the primitive): a timer (~every 15 min) calls `create()`/`delete()` to maintain one snapshot per age bucket — **-1h, -4h, -1d, -1wk** — pruning the rest.
  - **Manual** create/list/load/delete is exposed for an admin/settings UI (later).

### LLM layer

- A `LlmProvider` interface with two operations:

  ```
  interface LlmProvider {
    complete(conversation: Message[], opts?): Promise<AssistantMessage>
    completeStructured<T>(conversation: Message[], schema: Schema): Promise<T>
  }
  ```

  A `Message` carries role + text + optional image references.

- **Structured output is a first-class mode.** Each backend implements `completeStructured` with native tool-calling / JSON-schema support where available, falling back to prompt-and-parse otherwise. Validation + retry live in the layer as a safety net.
- **Default backend shells out to the Claude Code CLI** (`claude`), using `--output-format json`, image inputs, and **stateless calls that replay the full conversation each turn** — the server owns the transcript, not Claude Code's session store. This keeps conversations portable across backends.
- Designed so the Anthropic API, Bedrock, or a self-hosted model can be dropped in behind the same interface. Use the newest, highest-quality model (quality is the priority).

### Server / API

- Express REST endpoints over the data model; brokers all LLM calls. Resource-oriented, nested where natural.

### Client

- Vanilla TypeScript + Vite, no UI frameworks. Responsive for PC and mobile.

## Three user modes (tabs)

The app is organized by **what the user is trying to do**, not by entity hierarchy. Each tab is anchored to a single user goal, and that goal drives every decision about how the tab works. Anything that doesn't serve a tab's goal belongs in a different tab.

- **Learn** — *Goal: make forward progress through a book.* Work the next un-attempted questions and get them graded. Favors: showing what's not yet done, a focused solve→grade loop, sense of progress. *(Grading sub-project.)*
- **Practice** — *Goal: retain what's already learned.* The system tells the user what to review now. Favors: a due-queue the user doesn't curate, prioritization handled for them, low friction to start. *(SRS sub-project.)*
- **Manage** — *Goal: get content into the bank and keep it correct.* Add books/chapters/questions and fix canonical text. Favors: bulk capture, easy editing, clear hierarchy, low-friction CRUD. *(Foundation sub-project — built first.)*

## Data model

Flat, one file per entity type under `data/` (`books.json`, `chapters.json`, `questions.json`, …), linked by IDs. Maps cleanly onto SQL tables later. Cross-book queries (which the SRS needs) are trivial over the flat arrays.

```
Book 1──* Chapter 1──* Question 1──* Attempt
                              │
                              └──* ReviewEntry (immutable history)
```

### Book

```
id            string (uuid)
title         string
author        string?
learningGoal  string?            // core feature, optional per-book
createdAt     ISO timestamp
```

### Chapter

```
id            string (uuid)
bookId        string             // → Book
title         string
description   string?            // topics covered; also feeds critique later
order         number             // stable display ordering within a book
createdAt     ISO timestamp
```

### Question

```
id              string (uuid)
chapterId       string           // → Chapter (required)
label           string?          // book's own numbering, e.g. "2.4"
canonicalText   string           // LaTeX/markdown — source of truth
source          QuestionSource   // raw backing (retained)
relevance       enum?            // essential | relevant | can-skip | should-skip   (later)
nextReviewDate  ISO date?        // SRS live state, derived; null until first rating (later)
createdAt       ISO timestamp
```

### QuestionSource (embedded in Question)

```
kind          "image" | "text"
imagePath     string?            // path under data/images to original page photo
rawText       string?            // plaintext input, if that was the source
```

### Attempt *(grading sub-project — shape defined now, built later)*

```
id              string (uuid)
questionId      string           // → Question
solutionSource  { kind, imagePath?, rawText? }   // handwritten photo / typed notes
transcript      Message[]        // Phase 1 transcription chat
canonicalAnswer string           // final agreed LaTeX of the answer
critique        { text, guidingRating }          // Phase 2 output
rating          enum             // DNM | partial | full — actual rating set by user (Phase 3)
createdAt       ISO timestamp
```

### ReviewEntry *(SRS sub-project — built later)*

```
date          ISO date
rating        DNM | partial | full
```

Append-only, **immutable** — records only *what happened*. `nextReviewDate` lives on the **Question** (mutable, current state) and is **derived** from the review history by a pure scheduling function, so the algorithm can change and the schedule can be backfilled without migration. (Whether ReviewEntry is stored separately or projected from Attempts is settled in the SRS spec.)

## Three core flows

### 1. Question ingestion (bulk, one-shot)

Image/plaintext → LLM extracts → multiple Questions created under a chapter, each with canonical LaTeX. Manually editable afterward; **no iteration** (extract-and-commit). Raw source retained. Extraction is the single-turn `completeStructured` case.

### 2. Attempt grading (per question, three phases)

1. **Transcription.** User uploads a photo of handwritten notes and/or plaintext. An agent produces a faithful LaTeX representation of *the user's answer*, with bidirectional clarification (it may ask when notes are ambiguous; the user may correct its output), iterating until the user marks it final. **Hard constraint:** this agent's only job is faithful transcription — it must NOT see the problem, evaluate, or offer guidance.
2. **Critique.** A separate agent — given the question + transcribed answer + **prior attempts on this question** + chapter description + book learning goal — critiques the answer and produces a **guiding rating**.
3. **User decides.** The user sets the actual rating (accept or override the guiding rating). The rating can also be set directly with no LLM interaction.

### 3. Spaced repetition

- Review at **1 week**, then **1 month** after a passing attempt.
- **Only `full` advances** a stage; `partial` and `DNM` repeat the current interval.
- **Done after the 1-month review passes** (`full`).
- History is immutable `(date, rating)`; `nextReviewDate` on the Question is derived by a pure scheduler.
- Prioritization is a **separate pure function**: order due questions by `partial > DNM > full`, weighted by relevance (essential/relevant/can-skip/should-skip).

## Build order (sub-projects)

1. **Foundation / registration** — Manage tab: data model, storage + backups, books/chapters/questions CRUD, then LLM bulk ingestion, then P0 polish. *(See foundation spec.)*
2. **Grading** — Learn tab: the three-phase attempt flow.
3. **Spaced repetition** — Practice tab: the scheduler + due-queue + prioritization.

Each sub-project gets its own spec → implementation plan → implementation cycle.
