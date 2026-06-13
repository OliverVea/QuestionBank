import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { unstashPhotos } from '@/lib/photo-transfer';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import '@/styles/gridpad.css';
import './GradePage.css';

type Grade = 'correct' | 'partial' | 'incorrect';
interface GradingIssue { severity: string; description: string }
interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export function GradePage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const questionId = params.get('questionId') ?? '';
  const mode = params.get('mode') as 'photo' | 'type' ?? 'type';
  const from = params.get('from') === 'revisit' ? 'revisit' : 'learn';

  const conversation: Turn[] = [];
  let lastRecommendedGrade: Grade | null = null;
  let lastIssues: GradingIssue[] = [];
  let firstAnswer = '';

  const chat = ChatContainer();
  chat.el.classList.add('gridpad');

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

  // ---- Grade buttons ----
  const gradeRow = html`<div class="grade-row">
    <button class="grade-btn gb-incorrect" data-grade="incorrect" type="button">Incorrect</button>
    <button class="grade-btn gb-partial" data-grade="partial" type="button">Partial</button>
    <button class="grade-btn gb-correct" data-grade="correct" type="button">Correct</button>
  </div>`;
  gradeRow.hidden = true;

  function updateSuggested() {
    gradeRow.querySelectorAll('.grade-btn').forEach((btn) => {
      btn.classList.toggle('suggested', (btn as HTMLElement).dataset.grade === lastRecommendedGrade);
    });
  }

  gradeRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-grade]') as HTMLElement | null;
    if (!btn) return;
    void saveAttempt(btn.dataset.grade as Grade);
  });

  // ---- Reply row ----
  const reply = ReplyRow({
    placeholder: 'Clarify or add to your answer…',
    onSend(text) { void handleUserMessage(text); },
  });

  // ---- Skip ----
  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    void fetch(`/api/skip/${questionId}`, { method: 'POST' }).then(() => {
      window.location.hash = `#/${from}`;
    });
  });

  const topBar = TopBar({ onBack: () => { window.location.hash = `#/${from}`; }, right: skipBtn });

  // ---- Page shell ----
  const page = html`<div class="grade-page">
    ${topBar}
    ${qfold}
    ${chat.el}
    <footer class="grade-actions">
      ${reply.el}
      ${gradeRow}
    </footer>
  </div>`;

  // ---- Render a grader response ----
  function renderGraderBubble(data: { reasoning: string; issues: GradingIssue[]; recommendedGrade: Grade }) {
    lastRecommendedGrade = data.recommendedGrade;
    lastIssues = data.issues;
    const bubble = ChatBubble('agent');

    // Badge
    const badge = document.createElement('span');
    badge.className = `grade-badge grade-${data.recommendedGrade}`;
    badge.textContent = data.recommendedGrade;
    bubble.appendChild(badge);

    // Issues or "no issues"
    if (data.issues.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'grade-ok';
      ok.textContent = 'No issues found — looks correct.';
      bubble.appendChild(ok);
    } else {
      const list = document.createElement('ul');
      list.className = 'issue-list';
      for (const issue of data.issues) {
        const li = document.createElement('li');
        li.className = `issue issue-${issue.severity}`;
        const sev = document.createElement('span');
        sev.className = 'issue-sev';
        sev.textContent = issue.severity;
        const desc = document.createElement('span');
        desc.className = 'issue-desc';
        renderLatex(desc, issue.description);
        li.append(sev, desc);
        list.appendChild(li);
      }
      bubble.appendChild(list);
    }

    // Collapsible reasoning
    const det = document.createElement('details');
    det.className = 'reasoning';
    const sum = document.createElement('summary');
    sum.textContent = 'Show reasoning';
    const rb = document.createElement('div');
    rb.className = 'reasoning-body';
    renderLatex(rb, data.reasoning);
    det.append(sum, rb);
    bubble.appendChild(det);

    chat.append(bubble);
    gradeRow.hidden = false;
    updateSuggested();
  }

  // ---- Grade API call ----
  async function doGrade() {
    reply.disable();
    const thinking = ThinkingBubble('Grading…');
    chat.append(thinking);

    try {
      const res = await fetch(`/api/questions/${questionId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation }),
      });
      thinking.remove();
      if (!res.ok) throw new Error('grade failed');
      const data = await res.json() as { reasoning: string; issues: GradingIssue[]; recommendedGrade: Grade };
      conversation.push({ role: 'assistant', text: JSON.stringify(data) });
      renderGraderBubble(data);
    } catch {
      thinking.remove();
      const err = ChatBubble('agent');
      err.textContent = 'Grading failed. Send your message again to retry.';
      chat.append(err);
    } finally {
      reply.enable();
    }
  }

  // ---- Handle user message (clarification or first answer) ----
  async function handleUserMessage(text: string) {
    if (!firstAnswer) firstAnswer = text;
    conversation.push({ role: 'user', text });

    const bubble = ChatBubble('user');
    const body = document.createElement('div');
    renderLatex(body, text);
    bubble.appendChild(body);
    chat.append(bubble);

    await doGrade();
  }

  // ---- Save attempt ----
  async function saveAttempt(rating: Grade) {
    try {
      await fetch(`/api/questions/${questionId}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: firstAnswer,
          recommendedGrade: lastRecommendedGrade,
          rating,
          issues: lastIssues,
        }),
      });
      window.location.hash = `#/${from}`;
    } catch {
      const err = ChatBubble('agent');
      err.textContent = 'Failed to save. Try again.';
      chat.append(err);
    }
  }

  // ---- Photo mode: read stashed photos ----
  function startPhotoFlow() {
    const transfer = unstashPhotos();

    if (transfer && transfer.files.length > 0) {
      void transcribePhotos(transfer.files, transfer.notes);
    } else {
      showPhotoCapture();
    }
  }

  function showPhotoCapture() {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-capture';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    const label = html`<button class="solution-btn" type="button">
      <span class="sb-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A2 2 0 0 1 11.8 4h.4a2 2 0 0 1 1.6.8L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.2"/></svg></span>
      Take a photo of your solution
    </button>`;
    label.addEventListener('click', () => input.click());
    wrapper.append(input, label);
    chat.append(wrapper);

    input.addEventListener('change', () => {
      const files = input.files;
      if (!files?.length) return;
      wrapper.remove();
      void transcribePhotos([...files], '');
    });
  }

  async function transcribePhotos(files: File[], notes: string) {
    // Show photo thumbnails as user bubble
    const bubble = ChatBubble('user');
    bubble.classList.add('photo-bubble');
    for (const file of files) {
      const img = document.createElement('img');
      img.className = 'photo-thumb';
      img.src = URL.createObjectURL(file);
      img.alt = 'Your solution';
      bubble.appendChild(img);
    }
    if (notes) {
      const noteEl = document.createElement('div');
      noteEl.className = 'photo-notes-text';
      noteEl.textContent = notes;
      bubble.appendChild(noteEl);
    }
    chat.append(bubble);

    const thinking = ThinkingBubble('Transcribing…');
    chat.append(thinking);
    reply.disable();

    const form = new FormData();
    for (const file of files) form.append('images', file);
    if (notes) form.append('notes', notes);

    try {
      const res = await fetch(`/api/questions/${questionId}/transcribe`, {
        method: 'POST',
        body: form,
      });
      thinking.remove();
      if (!res.ok) throw new Error('transcribe failed');
      const { transcription } = await res.json() as { transcription: string };
      await handleUserMessage(transcription);
    } catch {
      thinking.remove();
      const err = ChatBubble('agent');
      err.textContent = 'Transcription failed. Try typing your answer instead.';
      chat.append(err);
      reply.enable();
    }
  }

  // ---- Boot: fetch question + start flow ----
  async function boot() {
    try {
      const [qRes, bRes] = await Promise.all([
        fetch(`/api/questions/${questionId}`),
        // We'll get bookId from question response, but fetch both in parallel is tricky.
        // Fetch question first, then book.
        null,
      ].filter(Boolean));
      if (!qRes || !qRes.ok) throw new Error('question not found');
      const question = await qRes.json() as { canonicalText: string; label: string; bookId: string };
      renderLatex(qBody, question.canonicalText);

      // Fetch book for eyebrow
      try {
        const bookRes = await fetch(`/api/books/${question.bookId}`);
        if (bookRes.ok) {
          const book = await bookRes.json() as { title: string };
          qEyebrow.textContent = `${book.title} · ${question.label}`;
        } else {
          qEyebrow.textContent = question.label;
        }
      } catch {
        qEyebrow.textContent = question.label;
      }

      // Start the appropriate flow
      if (mode === 'photo') {
        startPhotoFlow();
      } else {
        reply.focus();
      }
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
