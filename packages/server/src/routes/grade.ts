import { Router } from 'express';
import {
  buildGradingPrompt,
  deriveGrade,
  gradingTurnSchema,
  validateGradingTurn,
  type GradingContext,
} from '../llm/grading-contract.js';
import { LlmError, type LlmProvider, type Message, type Role } from '../llm/provider.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { log } from '../logging/logger.js';
import type { Store } from '../storage/store.js';

const ROLES: readonly Role[] = ['user', 'assistant'];

/** Grading emits an unbounded `reasoning` string plus an `issues` list; verbose answers
 *  overran the provider's 8000-token default and 502'd (`response truncated`). Double the
 *  ceiling — still far under the model's output limit — so a long critique completes. */
const GRADING_MAX_TOKENS = 16_000;

function parseConversation(raw: unknown): Message[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Message[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { role, text } = item as Record<string, unknown>;
    if (typeof text !== 'string') return undefined;
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return undefined;
    out.push({ role: role as Role, text });
  }
  return out;
}

/** Nested under /api/questions/:id/grade — one stateless grading turn. */
export function questionGradeRouter(store: Store, provider: LlmProvider): Router {
  const router = Router({ mergeParams: true });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const transcript = parseConversation((req.body ?? {}).conversation);
    if (transcript === undefined) {
      res.status(400).json({ error: 'conversation must be an array of {role, text}' });
      return;
    }
    if (transcript.length === 0) {
      res.status(400).json({ error: 'conversation must not be empty' });
      return;
    }

    const book = await store.books.getById(customerId, question.bookId);
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };

    const messages: Message[] = [{ role: 'user', text: buildGradingPrompt(ctx) }, ...transcript];

    log.info('grading turn', { question: questionId, turns: transcript.length });

    try {
      const raw = await provider.completeStructured<unknown>(messages, gradingTurnSchema, {
        maxTokens: GRADING_MAX_TOKENS,
      });
      const turn = validateGradingTurn(raw);
      const recommendedGrade = deriveGrade(turn.issues);
      log.info('grading complete', {
        question: questionId,
        grade: recommendedGrade,
        issues: turn.issues.length,
      });
      res.json({ reasoning: turn.reasoning, issues: turn.issues, recommendedGrade });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('grading failed', { question: questionId });
        res.status(502).json({ error: 'grading failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
