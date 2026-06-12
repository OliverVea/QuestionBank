import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { suggestNext } from '../services/learn-next.js';
import type { Store } from '../storage/store.js';

/** /api/learn — read-only suggestion endpoints. */
export function learnRouter(store: Store): Router {
  const router = Router();
  router.get('/next', async (req, res) => {
    const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : '';
    const exclude = excludeRaw ? new Set(excludeRaw.split(',')) : undefined;
    const next = await suggestNext(store, requireCustomerId(req), nowIso(), exclude);
    res.json(next ?? { question: null });
  });
  return router;
}
