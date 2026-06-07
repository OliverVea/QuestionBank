import { Router } from 'express';
import { buildGradingPrompt, gradingTurnSchema, type GradingContext } from '../llm/grading-contract.js';
import { LlmError, type LlmProvider, type Message, type Role } from '../llm/provider.js';
import type { Store } from '../storage/store.js';

const ROLES: readonly Role[] = ['user', 'assistant'];

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
    const questionId = (req.params as { id: string }).id;
    const question = store.questions.getById(questionId);
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

    const chapter = store.chapters.getById(question.chapterId);
    const book = chapter ? store.books.getById(chapter.bookId) : undefined;
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(chapter?.description !== undefined ? { chapterDescription: chapter.description } : {}),
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };

    const messages: Message[] = [{ role: 'user', text: buildGradingPrompt(ctx) }, ...transcript];

    try {
      const turn = await provider.completeStructured<{
        critiqueText: string;
        recommendedGrade: string;
      }>(messages, gradingTurnSchema);
      res.json({ critiqueText: turn.critiqueText, recommendedGrade: turn.recommendedGrade });
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'grading failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
