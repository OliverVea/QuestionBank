import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { booksRouter } from './routes/books.js';
import { bookQuestionsRouter, questionsRouter } from './routes/questions.js';
import { questionAttemptsRouter } from './routes/attempts.js';
import { questionTranscribeRouter } from './routes/transcribe.js';
import { questionGradeRouter } from './routes/grade.js';
import { lookupRouter } from './routes/lookup.js';
import { learnRouter } from './routes/learn.js';
import { practiceRouter } from './routes/practice.js';
import { extractRouter } from './routes/extract.js';
import { skipRouter } from './routes/skip.js';
import { activityRouter } from './routes/activity.js';
import { settingsRouter } from './routes/settings.js';
import { AnthropicApiProvider } from './llm/anthropic-api-provider.js';
import type { LlmProvider } from './llm/provider.js';
import { errorLogger, requestLogger } from './logging/http.js';
import { log } from './logging/logger.js';
import {
  configFromEnv,
  resolveCustomer,
  type ResolveCustomerConfig,
} from './middleware/resolve-customer.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
// Data lives in the user's home dir, not the repo, so it survives `git clean`, is never at
// risk of being committed, and is independent of the launch cwd. Override with QB_DATA_DIR.
const DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank');

/** Build the Express app over a given store. Exported so tests can mount it without a port. */
export function createApp(
  store: Store,
  provider: LlmProvider,
  _unused?: unknown,
  customerConfig: ResolveCustomerConfig = configFromEnv(process.env),
): Express {
  const app = express();
  app.use(requestLogger);
  app.use(express.json());

  // Health is unauthenticated so a proxy/uptime check needs no identity. This is the
  // liveness check: the process is up and serving. It says nothing about whether the
  // LLM backend is reachable — see /api/health/connectivity for that.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Deep health: does this pod actually reach the LLM backend right now? Probes via the
  // same client extraction uses (no tokens billed) and reports exactly what's wrong —
  // `down` with a system error code (egress dead), `auth` (key rejected), or `ok`.
  // Unauthenticated and registered before resolveCustomer so a probe needs no identity.
  // 200 when reachable, 503 otherwise, so an automated check can gate on the status code.
  app.get('/api/health/connectivity', async (_req, res) => {
    const anthropic = await provider.checkConnectivity();
    const healthy = anthropic.status === 'ok';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      anthropic,
    });
  });

  // Every /api route below resolves the owning customer first.
  app.use('/api', resolveCustomer(customerConfig));

  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/questions', bookQuestionsRouter(store));
  app.use('/api/questions/:id/attempts', questionAttemptsRouter(store));
  app.use('/api/questions/:id/transcribe', questionTranscribeRouter(store, provider));
  app.use('/api/questions/:id/grade', questionGradeRouter(store, provider));
  app.use('/api/lookup', lookupRouter());
  app.use('/api/learn', learnRouter(store));
  app.use('/api/practice', practiceRouter(store));
  app.use('/api/activity', activityRouter(store));
  app.use('/api/settings', settingsRouter(store));
  app.use('/api/questions', questionsRouter(store));
  app.use('/api/extract', extractRouter(provider, store));
  app.use('/api/skip', skipRouter(store));

  app.use(errorLogger);

  // In production, serve the client SPA from the sibling dist directory.
  // Skipped when the directory doesn't exist (e.g. during dev or tests).
  const clientDist = resolve(fileURLToPath(import.meta.url), '../../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((_req, res) => { res.sendFile(join(clientDist, 'index.html')); });
  }

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const provider = new AnthropicApiProvider();
  const app = createApp(store, provider);
  const HOST = process.env.HOST ?? '0.0.0.0';
  app.listen(PORT, HOST, () => {
    log.info(`listening on http://${HOST}:${PORT}`);
    log.info(`data dir: ${DATA_DIR}`);
  });
}

// Only start a real server when this module is the process entry point.
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
