// packages/client/src/pages/grade/conversation.ts
import type { Grade, IssueSeverity, GradingIssue } from '@/lib/types';

// Re-export so the grade-page modules can import these from one place.
export type { Grade, IssueSeverity, GradingIssue };
export interface GradePayload {
  reasoning: string;
  issues: GradingIssue[];
  recommendedGrade: Grade;
}

export type Turn =
  | { id: number; role: 'user'; kind: 'text'; text: string }
  | { id: number; role: 'user'; kind: 'photo'; notes: string }
  | { id: number; role: 'assistant'; kind: 'reading'; text: string }
  | { id: number; role: 'assistant'; kind: 'grade'; payload: GradePayload };

export interface ApiTurn { role: 'user' | 'assistant'; text: string }

/**
 * The grade page's source of truth. Pure — no DOM, no fetch. The orchestrator
 * mutates it and calls render(); the photo flow clears it on the handoff from
 * the transcription chat to the grading chat.
 */
export class Conversation {
  private _turns: Turn[] = [];
  private nextId = 1;

  get turns(): readonly Turn[] { return this._turns; }

  /** First user *text* turn — the answer recorded on the Attempt. */
  get firstAnswer(): string {
    const t = this._turns.find((x) => x.role === 'user' && x.kind === 'text');
    return t && t.kind === 'text' ? t.text : ''; // re-narrow: TS can't infer kind through Array.find's predicate
  }

  /** Most recent grader payload, or null if not graded yet. */
  get latestGrade(): GradePayload | null {
    for (let i = this._turns.length - 1; i >= 0; i--) {
      const t = this._turns[i];
      if (t !== undefined && t.kind === 'grade') return t.payload;
    }
    return null;
  }

  addUser(text: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'user', kind: 'text', text });
    return id;
  }

  addPhoto(notes: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'user', kind: 'photo', notes });
    return id;
  }

  addReading(text: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'assistant', kind: 'reading', text });
    return id;
  }

  addGrade(payload: GradePayload): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'assistant', kind: 'grade', payload });
    return id;
  }

  /** Rewrite a user text turn and drop every turn after it (revert to here). */
  editUserTurn(id: number, text: string): void {
    const idx = this._turns.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const turn = this._turns[idx];
    if (turn === undefined || turn.role !== 'user' || turn.kind !== 'text') return;
    this._turns[idx] = { id: turn.id, role: 'user', kind: 'text', text };
    this._turns.length = idx + 1;
  }

  /** Reset turns. nextId is intentionally NOT reset so ids stay unique across a clear. */
  clear(): void { this._turns = []; }

  /** Wire shape for POST /grade: user text + assistant grade turns only. */
  toGradePayload(): ApiTurn[] {
    const out: ApiTurn[] = [];
    for (const t of this._turns) {
      if (t.role === 'user' && t.kind === 'text') out.push({ role: 'user', text: t.text });
      else if (t.kind === 'grade') out.push({ role: 'assistant', text: JSON.stringify(t.payload) });
    }
    return out;
  }
}
