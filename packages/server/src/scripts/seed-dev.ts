/**
 * Seed the local dev store with one book of problems spanning every readiness
 * state, so the view-book page has something to render. Idempotent-ish: it
 * removes any prior book titled SEED_TITLE (and its questions/attempts) first.
 *
 * Run from the repo root:
 *   npx tsx --env-file-if-exists=.env packages/server/src/scripts/seed-dev.ts
 *
 * Writes to the same store the dev server uses (QB_DATA_DIR or ~/.question-bank).
 * Attempts are backdated directly in the store (the HTTP route forces createdAt=now),
 * which is what lets us produce overdue / due-in-future states deterministically.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../storage/store.js';
import type { Attempt, Book, Grade, Question } from '../domain/types.js';

const CUSTOMER = 'local';
const SEED_TITLE = 'Introduction to Quantum Mechanics';
const DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank');

const now = Date.now();
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
const days = (n: number): number => n * 86_400_000;

/** A problem to seed: its dotted-path label, text, and a list of [grade, daysAgo] attempts. */
interface Seed {
  label: string;
  text: string;
  attempts: Array<[Grade, number]>;
}

// Deliberately OUT of path order in the array — the server derives display order
// from the label, so this also exercises the ordering. Attempt histories are
// chosen to land each problem in a distinct readiness state:
//   - no attempts                       → ready ("Ready now")
//   - 1 correct 1 day ago               → step 1, due in ~6 days → waiting ("Ready in 6 days")
//   - 1 correct 10 days ago             → step 1, due 3 days ago → ready (overdue → "Ready now")
//   - 3+ correct                        → excellent → finalized (empty readiness column)
//   - mixed/failing recent              → improving + waiting
const SEEDS: Seed[] = [
  {
    label: '2.3',
    text: 'A particle of energy $E$ meets a step potential $V_0<E$. Find the reflection coefficient $R$.',
    attempts: [['partial', 3]],
  },
  {
    label: '1.A.10',
    text: 'Show that $\\frac{d\\langle p\\rangle}{dt} = \\left\\langle -\\frac{\\partial V}{\\partial x}\\right\\rangle$ (Ehrenfest).',
    attempts: [],
  },
  {
    label: '1.A.2',
    text: 'For $\\Psi(x,t)$, show that $\\frac{d\\langle x\\rangle}{dt}=\\frac{\\langle p\\rangle}{m}$.',
    attempts: [['correct', 1]], // due in ~6 days → waiting
  },
  {
    label: '1.A.1',
    text: 'Normalize the wave function $\\Psi(x,0)=A\\,e^{-\\lambda|x|}$ and find $A$.',
    attempts: [['incorrect', 9], ['partial', 5], ['incorrect', 1]], // improving + waiting
  },
  {
    label: '1.B.1',
    text: 'Solve the infinite square well: $-\\frac{\\hbar^2}{2m}\\psi\'\' = E\\psi$.',
    attempts: [['correct', 30], ['correct', 14], ['correct', 7]], // excellent → finalized
  },
  {
    label: '1.5',
    text: 'A loose chapter-1 problem (direct, no subsection): state the uncertainty principle.',
    attempts: [['correct', 10]], // due 3 days ago → ready (overdue)
  },
  {
    label: '', // unlabelled → Ungrouped chapter
    text: 'Sketch the Schwarz-inequality argument for the position–momentum uncertainty bound.',
    attempts: [],
  },
];

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);

  // Remove any prior seed book (and its questions + attempts) so re-running is clean.
  const existing = (await store.books.getAll(CUSTOMER)).filter((b) => b.title === SEED_TITLE);
  for (const book of existing) {
    const qs = (await store.questions.getAll(CUSTOMER)).filter((q) => q.bookId === book.id);
    for (const q of qs) {
      const ats = (await store.attempts.getAll(CUSTOMER)).filter((a) => a.questionId === q.id);
      for (const a of ats) await store.attempts.delete(CUSTOMER, a.id);
      await store.questions.delete(CUSTOMER, q.id);
    }
    await store.books.delete(CUSTOMER, book.id);
  }

  const bookId = randomUUID();
  const questionIds: string[] = [];

  for (const seed of SEEDS) {
    const q: Question = {
      id: randomUUID(),
      customerId: CUSTOMER,
      bookId,
      label: seed.label,
      canonicalText: seed.text,
      source: { kind: 'text', rawText: seed.text },
      createdAt: iso(days(40)),
    };
    await store.questions.create(CUSTOMER, q);
    questionIds.push(q.id);

    for (const [grade, daysAgo] of seed.attempts) {
      const a: Attempt = {
        id: randomUUID(),
        customerId: CUSTOMER,
        questionId: q.id,
        answer: 'seeded answer',
        recommendedGrade: grade,
        rating: grade,
        issues: [],
        createdAt: iso(days(daysAgo)),
      };
      await store.attempts.create(CUSTOMER, a);
    }
  }

  const book: Book = {
    id: bookId,
    customerId: CUSTOMER,
    title: SEED_TITLE,
    author: 'David J. Griffiths',
    publisher: 'Cambridge University Press',
    year: 2018,
    isbn: '9781107179868',
    questionIds, // membership only; display order is derived from the path
    createdAt: iso(days(40)),
  };
  await store.books.create(CUSTOMER, book);

  console.log(`Seeded "${SEED_TITLE}" (${SEEDS.length} problems) → book id ${bookId}`);
  console.log(`Open: http://localhost:5173/#/view-book?id=${bookId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
