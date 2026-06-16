import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { computeActivity } from '../services/activity.js';
import type { Store } from '../storage/store.js';

/** /api/activity — global streak + weekly-goal metrics for the landing header. */
export function activityRouter(store: Store): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const attempts = await store.attempts.getAll(requireCustomerId(req));
    res.json(computeActivity(attempts, nowIso()));
  });
  return router;
}
