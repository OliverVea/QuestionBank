import express, { type Express } from 'express';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { booksRouter } from './routes/books.js';
import { bookChaptersRouter, chaptersRouter } from './routes/chapters.js';
import { chapterQuestionsRouter, questionsRouter } from './routes/questions.js';
import { questionAttemptsRouter } from './routes/attempts.js';
import { questionTranscribeRouter } from './routes/transcribe.js';
import { questionGradeRouter } from './routes/grade.js';
import { learnRouter } from './routes/learn.js';
import { AnthropicApiProvider } from './llm/anthropic-api-provider.js';
import type { LlmProvider } from './llm/provider.js';
import { ImageStore } from './storage/images.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
// Data lives in the user's home dir, not the repo, so it survives `git clean`,
// is never at risk of being committed, and is independent of the launch cwd
// (the server is a long-running service that owns its storage). Override with QB_DATA_DIR.
const DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank');

/** Build the Express app over a given store. Exported so tests can mount it without a port. */
export function createApp(store: Store, provider: LlmProvider, imageStore: ImageStore): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/chapters', bookChaptersRouter(store));
  app.use('/api/chapters', chaptersRouter(store));
  app.use('/api/chapters/:chapterId/questions', chapterQuestionsRouter(store, provider, imageStore));
  app.use('/api/questions/:id/attempts', questionAttemptsRouter(store));
  app.use('/api/questions/:id/transcribe', questionTranscribeRouter(store, provider, imageStore));
  app.use('/api/questions/:id/grade', questionGradeRouter(store, provider));
  app.use('/api/learn', learnRouter(store));
  app.use('/api/questions', questionsRouter(store));

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const imageStore = new ImageStore(DATA_DIR);
  const provider = new AnthropicApiProvider();
  const app = createApp(store, provider, imageStore);
  // Bind 0.0.0.0 so the API is reachable from other devices on the LAN (e.g. a
  // phone), matching the Vite client's `host: true`. Override with HOST if needed.
  const HOST = process.env.HOST ?? '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] data dir: ${DATA_DIR}`);
  });
}

// Only start a real server when this module is the process entry point — not when
// a test imports createApp. fileURLToPath turns import.meta.url into a native path,
// so the comparison works identically on Windows and POSIX (no manual slash munging).
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
