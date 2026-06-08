import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { dueQueue } from '../services/due-queue.js';
import type { Store } from '../storage/store.js';

/** /api/practice — read-only spaced-repetition queue endpoints. */
export function practiceRouter(store: Store): Router {
  const router = Router();
  router.get('/due', (_req, res) => {
    res.json(dueQueue(store, nowIso()));
  });
  return router;
}
