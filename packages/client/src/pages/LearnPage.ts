import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { QuestionCard } from '@/components/QuestionCard';
import { Spinner } from '@/components/Spinner';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { stashPhotos } from '@/lib/photo-transfer';
import '@/styles/gridpad.css';
import './LearnPage.css';

interface Question { id: string; bookId: string; label: string; canonicalText: string }
interface Book { title: string }
interface LearnNextResponse { question: Question | null; book?: Book }

export function LearnPage(): HTMLElement {
  const skipped = new Set<string>();
  let currentQuestion: Question | null = null;

  const eyebrow = html`<div class="qcard-eyebrow"><span></span></div>`;
  const qscroll = html`<div class="qscroll"></div>`;
  qscroll.appendChild(Spinner());
  const stage = html`<main class="learn-stage gridpad">${eyebrow}${qscroll}</main>`;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.hidden = true;

  const uploadBtn = html`<button class="solution-btn">
    <span class="sb-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A2 2 0 0 1 11.8 4h.4a2 2 0 0 1 1.6.8L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.2"/></svg></span>
    Upload picture of solution
  </button>`;
  const typeBtn = html`<button class="type-link">or type it instead</button>`;
  const footer = html`<footer class="learn-actions">${uploadBtn}${typeBtn}${fileInput}</footer>`;

  uploadBtn.addEventListener('click', () => {
    if (currentQuestion) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files?.length || !currentQuestion) return;
    const selected = [...files];
    fileInput.value = '';
    showPhotoModal(selected);
  });

  function showPhotoModal(initialFiles: File[]) {
    const modal = PhotoReviewModal({
      initialFiles,
      onPost({ files, notes }) {
        stashPhotos({ files, notes });
        window.location.hash = `#/grade?questionId=${currentQuestion!.id}&mode=photo`;
      },
      onCancel() { /* nothing — user stays on learn page */ },
    });
    document.body.appendChild(modal);
  }

  typeBtn.addEventListener('click', () => {
    if (currentQuestion) window.location.hash = `#/grade?questionId=${currentQuestion.id}&mode=type`;
  });

  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    if (!currentQuestion) return;
    skipped.add(currentQuestion.id);
    void loadNext();
  });

  const topBar = TopBar({ onBack: () => { window.location.hash = '#/'; }, right: skipBtn });

  const page = html`<div class="learn-page anim-cascade">${topBar}${stage}${footer}</div>`;

  function render(data: LearnNextResponse) {
    if (!data.question || !data.book) {
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! No new questions to learn.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
    currentQuestion = data.question;
    eyebrow.querySelector('span')!.textContent = `${data.book.title} · ${data.question.label}`;
    const card = QuestionCard({ canonicalText: data.question.canonicalText });
    card.classList.add('animate-in');
    card.style.setProperty('--i', '0');
    qscroll.replaceChildren(card);
    footer.hidden = false;
    skipBtn.hidden = false;
  }

  function renderError() {
    currentQuestion = null;
    const retry = html`<button class="type-link">Try again</button>`;
    retry.addEventListener('click', () => void loadNext());
    qscroll.replaceChildren(html`<div class="learn-empty">Something went wrong.</div>`, retry);
    footer.hidden = true;
    skipBtn.hidden = true;
  }

  async function loadNext() {
    const excludeParam = skipped.size > 0 ? `?exclude=${[...skipped].join(',')}` : '';
    try {
      // Try new questions first
      const res = await fetch(`/api/learn/next${excludeParam}`);
      if (!res.ok) { renderError(); return; }
      const data = await res.json() as LearnNextResponse;
      if (data.question) { render(data); return; }

      // No new questions — check for due reviews
      const dueRes = await fetch('/api/practice/due');
      if (!dueRes.ok) { render(data); return; }
      const dueItems = await dueRes.json() as { question: Question; book: { title: string } }[];
      const eligible = dueItems.find((d) => !skipped.has(d.question.id));
      if (eligible) {
        render({ question: eligible.question, book: eligible.book });
      } else {
        render(data); // shows "all caught up"
      }
    } catch {
      renderError();
    }
  }

  void loadNext();
  return page;
}
