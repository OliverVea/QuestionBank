import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import { unstashPhotos } from '@/lib/photo-transfer';
import './ScanProblemsPage.css';

const SCAN_ACCEPTED_KEY = 'qb-scan-accepted';

interface DeltaItem {
  kind: 'add' | 'edit';
  label?: string | undefined;
  canonicalText: string;
  before?: string;
}

interface CardRecord {
  item: DeltaItem;
  el: HTMLElement;
  accepted: boolean;
}

export function ScanProblemsPage(): HTMLElement {
  // Pull the photo passed in-memory from the problems list (cleared on read).
  const transfer = unstashPhotos();
  const photoFile = transfer?.files[0] ?? null;

  // Guard: redirect if no photo context available.
  if (!photoFile) {
    window.location.hash = '#/manage-books';
    return html`<div></div>`;
  }

  const cards: CardRecord[] = [];
  let liveProposalEl: HTMLElement | null = null;
  let imageFile: File | null = null;
  let currentExtraction: { canonicalText: string; label?: string }[] = [];

  const chat = ChatContainer();

  const applyCount = document.createElement('span');
  applyCount.className = 'sp-apply-count';
  const applyBtn = html`<button class="sp-apply" type="button" disabled>
    Add to book ${applyCount}
  </button>`;

  function syncApply() {
    const n = cards.filter((c) => c.accepted).length;
    applyCount.textContent = n ? `· ${n}` : '';
    (applyBtn as HTMLButtonElement).disabled = n === 0;
  }

  // ---- Photo bubble ----
  function addPhotoBubble(dataUrl: string | null) {
    const msg = ChatBubble('user');
    msg.classList.add('sp-photo');
    if (dataUrl) {
      const img = document.createElement('img');
      img.className = 'sp-thumb';
      img.alt = 'Photographed problems page';
      img.src = dataUrl;
      msg.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'sp-thumb';
      ph.style.cssText = 'display:flex;align-items:center;justify-content:center;height:140px;color:var(--muted);font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;border:1px dashed var(--border);';
      ph.textContent = 'page photo';
      msg.appendChild(ph);
    }
    const cap = document.createElement('div');
    cap.className = 'sp-cap';
    cap.textContent = 'Pull the problems off this page.';
    msg.appendChild(cap);
    chat.append(msg);
  }

  // ---- Delta card ----
  function makeCard(item: DeltaItem): HTMLElement {
    const card = document.createElement('div');
    card.className = `sp-delta-card sp-${item.kind}`;

    const tag = document.createElement('span');
    tag.className = `sp-delta-tag sp-tag-${item.kind}`;
    tag.textContent = item.kind === 'add' ? 'New' : 'Edit';

    const label = document.createElement('span');
    label.className = 'sp-delta-label';
    label.textContent = item.label || '—';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sp-delta-toggle on';

    const head = document.createElement('div');
    head.className = 'sp-delta-head';
    head.append(tag, label, toggle);
    card.appendChild(head);

    if (item.kind === 'add') {
      const body = document.createElement('div');
      body.className = 'sp-delta-body';
      renderLatex(body, item.canonicalText);
      card.appendChild(body);
    } else {
      const before = document.createElement('div');
      before.className = 'sp-delta-before';
      renderLatex(before, item.before ?? '');
      const arrow = document.createElement('div');
      arrow.className = 'sp-delta-arrow';
      arrow.textContent = '↓';
      const after = document.createElement('div');
      after.className = 'sp-delta-after';
      renderLatex(after, item.canonicalText);
      card.append(before, arrow, after);
    }

    const rec: CardRecord = { item, el: card, accepted: true };
    cards.push(rec);

    function syncToggle() {
      card.classList.toggle('sp-rejected', !rec.accepted);
      toggle.textContent = rec.accepted ? 'Added ✓' : 'Add';
      toggle.classList.toggle('on', rec.accepted);
    }
    toggle.addEventListener('click', () => {
      rec.accepted = !rec.accepted;
      syncToggle();
      syncApply();
    });
    syncToggle();
    return card;
  }

  // ---- Agent reply (delta proposal) ----
  function addAgentReply(delta: DeltaItem[], introText?: string) {
    if (liveProposalEl) liveProposalEl.classList.add('sp-superseded');
    cards.length = 0;

    const adds = delta.filter((d) => d.kind === 'add').length;
    const edits = delta.filter((d) => d.kind === 'edit').length;

    const msg = ChatBubble('agent');

    const intro = document.createElement('div');
    intro.className = 'sp-delta-intro';
    if (introText) {
      renderLatex(intro, introText);
    } else {
      const parts: string[] = [];
      if (adds) parts.push(`${adds} new problem${adds === 1 ? '' : 's'}`);
      if (edits) parts.push(`a fix to ${edits} existing one${edits === 1 ? '' : 's'}`);
      intro.textContent = parts.length
        ? `I found ${parts.join(' and ')} on that page. Toggle any you don't want, then Add to book.`
        : 'I couldn\'t find any problems on that page.';
    }
    msg.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'sp-delta-list';
    for (const item of delta) list.appendChild(makeCard(item));
    msg.appendChild(list);

    chat.append(msg);
    liveProposalEl = msg;
    syncApply();
  }

  // ---- User refinement message ----
  function addUserMessage(text: string) {
    const msg = ChatBubble('user');
    const body = document.createElement('div');
    body.textContent = text;
    msg.appendChild(body);
    chat.append(msg);
  }

  // ---- Send refinement ----
  let refining = false;
  const reply = ReplyRow({
    placeholder: 'Refine the problems…',
    onSend(text) { void sendRefine(text); },
  });

  async function sendRefine(text: string) {
    if (!imageFile || refining) return;
    refining = true;
    reply.disable();

    addUserMessage(text);
    const thinking = ThinkingBubble('Reading the page…');
    chat.append(thinking);

    const form = new FormData();
    form.append('image', imageFile);
    form.append('currentExtraction', JSON.stringify(currentExtraction));
    form.append('note', text);

    try {
      const res = await fetch('/api/extract/refine', { method: 'POST', body: form });
      if (!res.ok) throw new Error('refinement failed');
      const data: { questions: { canonicalText: string; label?: string }[] } = await res.json();
      thinking.remove();
      currentExtraction = data.questions;
      const delta: DeltaItem[] = data.questions.map((q) => ({
        kind: 'add' as const,
        label: q.label,
        canonicalText: q.canonicalText,
      }));
      addAgentReply(delta, 'Here\'s the updated set:');
    } catch {
      thinking.remove();
      addAgentReply([], 'Refinement failed. Try again or add what you have.');
    } finally {
      refining = false;
      reply.enable();
    }
  }

  // Apply: write accepted problems to sessionStorage and navigate back.
  applyBtn.addEventListener('click', () => {
    const accepted = cards
      .filter((c) => c.accepted)
      .map((c) => ({ label: c.item.label || '', latex: c.item.canonicalText }));
    sessionStorage.setItem(SCAN_ACCEPTED_KEY, JSON.stringify(accepted));
    window.history.back();
  });

  // ---- Boot: use the stashed photo File, start extraction ----
  imageFile = photoFile;
  addPhotoBubble(URL.createObjectURL(photoFile));
  startExtraction();

  async function startExtraction() {
    if (!imageFile) return;
    const thinking = ThinkingBubble('Reading the page…');
    chat.append(thinking);

    const form = new FormData();
    form.append('image', imageFile);

    try {
      const res = await fetch('/api/extract', { method: 'POST', body: form });
      if (!res.ok) throw new Error('extraction failed');
      const data: { questions: { canonicalText: string; label?: string }[] } = await res.json();
      thinking.remove();
      currentExtraction = data.questions;
      const delta: DeltaItem[] = data.questions.map((q) => ({
        kind: 'add' as const,
        label: q.label,
        canonicalText: q.canonicalText,
      }));
      addAgentReply(delta);
    } catch {
      thinking.remove();
      addAgentReply([], 'Extraction failed. Go back and try again.');
    }
  }

  const page = html`<div class="scan-page">
    ${TopBar({ onBack: () => window.history.back() })}
    ${chat.el}
    <footer class="sp-actions">
      ${reply.el}
      ${applyBtn}
    </footer>
  </div>`;

  return page;
}
