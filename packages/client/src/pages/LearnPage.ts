import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { QuestionCard } from '@/components/QuestionCard';
import { Spinner } from '@/components/Spinner';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
import { stashPhotos } from '@/lib/photo-transfer';
import { shouldPause, getCount, getLastChapter, reset } from '@/lib/session';
import { splitLabel } from '@/lib/problem-grouping';
import { SessionPause } from '@/components/SessionPause';
import './LearnPage.css';

interface Question { id: string; bookId: string; label: string; canonicalText: string }
interface Book { title: string }
interface LearnNextResponse { question: Question | null; book?: Book }

export function LearnPage(): HTMLElement {
  let currentQuestion: Question | null = null;
  let loading = false;

  const eyebrow = html`<div class="qcard-eyebrow"><span></span></div>`;
  const qscroll = html`<div class="qscroll"></div>`;
  qscroll.appendChild(Spinner());
  const stage = html`<main class="learn-stage">${eyebrow}${qscroll}</main>`;

  const picker = ImageSourcePicker({
    cameraLabel: 'Camera',
    deviceLabel: 'Device',
    onFiles(selected) {
      if (!selected.length || !currentQuestion || loading) return;
      showPhotoModal(selected);
    },
  });
  const typeBtn = html`<button class="type-link">or type it instead</button>`;
  const footer = html`<footer class="learn-actions">${picker}${typeBtn}</footer>`;

  function showPhotoModal(initialFiles: File[]) {
    const modal = PhotoReviewModal({
      initialFiles,
      onPost({ files, notes }) {
        stashPhotos({ files, notes });
        window.location.hash = `#/grade?questionId=${currentQuestion!.id}&mode=photo&from=learn`;
      },
      onCancel() { /* nothing — user stays on learn page */ },
    });
    document.body.appendChild(modal);
  }

  typeBtn.addEventListener('click', () => {
    if (currentQuestion && !loading) window.location.hash = `#/grade?questionId=${currentQuestion.id}&mode=type&from=learn`;
  });

  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    if (!currentQuestion || loading) return;
    const id = currentQuestion.id;
    // Bug 1 fix: disable actions immediately to prevent race
    setActionsEnabled(false);
    void authFetch(`/api/skip/${id}`, { method: 'POST' }).then(() => loadNext());
  });

  const topBar = TopBar({ onBack: () => { window.location.hash = '#/'; }, right: skipBtn });

  const page = html`<div class="learn-page anim-cascade">${topBar}${stage}${footer}</div>`;

  function setActionsEnabled(enabled: boolean) {
    picker.querySelectorAll('button').forEach((b) => { b.disabled = !enabled; });
    (typeBtn as HTMLButtonElement).disabled = !enabled;
    (skipBtn as HTMLButtonElement).disabled = !enabled;
  }

  function render(data: LearnNextResponse) {
    loading = false;
    const { question, book } = data;
    if (!question || !book) {
      reset('learn'); // "All caught up!" is a natural session end — start fresh next visit.
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! No new questions to learn.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
    const nextChapter = splitLabel(question.label)?.chapter ?? null;
    if (shouldPause('learn', { nextChapter })) {
      showPause(question, book);
      return;
    }
    renderQuestion(question, book);
  }

  function showPause(question: Question, book: Book) {
    currentQuestion = null; // suppress upload/type/skip while paused
    eyebrow.querySelector('span')!.textContent = '';
    footer.hidden = true;
    skipBtn.hidden = true;
    const pause = SessionPause({
      mode: 'learn',
      count: getCount('learn'),
      title: `Chapter ${getLastChapter('learn')} done!`,
      onContinue: () => renderQuestion(question, book),
      onBreak: () => { reset('learn'); window.location.hash = '#/'; },
    });
    qscroll.replaceChildren(pause);
  }

  function renderQuestion(question: Question, book: Book) {
    currentQuestion = question;
    eyebrow.querySelector('span')!.textContent = `${book.title} · ${question.label}`;
    const card = QuestionCard({ canonicalText: question.canonicalText });
    card.classList.add('animate-in');
    card.style.setProperty('--i', '0');
    qscroll.replaceChildren(card);
    footer.hidden = false;
    skipBtn.hidden = false;
    setActionsEnabled(true);
  }

  function renderError() {
    loading = false;
    currentQuestion = null;
    const retry = html`<button class="type-link">Try again</button>`;
    retry.addEventListener('click', () => void loadNext());
    qscroll.replaceChildren(html`<div class="learn-empty">Something went wrong.</div>`, retry);
    footer.hidden = true;
    skipBtn.hidden = true;
  }

  async function loadNext() {
    if (loading) return; // Bug 6: prevent concurrent calls
    loading = true;
    setActionsEnabled(false);
    try {
      const res = await authFetch('/api/learn/next');
      if (!res.ok) { renderError(); return; }
      render(await res.json() as LearnNextResponse);
    } catch {
      renderError();
    }
  }

  void loadNext();
  return page;
}
