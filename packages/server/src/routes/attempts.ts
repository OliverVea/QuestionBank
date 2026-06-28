import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Grade, GradingIssue, IssueSeverity } from '../domain/types.js';
import { requireCustomerId } from '../auth/index.js';
import type { Store } from '../storage/store.js';

const GRADES: readonly Grade[] = ['correct', 'partial', 'incorrect'];
const SEVERITIES: readonly IssueSeverity[] = ['critical', 'medium', 'minor'];

function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

/** Validate the issues field into GradingIssue[] (defaults to [] when absent). */
function parseIssues(raw: unknown): GradingIssue[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  const out: GradingIssue[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { severity, description } = item as Record<string, unknown>;
    if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) {
      return undefined;
    }
    if (typeof description !== 'string') return undefined;
    out.push({ severity: severity as IssueSeverity, description });
  }
  return out;
}

/** Nested under /api/questions/:id/attempts — list + create (final-state only). */
export function questionAttemptsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    res.json((await store.attempts.getAll(customerId)).filter((a) => a.questionId === questionId));
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { answer, recommendedGrade, rating, issues } = req.body ?? {};

    if (typeof answer !== 'string' || answer.trim() === '') {
      res.status(400).json({ error: 'answer is required' });
      return;
    }
    if (!isGrade(recommendedGrade) || !isGrade(rating)) {
      res.status(400).json({ error: 'recommendedGrade and rating must be valid grades' });
      return;
    }
    const parsedIssues = parseIssues(issues);
    if (parsedIssues === undefined) {
      res.status(400).json({ error: 'issues must be an array of {severity, description}' });
      return;
    }
    const attempt: Attempt = {
      id: newId(),
      customerId,
      questionId,
      answer: answer.trim(),
      recommendedGrade,
      rating,
      issues: parsedIssues,
      createdAt: nowIso(),
    };
    res.status(201).json(await store.attempts.create(customerId, attempt));
  });

  router.delete('/:attemptId', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { id: questionId, attemptId } = req.params as { id: string; attemptId: string };
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const existing = await store.attempts.getById(customerId, attemptId);
    // 404 unless the attempt exists AND belongs to this question — never a no-op 204
    // that hides a wrong id, and never lets one question delete another's attempt.
    if (!existing || existing.questionId !== questionId) {
      res.status(404).json({ error: 'attempt not found' });
      return;
    }
    await store.attempts.delete(customerId, attemptId);
    res.status(204).end();
  });

  return router;
}
