import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { suggestNext } from '../services/learn-next.js';
import type { Store } from '../storage/store.js';

/** /api/learn — read-only suggestion endpoints. */
export function learnRouter(store: Store): Router {
  const router = Router();
  router.get('/next', (_req, res) => {
    const next = suggestNext(store, nowIso());
    res.json(next ?? { question: null });
  });
  return router;
}
