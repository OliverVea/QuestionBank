import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { suggestNext } from '../services/learn-next.js';
import type { Store } from '../storage/store.js';

/** /api/learn — read-only suggestion endpoints. */
export function learnRouter(store: Store): Router {
  const router = Router();
  router.get('/next', async (req, res) => {
    const next = await suggestNext(store, requireCustomerId(req), nowIso());
    res.json(next ?? { question: null });
  });
  return router;
}
