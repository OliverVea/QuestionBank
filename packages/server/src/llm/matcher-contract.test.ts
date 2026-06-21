import { describe, expect, it } from 'vitest';
import { bufferImage } from './image-ref.js';
import {
  buildMatcherPrompt,
  runMatcher,
  validateMatchResult,
  type MatchCandidate,
} from './matcher-contract.js';
import { FakeProvider } from './fake-provider.js';

const CANDIDATES: MatchCandidate[] = [
  { label: '5.32', figureRefs: ['Figure 5.32'] },
  { label: '5.32', figureRefs: ['Figure 5.32b'] },
  { label: '5.33', figureRefs: [] },
];

describe('buildMatcherPrompt', () => {
  it('lists problems by index and states the image split', () => {
    const prompt = buildMatcherPrompt(CANDIDATES, 4, 1);
    expect(prompt).toContain('0: 5.32 — [Figure 5.32]');
    expect(prompt).toContain('1: 5.32 — [Figure 5.32b]');
    expect(prompt).toContain('2: 5.33 — []');
    expect(prompt).toContain('first 1 image(s) are the rectified page');
    expect(prompt).toContain('next 4');
  });
});

describe('validateMatchResult', () => {
  it('keeps in-range entries and reads confidence + printedLabel', () => {
    const raw = {
      matches: [
        { figureIndex: 0, printedLabel: 'Figure 5.32', matchedProblemIndex: 0, confidence: 'high' },
        { figureIndex: 1, printedLabel: '', matchedProblemIndex: null, confidence: 'low' },
      ],
    };
    const res = validateMatchResult(raw, 2, 3);
    expect(res.matches).toHaveLength(2);
    expect(res.matches[0]).toEqual({
      figureIndex: 0,
      printedLabel: 'Figure 5.32',
      matchedProblemIndex: 0,
      confidence: 'high',
    });
    expect(res.matches[1].matchedProblemIndex).toBeNull();
  });

  it('drops entries with an out-of-range figureIndex or bad confidence', () => {
    const raw = {
      matches: [
        { figureIndex: 9, printedLabel: 'x', matchedProblemIndex: 0, confidence: 'high' },
        { figureIndex: 0, printedLabel: 'x', matchedProblemIndex: 0, confidence: 'bogus' },
        { figureIndex: 1, printedLabel: 'ok', matchedProblemIndex: 1, confidence: 'medium' },
      ],
    };
    const res = validateMatchResult(raw, 2, 3);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].figureIndex).toEqual(1);
  });

  it('clamps an out-of-range matchedProblemIndex to null (candidateCount bound, not resolved)', () => {
    // candidateCount = 1, so problem index 2 is out of range → unmatched, entry kept.
    const raw = {
      matches: [{ figureIndex: 0, printedLabel: 'x', matchedProblemIndex: 2, confidence: 'high' }],
    };
    const res = validateMatchResult(raw, 1, 1);
    expect(res.matches[0].matchedProblemIndex).toBeNull();
  });

  it('throws on a malformed envelope', () => {
    expect(() => validateMatchResult(null, 1, 1)).toThrow();
    expect(() => validateMatchResult({ matches: 'no' }, 1, 1)).toThrow();
  });
});

describe('runMatcher', () => {
  it('sends pages+crops as images and returns the validated result', async () => {
    const provider = new FakeProvider({
      structured: {
        matches: [
          { figureIndex: 0, printedLabel: 'Figure 5.32', matchedProblemIndex: 0, confidence: 'high' },
        ],
      },
    });
    const png = bufferImage(Buffer.from('x'), 'image/png');
    const res = await runMatcher(provider, {
      pageImages: [png],
      cropImages: [png, png],
      candidates: CANDIDATES,
    });
    expect(res.matches).toHaveLength(1);
    // One user turn, images = [1 page, 2 crops].
    expect(provider.lastConversation).toHaveLength(1);
    expect(provider.lastConversation[0].images).toHaveLength(3);
  });
});
