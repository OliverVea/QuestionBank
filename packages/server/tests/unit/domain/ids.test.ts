import { describe, expect, it } from 'vitest';
import { newId, nowIso } from '@/domain/ids.js';

describe('ids', () => {
  it('newId returns a unique uuid each call', () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toEqual(b);
  });

  it('nowIso returns an ISO-8601 timestamp', () => {
    const ts = nowIso();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(ts).toISOString()).toEqual(ts);
  });
});
