// packages/client/tests/unit/pages/grade/conversation.test.ts
import { describe, test, expect } from 'vitest';
import { Conversation } from '@/pages/grade/conversation';
import type { GradePayload } from '@/pages/grade/conversation';

const grade = (g: GradePayload['recommendedGrade']): GradePayload => ({
  reasoning: 'r', issues: [], recommendedGrade: g,
});

describe('Conversation', () => {
  test('starts empty', () => {
    const c = new Conversation();
    expect(c.turns).toEqual([]);
    expect(c.firstAnswer).toBe('');
    expect(c.latestGrade).toBeNull();
    expect(c.toGradePayload()).toEqual([]);
  });

  test('addUser/addGrade build an alternating wire payload', () => {
    const c = new Conversation();
    const id = c.addUser('x = 4');
    expect(id).toBe(1);
    const g = grade('partial');
    c.addGrade(g);
    expect(c.firstAnswer).toBe('x = 4');
    expect(c.latestGrade).toEqual(g);
    expect(c.toGradePayload()).toEqual([
      { role: 'user', text: 'x = 4' },
      { role: 'assistant', text: JSON.stringify(g) },
    ]);
  });

  test('editUserTurn rewrites the turn and truncates everything after it', () => {
    const c = new Conversation();
    const a = c.addUser('A');
    c.addGrade(grade('partial'));
    c.addUser('B');
    c.addGrade(grade('correct'));
    expect(c.turns).toHaveLength(4);

    c.editUserTurn(a, 'A2');
    expect(c.turns).toHaveLength(1);
    expect(c.firstAnswer).toBe('A2');
    expect(c.latestGrade).toBeNull();
  });

  test('editUserTurn on an unknown id is a no-op', () => {
    const c = new Conversation();
    c.addUser('A');
    c.editUserTurn(999, 'nope');
    expect(c.turns).toHaveLength(1);
    expect(c.firstAnswer).toBe('A');
  });

  test('reading and photo turns are ignored by the grade payload', () => {
    const c = new Conversation();
    c.addPhoto('my notes');
    c.addReading('the reading');
    expect(c.toGradePayload()).toEqual([]);
    expect(c.firstAnswer).toBe('');
  });

  test('clear resets turns but keeps issuing fresh ids', () => {
    const c = new Conversation();
    c.addUser('A');
    c.clear();
    expect(c.turns).toEqual([]);
    const id = c.addUser('B');
    expect(id).toBe(2); // ids never collide across a clear
  });
});
