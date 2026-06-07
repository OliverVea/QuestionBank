import { describe, expect, it } from 'vitest';
import { buildTranscriptionPrompt, transcriptionSchema } from './transcription-contract.js';

describe('buildTranscriptionPrompt', () => {
  it('includes the question text as reference', () => {
    const p = buildTranscriptionPrompt('Compute z^3 where z = -1/2 + sqrt(3)/2 i.');
    expect(p).toContain('Compute z^3');
  });

  it('marks the question as reference-only, not to be answered', () => {
    const p = buildTranscriptionPrompt('Q');
    expect(p).toMatch(/reference only/i);
  });

  it('hard-forbids solving / correcting / completing / grading', () => {
    const p = buildTranscriptionPrompt('Q');
    expect(p).toMatch(/do not solve/i);
    expect(p).toMatch(/correct/i);
    expect(p).toMatch(/complete/i);
    expect(p).toMatch(/transcribe (it )?(wrong|incomplete|exactly|faithfully)/i);
  });
});

describe('transcriptionSchema', () => {
  it('requires a single transcription string', () => {
    expect(transcriptionSchema.required).toContain('transcription');
    expect(transcriptionSchema.properties.transcription.type).toEqual('string');
  });
});
