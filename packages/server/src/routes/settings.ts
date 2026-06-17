import { Router } from 'express';
import type { Settings } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { DEFAULT_GOALS, type Goals } from '../services/activity.js';
import type { Store } from '../storage/store.js';

/** Bounds for the two weekly goals, mirroring the input constraints in the mock. */
const DAYS_MIN = 1;
const DAYS_MAX = 7;
const PROBLEMS_MIN = 1;

/** A positive integer within [min, max] (max optional). */
function isIntInRange(value: unknown, min: number, max?: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    (max === undefined || value <= max)
  );
}

/**
 * The customer's stored goals, falling back to the defaults when no settings
 * record exists yet. Shared with the activity route so the header reads the same
 * source as the editor.
 */
export async function customerGoals(store: Store, customerId: string): Promise<Goals> {
  const record = await store.settings.getById(customerId, customerId);
  if (!record) return DEFAULT_GOALS;
  return { daysGoal: record.daysGoal, problemsGoal: record.problemsGoal };
}

/**
 * /api/settings — read (GET, defaulting) and upsert (PUT) the customer's weekly goals.
 * The settings record is a per-customer singleton keyed by `id === customerId`.
 */
export function settingsRouter(store: Store): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await customerGoals(store, requireCustomerId(req)));
  });

  router.put('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { daysGoal, problemsGoal } = req.body ?? {};
    if (!isIntInRange(daysGoal, DAYS_MIN, DAYS_MAX)) {
      res.status(400).json({ error: `daysGoal must be an integer in ${DAYS_MIN}–${DAYS_MAX}` });
      return;
    }
    if (!isIntInRange(problemsGoal, PROBLEMS_MIN)) {
      res.status(400).json({ error: `problemsGoal must be an integer ≥ ${PROBLEMS_MIN}` });
      return;
    }

    const existing = await store.settings.getById(customerId, customerId);
    if (existing) {
      await store.settings.update(customerId, customerId, { daysGoal, problemsGoal });
    } else {
      const record: Settings = { id: customerId, customerId, daysGoal, problemsGoal };
      await store.settings.create(customerId, record);
    }
    res.json({ daysGoal, problemsGoal });
  });

  return router;
}
