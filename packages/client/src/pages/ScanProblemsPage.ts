import { html } from '@/lib/html';
import { getAccessToken } from '@/lib/auth';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import { unstashPhotos } from '@/lib/photo-transfer';
import './ScanProblemsPage.css';

const SCAN_ACCEPTED_KEY = 'qb-scan-accepted';

type Relevance = 'high' | 'medium' | 'low';
interface Delta {
  kind: 'add' | 'edit' | 'skip';
  path?: string;
  canonicalText: string;
  targetId?: string;
  relevance?: Relevance;
}
interface NeedsSection {
  pageIndex: number;
  problems: Array<{ localLabel: string; canonicalText: string }>;
}
interface Envelope {
  resolved: Delta[];
  needsSection: NeedsSection[];
}

interface CardRecord {
  delta: Delta;
  el: HTMLElement;
  accepted: boolean;
}

export function ScanProblemsPage(): HTMLElement {
  const transfer = unstashPhotos();
  const files = transfer?.files ?? [];
  const bookId = transfer?.bookId ?? '';

  // Guard: redirect if no photo context.
  if (files.length === 0 || !bookId) {
    window.location.hash = '#/manage-books';
    return html`<div></div>`;
  }

  const cards: CardRecord[] = [];
  let current: Envelope = { resolved: [], needsSection: [] };
  let pendingPrompts = 0; // unanswered needsSection pages — blocks commit while > 0
  const sectionAnswers: Record<string, string> = {};
  // Agent bubbles (proposal + ambiguity prompts) from the current envelope. A refine
  // produces a fresh envelope, so the prior ones are dimmed + locked (sp-superseded) and
  // their now-orphaned toggles/inputs disabled, so stale controls can't mutate state.
  let liveBubbles: HTMLElement[] = [];

  /** Dim + lock the previous envelope's bubbles before rendering a new one. */
  function supersedeLiveBubbles() {
    for (const el of liveBubbles) {
      el.classList.add('sp-superseded');
      el.querySelectorAll('input, button').forEach((node) => {
        (node as HTMLInputElement | HTMLButtonElement).disabled = true;
      });
    }
    liveBubbles = [];
  }

  const chat = ChatContainer();

  const applyCount = document.createElement('span');
  applyCount.className = 'sp-apply-count';
  const applyBtn = html`<button class="sp-apply" type="button" disabled>
    Add to book ${applyCount}
  </button>`;

  function syncApply() {
    const n = cards.filter((c) => c.accepted && c.delta.kind !== 'skip').length;
    applyCount.textContent = n ? `· ${n}` : '';
    (applyBtn as HTMLButtonElement).disabled = n === 0 || pendingPrompts > 0;
  }

  // ---- Photo bubbles (one per page) ----
  function addPhotoBubbles() {
    for (const file of files) {
      const msg = ChatBubble('user');
      msg.classList.add('sp-photo');
      const img = document.createElement('img');
      img.className = 'sp-thumb';
      img.alt = 'Photographed problems page';
      const url = URL.createObjectURL(file);
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      img.src = url;
      msg.appendChild(img);
      chat.append(msg);
    }
    const cap = ChatBubble('user');
    cap.classList.add('sp-cap-bubble');
    const capText = document.createElement('div');
    capText.className = 'sp-cap';
    capText.textContent = `Pull the problems off ${files.length === 1 ? 'this page' : `these ${files.length} pages`}.`;
    cap.appendChild(capText);
    chat.append(cap);
  }

  // ---- Delta card ----
  function makeCard(delta: Delta, beforeText?: string): HTMLElement {
    const card = document.createElement('div');
    card.className = `sp-delta-card sp-${delta.kind}`;

    const tag = document.createElement('span');
    tag.className = `sp-delta-tag sp-tag-${delta.kind}`;
    tag.textContent = delta.kind === 'add' ? 'New' : delta.kind === 'edit' ? 'Edit' : 'Already in book';

    const label = document.createElement('span');
    label.className = 'sp-delta-label';
    label.textContent = delta.path || '—';

    const head = document.createElement('div');
    head.className = 'sp-delta-head';
    head.append(tag, label);

    // Relevance chip (only when the model scored it — i.e. the book had a learning goal).
    if (delta.relevance) {
      const rel = document.createElement('span');
      rel.className = `sp-delta-rel sp-rel-${delta.relevance}`;
      rel.textContent = delta.relevance;
      head.append(rel);
    }

    // skip rows are informational only — no accept toggle, muted, collapsed body.
    if (delta.kind === 'skip') {
      card.appendChild(head);
      cards.push({ delta, el: card, accepted: false });
      return card;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sp-delta-toggle on';
    head.append(toggle);
    card.appendChild(head);

    if (delta.kind === 'add') {
      const body = document.createElement('div');
      body.className = 'sp-delta-body';
      renderLatex(body, delta.canonicalText);
      card.appendChild(body);
    } else {
      const before = document.createElement('div');
      before.className = 'sp-delta-before';
      renderLatex(before, beforeText ?? '');
      const arrow = document.createElement('div');
      arrow.className = 'sp-delta-arrow';
      arrow.textContent = '↓';
      const after = document.createElement('div');
      after.className = 'sp-delta-after';
      renderLatex(after, delta.canonicalText);
      card.append(before, arrow, after);
    }

    const rec: CardRecord = { delta, el: card, accepted: true };
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

  // ---- Render the resolved deltas as a reply ----
  function renderResolved(resolved: Delta[], introText?: string) {
    cards.length = 0;
    const adds = resolved.filter((d) => d.kind === 'add').length;
    const edits = resolved.filter((d) => d.kind === 'edit').length;
    const skips = resolved.filter((d) => d.kind === 'skip').length;

    const msg = ChatBubble('agent');
    const intro = document.createElement('div');
    intro.className = 'sp-delta-intro';
    if (introText) {
      intro.textContent = introText;
    } else {
      const parts: string[] = [];
      if (adds) parts.push(`${adds} new`);
      if (edits) parts.push(`${edits} fix${edits === 1 ? '' : 'es'}`);
      if (skips) parts.push(`${skips} already in the book`);
      intro.textContent = parts.length
        ? `Found ${parts.join(', ')}. Toggle any you don't want, then Add to book.`
        : 'I couldn\'t find any problems on those pages.';
    }
    msg.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'sp-delta-list';
    for (const delta of resolved) {
      list.appendChild(makeCard(delta));
    }
    msg.appendChild(list);
    chat.append(msg);
    liveBubbles.push(msg);
    syncApply();
  }

  // ---- Ambiguity prompt per needsSection page ----
  function renderNeedsSection(pages: NeedsSection[]) {
    pendingPrompts = pages.length;
    for (const page of pages) {
      const msg = ChatBubble('agent');
      msg.classList.add('sp-needs-section');
      const q = document.createElement('div');
      q.className = 'sp-needs-q';
      const nums = page.problems.map((p) => p.localLabel).join(', ');
      q.textContent = `Page ${page.pageIndex + 1} shows problem${page.problems.length === 1 ? '' : 's'} ${nums} with no chapter/section. Which section are these in?`;
      msg.appendChild(q);

      const input = html`<input class="sp-needs-input" type="text" placeholder="e.g. 1.A" />` as HTMLInputElement;
      const go = html`<button class="sp-needs-go" type="button">Set</button>` as HTMLButtonElement;
      const row = document.createElement('div');
      row.className = 'sp-needs-row';
      row.append(input, go);
      msg.appendChild(row);
      chat.append(msg);
      liveBubbles.push(msg);

      go.addEventListener('click', () => {
        const prefix = input.value.trim();
        if (!prefix) return;
        sectionAnswers[String(page.pageIndex)] = prefix;
        input.disabled = true;
        go.disabled = true;
        go.textContent = 'Set ✓';
        pendingPrompts -= 1;
        syncApply();
        if (pendingPrompts === 0) void refine();
      });
    }
    syncApply();
  }

  // ---- Render a full envelope ----
  function renderEnvelope(env: Envelope, introText?: string) {
    // A refine replaces the prior envelope — supersede its bubbles so their stale
    // toggles/prompts can't mutate the freshly-rendered state.
    supersedeLiveBubbles();
    current = env;
    renderResolved(env.resolved, introText);
    if (env.needsSection.length > 0) renderNeedsSection(env.needsSection);
  }

  // ---- Network ----
  function buildForm(extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.append('bookId', bookId);
    for (const file of files) form.append('images', file);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return form;
  }

  /**
   * POST a multipart form via XHR so we can show real upload progress. fetch() gives
   * no upload-progress events; XHR's upload.onprogress does, so the spinner reflects the
   * actual byte upload and flips to "reading" only once the images are fully received.
   * Resolves with the parsed JSON body on 2xx; rejects with a tagged Error otherwise.
   */
  async function postWithProgress(
    url: string,
    form: FormData,
    onUploaded: () => void,
  ): Promise<unknown> {
    const token = await getAccessToken();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      let uploaded = false;
      const markUploaded = () => {
        if (!uploaded) { uploaded = true; onUploaded(); }
      };
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && e.loaded >= e.total) markUploaded();
      });
      xhr.upload.addEventListener('load', markUploaded);
      xhr.upload.addEventListener('error', () => reject(new Error('upload-failed')));
      xhr.addEventListener('error', () => reject(new Error('network-failed')));
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('parse-failed')); }
        } else {
          reject(new Error(`http-${xhr.status}`));
        }
      });
      xhr.send(form);
    });
  }

  async function startExtraction() {
    const status = ThinkingBubble(
      files.length === 1 ? 'Uploading your page…' : `Uploading ${files.length} pages…`,
    );
    chat.append(status);
    try {
      const raw = await postWithProgress('/api/extract', buildForm(), () => {
        setThinkingLabel(status, 'Uploaded ✓ — reading the pages…');
      });
      status.remove();
      renderEnvelope(raw as Envelope);
    } catch (err) {
      status.remove();
      const msg = err instanceof Error && (err.message === 'upload-failed' || err.message === 'network-failed')
        ? 'Upload failed — check your connection and try again.'
        : 'Extraction failed. Go back and try again.';
      renderEnvelope({ resolved: [], needsSection: [] }, msg);
    }
  }

  let refining = false;
  async function refine(note = '') {
    if (refining) return;
    refining = true;
    reply.disable();
    const status = ThinkingBubble('Re-uploading the pages…');
    chat.append(status);
    try {
      const raw = await postWithProgress(
        '/api/extract/refine',
        buildForm({
          currentExtraction: JSON.stringify(current),
          sectionAnswers: JSON.stringify(sectionAnswers),
          note,
        }),
        () => setThinkingLabel(status, 'Uploaded ✓ — placing those problems…'),
      );
      status.remove();
      renderEnvelope(raw as Envelope, 'Here\'s the updated set:');
    } catch {
      status.remove();
      renderEnvelope(current, 'Refinement failed. Add what you have, or try again.');
    } finally {
      refining = false;
      reply.enable();
    }
  }

  /** Swap the visible label of a ThinkingBubble in place (it renders into .thinking-label). */
  function setThinkingLabel(bubble: HTMLElement, label: string) {
    const el = bubble.querySelector('.thinking-label');
    if (el) el.textContent = label;
  }

  const reply = ReplyRow({
    placeholder: 'Refine the problems…',
    onSend(text) { void refine(text); },
  });

  // ---- Commit ----
  applyBtn.addEventListener('click', () => {
    const accepted = cards
      .filter((c) => c.accepted && c.delta.kind !== 'skip')
      .map((c) => ({
        label: c.delta.path || '',
        latex: c.delta.canonicalText,
        ...(c.delta.relevance ? { relevance: c.delta.relevance } : {}),
        ...(c.delta.kind === 'edit' && c.delta.targetId ? { targetId: c.delta.targetId } : {}),
      }));
    sessionStorage.setItem(SCAN_ACCEPTED_KEY, JSON.stringify(accepted));
    window.history.back();
  });

  // ---- Boot ----
  addPhotoBubbles();
  void startExtraction();

  return html`<div class="scan-page">
    ${TopBar({ onBack: () => window.history.back() })}
    ${chat.el}
    <footer class="sp-actions">
      ${reply.el}
      ${applyBtn}
    </footer>
  </div>`;
}
