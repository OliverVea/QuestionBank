import { join } from 'node:path';
import type { Attempt, Book, Question, Skip } from '../domain/types.js';
import { JsonCollection } from './json-collection.js';
import type { Repository } from './repository.js';

/** Owns the data directory and the per-entity collections. */
export class Store {
  private constructor(
    readonly books: Repository<Book>,
    readonly questions: Repository<Question>,
    readonly attempts: Repository<Attempt>,
    readonly skips: Repository<Skip>,
  ) {}

  static async open(dataDir: string): Promise<Store> {
    const [books, questions, attempts, skips] = await Promise.all([
      JsonCollection.open<Book>(join(dataDir, 'books.json')),
      JsonCollection.open<Question>(join(dataDir, 'questions.json')),
      JsonCollection.open<Attempt>(join(dataDir, 'attempts.json')),
      JsonCollection.open<Skip>(join(dataDir, 'skips.json')),
    ]);
    return new Store(books, questions, attempts, skips);
  }
}
