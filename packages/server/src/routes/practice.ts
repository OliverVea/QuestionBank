import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../auth/index.js';
import { dueQueue } from '../services/due-queue.js';
import type { Store } from '../storage/store.js';

/** /api/practice — read-only spaced-repetition queue endpoints. */
export function practiceRouter(store: Store): Router {
  const router = Router();
  router.get('/due', async (req, res) => {
    const items = await dueQueue(store, requireCustomerId(req), nowIso());
    // index.html's revisit banner wants just the number; ?count=true returns it.
    if (req.query.count === 'true') {
      res.json({ count: items.length });
      return;
    }
    res.json(items);
  });
  return router;
}
