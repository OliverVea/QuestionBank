// packages/client/src/pages/grade/grade-api.ts
import type { ApiTurn, Grade, GradePayload, GradingIssue } from './conversation';
import { authFetch } from '@/lib/auth';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function transcribe(questionId: string, files: File[], notes: string): Promise<string> {
  const form = new FormData();
  for (const f of files) form.append('images', f);
  if (notes) form.append('notes', notes);
  const res = await authFetch(`/api/questions/${questionId}/transcribe`, { method: 'POST', body: form });
  const { transcription } = await jsonOrThrow<{ transcription: string }>(res);
  return transcription;
}

export async function retranscribe(
  questionId: string, files: File[], currentTranscription: string, correctionNote: string,
): Promise<string> {
  const form = new FormData();
  for (const f of files) form.append('images', f);
  form.append('currentTranscription', currentTranscription);
  form.append('correctionNote', correctionNote);
  const res = await authFetch(`/api/questions/${questionId}/transcribe/retry`, { method: 'POST', body: form });
  const { transcription } = await jsonOrThrow<{ transcription: string }>(res);
  return transcription;
}

export async function grade(questionId: string, conversation: ApiTurn[]): Promise<GradePayload> {
  const res = await authFetch(`/api/questions/${questionId}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation }),
  });
  return jsonOrThrow<GradePayload>(res);
}

export async function saveAttempt(
  questionId: string,
  body: { answer: string; recommendedGrade: Grade; rating: Grade; issues: GradingIssue[] },
): Promise<void> {
  const res = await authFetch(`/api/questions/${questionId}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

export async function skip(questionId: string): Promise<void> {
  const res = await authFetch(`/api/skip/${questionId}`, { method: 'POST' });
  if (!res.ok) throw new Error(`skip failed: ${res.status}`);
}
