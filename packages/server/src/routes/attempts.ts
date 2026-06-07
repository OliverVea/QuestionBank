import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Grade, GradingIssue, IssueSeverity } from '../domain/types.js';
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

/** Validate the imagePaths field into a string[] (defaults to [] when absent). */
function parseImagePaths(raw: unknown): string[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) return undefined;
  return raw as string[];
}

/** Nested under /api/questions/:id/attempts — list + create (final-state only). */
export function questionAttemptsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const questionId = (req.params as { id: string }).id;
    if (!store.questions.getById(questionId)) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    res.json(store.attempts.getAll().filter((a) => a.questionId === questionId));
  });

  router.post('/', (req, res) => {
    const questionId = (req.params as { id: string }).id;
    if (!store.questions.getById(questionId)) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { imagePaths, answerText, transcription, recommendedGrade, rating, issues } =
      req.body ?? {};

    const paths = parseImagePaths(imagePaths);
    if (paths === undefined) {
      res.status(400).json({ error: 'imagePaths must be an array of strings' });
      return;
    }
    const answer = typeof answerText === 'string' ? answerText.trim() : '';
    // Invariant: at least one of a photo or a typed answer.
    if (paths.length === 0 && answer === '') {
      res.status(400).json({ error: 'attach a photo or type an answer' });
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
      questionId,
      imagePaths: paths,
      answerText: answer,
      transcription: typeof transcription === 'string' ? transcription : '',
      recommendedGrade,
      rating,
      issues: parsedIssues,
      createdAt: nowIso(),
    };
    res.status(201).json(store.attempts.create(attempt));
  });

  return router;
}
