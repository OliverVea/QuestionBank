import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import { recordCompleted } from '@/lib/session';
import { splitLabel } from '@/lib/problem-grouping';
import { Conversation } from './grade/conversation';
import type { Grade, Turn } from './grade/conversation';
import * as gradeApi from './grade/grade-api';
import { GraderBubble } from './grade/GraderBubble';
import { UserBubble } from './grade/UserBubble';
import { ReadingBubble } from './grade/ReadingBubble';
import { PhotoBubble } from '@/components/PhotoBubble';
import './GradePage.css';

type Phase = 'transcribe' | 'grade';

export function GradePage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const questionId = params.get('questionId') ?? '';
  const mode = (params.get('mode') as 'photo' | 'type') ?? 'type';
  const from = params.get('from') === 'revisit' ? 'revisit' : 'learn';

  // ---- State ----
  const convo = new Conversation();
  let phase: Phase = 'grade';
  let sending = false;
  let editingId: number | null = null;
  let transient: HTMLElement | null = null;     // capture prompt / thinking bubble
  let photoFiles: File[] = [];                   // kept for /transcribe/retry
  let completedChapter: string | null = null;

  const chat = ChatContainer();

  // ---- Question fold ----
  const qEyebrow = document.createElement('span');
  qEyebrow.className = 'qfold-ctx';
  const qBody = document.createElement('div');
  qBody.className = 'qfold-body';
  const qfold = html`<details class="qfold">
    <summary class="qfold-summary">
      <span class="qfold-label">Question</span>
      ${qEyebrow}
      <span class="qfold-chev" aria-hidden="true">⌄</span>
    </summary>
    ${qBody}
  </details>`;

  // ---- Phase bar (photo flow only) ----
  const phaseStep = html`<span class="phase-step"></span>`;
  const phaseName = html`<span class="phase-name"></span>`;
  const phaseBar = html`<div class="phase-bar">${phaseStep}${phaseName}</div>`;
  phaseBar.hidden = true;

  // ---- Footer controls ----
  const reply = ReplyRow({
    placeholder: 'Clarify or add to your answer…',
    onSend(text) { void onSend(text); },
  });

  const advanceBtn = html`<button class="advance-btn" type="button">Looks good — grade it →</button>`;
  advanceBtn.hidden = true;
  advanceBtn.addEventListener('click', () => { void enterGradePhase(); });

  const gradeRow = html`<div class="grade-row">
    <button class="grade-btn gb-incorrect" data-grade="incorrect" type="button">Incorrect</button>
    <button class="grade-btn gb-partial" data-grade="partial" type="button">Partial</button>
    <button class="grade-btn gb-correct" data-grade="correct" type="button">Correct</button>
  </div>`;
  gradeRow.hidden = true;
  gradeRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-grade]') as HTMLElement | null;
    if (btn) void saveAttempt(btn.dataset.grade as Grade);
  });

  // ---- Skip + top bar ----
  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    void gradeApi.skip(questionId).then(() => { window.location.hash = `#/${from}`; });
  });
  const topBar = TopBar({ onBack: () => { window.location.hash = `#/${from}`; }, right: skipBtn });

  const page = html`<div class="grade-page">
    ${topBar}
    ${qfold}
    ${phaseBar}
    ${chat.el}
    <footer class="grade-actions">
      ${reply.el}
      ${advanceBtn}
      ${gradeRow}
    </footer>
  </div>`;

  // ---- Render from state ----
  function buildTurn(turn: Turn): HTMLElement {
    if (turn.role === 'user' && turn.kind === 'photo') return PhotoBubble(photoFiles, { notes: turn.notes });
    if (turn.role === 'user' && turn.kind === 'text') {
      return UserBubble(
        { id: turn.id, text: turn.text },
        {
          editable: phase === 'grade' && !sending,
          editing: editingId === turn.id,
          onEdit: (id) => { editingId = id; render(); },
          onCancel: () => { editingId = null; render(); },
          onSave: (id, text) => {
            editingId = null;
            convo.editUserTurn(id, text);
            render();
            void doGrade();
          },
        },
      );
    }
    if (turn.kind === 'reading') return ReadingBubble(turn.text);
    return GraderBubble(turn.payload);
  }

  function render(): void {
    chat.clear();
    for (const turn of convo.turns) chat.el.appendChild(buildTurn(turn));
    if (transient) chat.el.appendChild(transient);

    phaseBar.hidden = mode !== 'photo';
    if (mode === 'photo') {
      phaseStep.textContent = phase === 'transcribe' ? 'Step 1 of 2' : 'Step 2 of 2';
      phaseName.textContent = phase === 'transcribe' ? 'Check the reading' : 'Grading';
    }

    if (phase === 'transcribe') {
      reply.setPlaceholder('Tell me what to fix…');
      advanceBtn.hidden = !convo.turns.some((t) => t.kind === 'reading');
      gradeRow.hidden = true;
    } else {
      reply.setPlaceholder('Clarify or add to your answer…');
      advanceBtn.hidden = true;
      gradeRow.hidden = convo.latestGrade === null;
      const suggested = convo.latestGrade?.recommendedGrade ?? null;
      gradeRow.querySelectorAll('.grade-btn').forEach((b) => {
        (b as HTMLElement).classList.toggle('suggested', (b as HTMLElement).dataset.grade === suggested);
      });
    }
    reply.setSending(sending);
  }

  // ---- Grading flow (Task 11 fills doGrade/onSend/saveAttempt) ----
  async function doGrade(): Promise<void> {
    sending = true;
    const thinking = ThinkingBubble('Grading…');
    transient = thinking;
    render();
    chat.scrollToBottom();
    try {
      const payload = await gradeApi.grade(questionId, convo.toGradePayload());
      transient = null;
      convo.addGrade(payload);
      sending = false;
      render();
      const agents = chat.el.querySelectorAll('.chat-bubble-agent');
      const last = agents[agents.length - 1] as HTMLElement | undefined;
      if (last) chat.scrollToNode(last);
    } catch {
      transient = null;
      sending = false;
      render();
      const err = ChatBubble('agent');
      err.textContent = 'Grading failed. Send your message again to retry.';
      chat.el.appendChild(err);
    }
  }

  async function onSend(text: string): Promise<void> {
    if (phase === 'transcribe') {
      convo.addUser(text);          // a correction
      render();
      chat.scrollToBottom();
      await reReadPhoto(text);
    } else {
      convo.addUser(text);          // an answer / clarification
      render();
      chat.scrollToBottom();
      await doGrade();
    }
  }

  async function saveAttempt(rating: Grade): Promise<void> {
    const latest = convo.latestGrade;
    try {
      await gradeApi.saveAttempt(questionId, {
        answer: convo.firstAnswer,
        recommendedGrade: latest?.recommendedGrade ?? rating,
        rating,
        issues: latest?.issues ?? [],
      });
      recordCompleted(from, completedChapter);
      window.location.hash = `#/${from}`;
    } catch {
      const err = ChatBubble('agent');
      err.textContent = 'Failed to save. Try again.';
      chat.el.appendChild(err);
    }
  }

  async function enterGradePhase(): Promise<void> { /* Task 13 */ }

  async function reReadPhoto(_correction: string): Promise<void> { /* Task 13 */ }

  // ---- Boot ----
  async function boot(): Promise<void> {
    try {
      const qRes = await fetch(`/api/questions/${questionId}`);
      if (!qRes.ok) throw new Error('question not found');
      const question = await qRes.json() as { canonicalText: string; label: string; bookId: string };
      completedChapter = splitLabel(question.label)?.chapter ?? null;
      renderLatex(qBody, question.canonicalText);
      try {
        const bRes = await fetch(`/api/books/${question.bookId}`);
        qEyebrow.textContent = bRes.ok ? `${(await bRes.json() as { title: string }).title} · ${question.label}` : question.label;
      } catch { qEyebrow.textContent = question.label; }

      if (mode === 'photo') { /* Task 13: startPhotoFlow() */ }
      else { phase = 'grade'; render(); chat.scrollToTop(); reply.focus(); }
    } catch {
      qEyebrow.textContent = 'Error';
      const err = ChatBubble('agent');
      err.textContent = 'Failed to load question. Go back and try again.';
      chat.append(err);
    }
  }

  void boot();
  return page;
}
