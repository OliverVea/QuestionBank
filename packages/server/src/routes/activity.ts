import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { computeActivity } from '../services/activity.js';
import type { Store } from '../storage/store.js';
import { customerGoals } from './settings.js';

/** /api/activity — global streak + weekly-goal metrics for the landing header. */
export function activityRouter(store: Store): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const [attempts, goals] = await Promise.all([
      store.attempts.getAll(customerId),
      customerGoals(store, customerId),
    ]);
    res.json(computeActivity(attempts, nowIso(), goals));
  });
  return router;
}
