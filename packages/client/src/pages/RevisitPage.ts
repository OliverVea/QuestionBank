import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { QuestionCard } from '@/components/QuestionCard';
import { Spinner } from '@/components/Spinner';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
import { stashPhotos } from '@/lib/photo-transfer';
import '@/styles/gridpad.css';
import './LearnPage.css';

interface Question { id: string; bookId: string; label: string; canonicalText: string }
interface Book { title: string }
interface DueItem { question: Question; book: Book }

export function RevisitPage(): HTMLElement {
  let currentQuestion: Question | null = null;
  let loading = false;

  const eyebrow = html`<div class="qcard-eyebrow"><span></span></div>`;
  const qscroll = html`<div class="qscroll"></div>`;
  qscroll.appendChild(Spinner());
  const stage = html`<main class="learn-stage gridpad">${eyebrow}${qscroll}</main>`;

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
    void fetch(`/api/skip/${id}`, { method: 'POST' }).then(() => loadNext());
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
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! Nothing to revisit.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
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
      const res = await fetch('/api/practice/due');
      if (!res.ok) { renderError(); return; }
      const items = await res.json() as DueItem[];
      render(items[0] ?? null);
    } catch {
      renderError();
    }
  }

  void loadNext();
  return page;
}
