import { describe, test, expect, beforeEach } from 'vitest';
import {
  recordCompleted,
  getCount,
  getLastChapter,
  shouldPause,
  reset,
} from '@/lib/session';

// The singleton is module-level state; reset both modes before each test.
beforeEach(() => {
  reset('learn');
  reset('revisit');
});

describe('session counter', () => {
  test('counts completions per mode, independently', () => {
    recordCompleted('learn', '1');
    recordCompleted('learn', '1');
    recordCompleted('revisit');
    expect(getCount('learn')).toBe(2);
    expect(getCount('revisit')).toBe(1);
  });

  test('reset zeroes the count and clears lastChapter for that mode only', () => {
    recordCompleted('learn', '2');
    recordCompleted('revisit');
    reset('learn');
    expect(getCount('learn')).toBe(0);
    expect(getLastChapter('learn')).toBeNull();
    expect(getCount('revisit')).toBe(1); // untouched
  });
});

describe('learn pause: chapter seam', () => {
  test('no pause before the first item (no previous completion)', () => {
    expect(shouldPause('learn', { nextChapter: '1' })).toBe(false);
  });

  test('no pause when the next chapter matches the last completed chapter', () => {
    recordCompleted('learn', '1');
    expect(shouldPause('learn', { nextChapter: '1' })).toBe(false);
  });

  test('pause when the next chapter differs from the last completed chapter', () => {
    recordCompleted('learn', '1');
    expect(shouldPause('learn', { nextChapter: '2' })).toBe(true);
  });

  test('lastChapter reflects the most recent completion', () => {
    recordCompleted('learn', '1');
    recordCompleted('learn', '2');
    expect(getLastChapter('learn')).toBe('2');
    expect(shouldPause('learn', { nextChapter: '2' })).toBe(false);
  });
});

describe('revisit pause: every N', () => {
  test('pauses at multiples of pauseEvery, not between', () => {
    for (let i = 0; i < 9; i++) {
      recordCompleted('revisit');
      expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(false);
    }
    recordCompleted('revisit'); // 10th
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(true);
  });

  test('never pauses at count 0', () => {
    expect(shouldPause('revisit', { pauseEvery: 1 })).toBe(false);
  });

  test('continuing keeps the count climbing across a pause', () => {
    for (let i = 0; i < 10; i++) recordCompleted('revisit');
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(true); // pause shown
    recordCompleted('revisit'); // user kept going → 11th
    expect(getCount('revisit')).toBe(11);
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(false);
  });
});
