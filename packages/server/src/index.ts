import express, { type Express } from 'express';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { booksRouter } from './routes/books.js';
import { bookChaptersRouter, chaptersRouter } from './routes/chapters.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.QB_DATA_DIR ?? join(process.cwd(), 'data');

/** Build the Express app over a given store. Exported so tests can mount it without a port. */
export function createApp(store: Store): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/chapters', bookChaptersRouter(store));
  app.use('/api/chapters', chaptersRouter(store));

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

// Only start a real server when this module is the process entry point — not when
// a test imports createApp. fileURLToPath turns import.meta.url into a native path,
// so the comparison works identically on Windows and POSIX (no manual slash munging).
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
