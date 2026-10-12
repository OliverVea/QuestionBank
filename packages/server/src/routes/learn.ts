import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../auth/index.js';
import { suggestNext } from '../services/learn-next.js';
import type { Store } from '../storage/store.js';

/** /api/learn — read-only suggestion endpoints. */
export function learnRouter(store: Store): Router {
  const router = Router();
  router.get('/next', async (req, res) => {
    // ?bookId= keeps Learn inside the book whose button the learner pressed.
    const bookId = typeof req.query.bookId === 'string' && req.query.bookId !== '' ? req.query.bookId : undefined;
    const next = await suggestNext(store, requireCustomerId(req), nowIso(), bookId);
    res.json(next ?? { question: null });
  });
  return router;
}
