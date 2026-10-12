import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerifyBearer } from '../auth/index.js';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Book, Figure, Question } from '../domain/types.js';
import { log } from '../logging/logger.js';
import type { Store } from '../storage/store.js';

/** The sample library every demo guest starts with: `packages/server/demo/seed`. */
export const DEMO_SEED_DIR = fileURLToPath(new URL('../../demo/seed', import.meta.url));

/** A guest token is `demo-<uuid>`; the client makes one up and keeps it in localStorage. */
const GUEST_TOKEN = /^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Upper bound on guests seeded per process, so a script cannot fill the disk. */
const MAX_GUESTS = 2000;

async function readSeed<T>(seedDir: string, name: string): Promise<T[]> {
  return JSON.parse(await readFile(join(seedDir, `${name}.json`), 'utf8')) as T[];
}

/**
 * Copy the sample library into `customerId` under fresh ids. Attempts are dated now, so
 * their spaced-repetition schedule reads as if the guest had just made them.
 */
export async function seedGuest(store: Store, customerId: string, seedDir: string): Promise<void> {
  const [books, questions, figures, attempts] = await Promise.all([
    readSeed<Book>(seedDir, 'books'),
    readSeed<Question>(seedDir, 'questions'),
    readSeed<Figure>(seedDir, 'figures'),
    readSeed<Attempt>(seedDir, 'attempts'),
  ]);
  const ids = new Map<string, string>();
  const mapped = (old: string): string => {
    let id = ids.get(old);
    if (id === undefined) {
      id = newId();
      ids.set(old, id);
    }
    return id;
  };
  const now = nowIso();
  for (const book of books) {
    await store.books.create(customerId, {
      ...book,
      id: mapped(book.id),
      customerId,
      questionIds: book.questionIds.map(mapped),
      createdAt: now,
    });
  }
  for (const question of questions) {
    await store.questions.create(customerId, {
      ...question,
      id: mapped(question.id),
      customerId,
      bookId: mapped(question.bookId),
      createdAt: now,
    });
  }
  for (const figure of figures) {
    const id = mapped(figure.id);
    await store.figureBlobs.put(id, await readFile(join(seedDir, 'imgs', `${figure.id}.webp`)));
    await store.figures.create(customerId, {
      ...figure,
      id,
      customerId,
      questionId: mapped(figure.questionId),
      createdAt: now,
    });
  }
  for (const attempt of attempts) {
    await store.attempts.create(customerId, {
      ...attempt,
      id: mapped(attempt.id),
      customerId,
      questionId: mapped(attempt.questionId),
      createdAt: now,
    });
  }
}

/**
 * The demo's stand-in for OIDC: no login, one tenant per visitor. Any well-formed guest
 * token is accepted and becomes its own customer, seeded with the sample library the first
 * time it is seen, so visitors never see (or write into) each other's data.
 */
export function createDemoVerifier(store: Store, seedDir: string = DEMO_SEED_DIR): VerifyBearer {
  const seeded = new Map<string, Promise<void>>();
  return async (token: string) => {
    if (!GUEST_TOKEN.test(token)) throw new Error('not a demo guest token');
    let ready = seeded.get(token);
    if (ready === undefined) {
      if (seeded.size >= MAX_GUESTS) throw new Error('demo guest limit reached');
      ready = seedGuest(store, token, seedDir);
      seeded.set(token, ready);
      log.info('demo guest seeded', { guests: seeded.size });
    }
    await ready;
    return { customerId: token, claims: { sub: token } };
  };
}
