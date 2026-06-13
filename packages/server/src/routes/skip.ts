import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Skip } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import type { Store } from '../storage/store.js';

const SKIP_HOURS = 12;

/** /api/skip/:questionId — record a 12h skip for a question. */
export function skipRouter(store: Store): Router {
  const router = Router();
  router.post('/:questionId', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { questionId } = req.params as { questionId: string };
    const now = nowIso();
    const expiresAt = new Date(Date.now() + SKIP_HOURS * 60 * 60 * 1000).toISOString();
    const skip: Skip = { id: newId(), customerId, questionId, createdAt: now, expiresAt };
    await store.skips.create(customerId, skip);
    res.status(201).json(skip);
  });
  return router;
}

/** Get all currently-active (non-expired) skipped question IDs for a customer. */
export async function activeSkippedIds(store: Store, customerId: string): Promise<Set<string>> {
  const now = new Date().toISOString();
  const all = await store.skips.getAll(customerId);
  return new Set(all.filter((s) => s.expiresAt > now).map((s) => s.questionId));
}
