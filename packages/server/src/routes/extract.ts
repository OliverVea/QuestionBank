import { Router } from 'express';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import {
  buildExtractionPrompt,
  extractionEnvelopeSchema,
} from '../llm/extraction-contract.js';
import { validateExtractionEnvelope, type ExtractionEnvelope } from '../llm/extraction-delta.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import type { Store } from '../storage/store.js';
import { log } from '../logging/logger.js';
import { acceptImages, loadExisting, readImages } from './extract-shared.js';

/**
 * POST /api/extract — accepts 1..5 page images + a bookId, returns a typed extraction
 * envelope (resolved deltas + ambiguous pages). The model sees the book's existing
 * problems and emits add/edit/skip. Stateless: nothing is persisted; the client commits
 * via the normal problem CRUD.
 *
 * POST /api/extract/refine — same images + prior envelope + the user's per-page section
 * answers, re-extracts so ambiguous pages fold into resolved.
 */
export function extractRouter(provider: LlmProvider, store: Store): Router {
  const router = Router();

  router.post('/', acceptImages, async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.body ?? {}).bookId;
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      res.status(400).json({ error: 'bookId is required' });
      return;
    }
    const images = readImages(req);
    if (!images) {
      res.status(400).json({ error: 'attach 1–5 image files (png, jpeg, webp, gif)' });
      return;
    }
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }

    const existing = await loadExisting(store, customerId, bookId);
    // Relevance scoring rides the book's own learningGoal — no client field needed (the
    // book is already loaded). When the book has no goal, the prompt omits relevance.
    const prompt = buildExtractionPrompt(existing, book.learningGoal);
    const messages: Message[] = [{ role: 'user', text: prompt, images: images.map((u) => u.ref) }];
    log.info('extracting problems from pages', {
      pages: images.length,
      existing: existing.length,
      hasGoal: !!book.learningGoal,
    });

    try {
      const raw = await provider.completeStructured<unknown>(messages, extractionEnvelopeSchema, {
        tag: 'extraction',
      });
      const envelope = validateExtractionEnvelope(raw, existing.map((e) => e.id), images.length);
      res.json(envelope);
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('extraction failed', { error: (err as Error).message });
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }
  });

  /** Refine: re-extract with the user's per-page section answers folded in. */
  router.post('/refine', acceptImages, async (req, res) => {
    const customerId = requireCustomerId(req);
    const body = req.body ?? {};
    const bookId = body.bookId;
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      res.status(400).json({ error: 'bookId is required' });
      return;
    }
    const images = readImages(req);
    if (!images) {
      res.status(400).json({ error: 'attach 1–5 image files (png, jpeg, webp, gif)' });
      return;
    }
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }

    // Parse the prior envelope + the user's answers. Tolerate malformed JSON (fall back to empty).
    let prior: ExtractionEnvelope = { resolved: [], needsSection: [] };
    if (typeof body.currentExtraction === 'string') {
      try { prior = JSON.parse(body.currentExtraction); } catch { /* keep empty */ }
    }
    let sectionAnswers: Record<string, string> = {};
    if (typeof body.sectionAnswers === 'string') {
      try { sectionAnswers = JSON.parse(body.sectionAnswers); } catch { /* keep empty */ }
    }
    const note = typeof body.note === 'string' ? body.note : '';

    const existing = await loadExisting(store, customerId, bookId);
    const prompt = buildExtractionPrompt(existing, book.learningGoal);

    // Describe the section answers as an instruction line per answered page.
    const answerLines = Object.entries(sectionAnswers).map(
      ([pageIndex, prefix]) => `Page ${pageIndex}: these problems belong under "${prefix}".`,
    );
    const correction = [
      'Apply the following and return the full updated envelope. Fold any needsSection',
      'problems for the pages named below into `resolved` as `add`s, building each path from',
      'the given prefix and the problem\'s local label.',
      ...answerLines,
      ...(note.trim() ? ['', `Additional note: ${note.trim()}`] : []),
    ].join('\n');

    const messages: Message[] = [
      { role: 'user', text: prompt, images: images.map((u) => u.ref) },
      { role: 'assistant', text: JSON.stringify(prior) },
      { role: 'user', text: correction },
    ];
    log.info('refining extraction', { pages: images.length, answers: answerLines.length });

    try {
      const raw = await provider.completeStructured<unknown>(messages, extractionEnvelopeSchema, {
        tag: 'extraction',
      });
      const envelope = validateExtractionEnvelope(raw, existing.map((e) => e.id), images.length);
      res.json(envelope);
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('refinement failed', { error: (err as Error).message });
        res.status(502).json({ error: 'refinement failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
