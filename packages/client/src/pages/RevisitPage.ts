import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { QuestionCard } from '@/components/QuestionCard';
import { Spinner } from '@/components/Spinner';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
import { stashPhotos } from '@/lib/photo-transfer';
import { shouldPause, getCount, reset } from '@/lib/session';
import { SessionPause } from '@/components/SessionPause';
import './LearnPage.css';

interface Question { id: string; bookId: string; label: string; canonicalText: string }
interface Book { title: string }
interface DueItem { question: Question; book: Book }

export function RevisitPage(): HTMLElement {
  let currentQuestion: Question | null = null;
  let loading = false;
  let pauseEvery = 10;

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
        window.location.hash = `#/grade?questionId=${currentQuestion!.id}&mode=photo&from=revisit`;
      },
      onCancel() {},
    });
    document.body.appendChild(modal);
  }

  typeBtn.addEventListener('click', () => {
    if (currentQuestion && !loading) window.location.hash = `#/grade?questionId=${currentQuestion.id}&mode=type&from=revisit`;
  });

  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    if (!currentQuestion || loading) return;
    const id = currentQuestion.id;
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

  function render(item: DueItem | null) {
    loading = false;
    if (!item) {
      reset('revisit'); // "All caught up!" is a natural session end.
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! Nothing to revisit.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
    if (shouldPause('revisit', { pauseEvery })) {
      showPause(item);
      return;
    }
    renderQuestion(item);
  }

  function showPause(item: DueItem) {
    currentQuestion = null; // suppress upload/type/skip while paused
    eyebrow.querySelector('span')!.textContent = '';
    footer.hidden = true;
    skipBtn.hidden = true;
    const pause = SessionPause({
      mode: 'revisit',
      count: getCount('revisit'),
      title: `Nice — ${getCount('revisit')} reviews done!`,
      onContinue: () => renderQuestion(item),
      onBreak: () => { reset('revisit'); window.location.hash = '#/'; },
    });
    qscroll.replaceChildren(pause);
  }

  function renderQuestion(item: DueItem) {
    currentQuestion = item.question;
    eyebrow.querySelector('span')!.textContent = `${item.book.title} · ${item.question.label}`;
    const card = QuestionCard({ canonicalText: item.question.canonicalText });
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
    if (loading) return;
    loading = true;
    setActionsEnabled(false);
    try {
      const res = await authFetch('/api/practice/due');
      if (!res.ok) { renderError(); return; }
      const items = await res.json() as DueItem[];
      render(items[0] ?? null);
    } catch {
      renderError();
    }
  }

  void authFetch('/api/settings')
    .then((r) => (r.ok ? (r.json() as Promise<{ pauseEvery?: number }>) : null))
    .then((s) => { if (s && typeof s.pauseEvery === 'number') pauseEvery = s.pauseEvery; })
    .catch(() => { /* keep the default 10 */ });
  void loadNext();
  return page;
}
