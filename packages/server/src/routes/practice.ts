import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { dueQueue } from '../services/due-queue.js';
import type { Store } from '../storage/store.js';

/** /api/practice — read-only spaced-repetition queue endpoints. */
export function practiceRouter(store: Store): Router {
  const router = Router();
  router.get('/due', async (req, res) => {
    res.json(await dueQueue(store, requireCustomerId(req), nowIso()));
  });
  return router;
}
