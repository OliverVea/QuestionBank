import { html } from '@/lib/html';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
import './PhotoReviewModal.css';

export interface PhotoReviewResult {
  files: File[];
  notes: string;
}

export interface PhotoReviewModalProps {
  initialFiles: File[];
  onPost: (result: PhotoReviewResult) => void;
  onCancel: () => void;
}

/** Server accepts at most this many page images per scan (see /api/extract). */
const MAX_PHOTOS = 5;

/**
 * Full-screen modal for reviewing selected photos before posting.
 * Shows thumbnails with delete buttons, an "add more" tile, optional notes,
 * and a "Post this" action.
 */
export function PhotoReviewModal({ initialFiles, onPost, onCancel }: PhotoReviewModalProps): HTMLElement {
  const files: File[] = [...initialFiles];
  const grid = document.createElement('div');
  grid.className = 'photo-grid';

  const notes = document.createElement('textarea');
  notes.className = 'photo-notes';
  notes.rows = 2;
  notes.placeholder = 'Optional notes (e.g. "pages 1-2 of proof")';

  // Over-limit warning — shown when more than MAX_PHOTOS pages are selected.
  const warning = document.createElement('div');
  warning.className = 'photo-warning';
  warning.hidden = true;
  warning.textContent = `You can scan up to ${MAX_PHOTOS} pages at a time — remove some to continue.`;

  const postBtn = html`<button class="photo-post-btn" type="button">Post this</button>`;

  // Camera / Device picker for adding more pages. Disabled once the page limit
  // is reached (toggled in renderGrid via .photo-add-disabled on the wrapper).
  const addPicker = ImageSourcePicker({
    cameraLabel: 'Add (camera)',
    deviceLabel: 'Add (device)',
    onFiles(picked) {
      for (const f of picked) files.push(f);
      renderGrid();
    },
  });
  const addRow = html`<div class="photo-add-row">${addPicker}</div>`;

  function renderGrid() {
    grid.innerHTML = '';
    files.forEach((file, i) => {
      const item = document.createElement('div');
      item.className = 'photo-grid-item';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = `Photo ${i + 1}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-grid-del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        URL.revokeObjectURL(img.src);
        files.splice(i, 1);
        renderGrid();
      });
      item.append(img, del);
      grid.appendChild(item);
    });

    // Add-more picker — disabled once the page limit is reached.
    const atLimit = files.length >= MAX_PHOTOS;
    addRow.classList.toggle('photo-add-disabled', atLimit);
    addRow.querySelectorAll('button').forEach((b) => { b.disabled = atLimit; });

    const overLimit = files.length > MAX_PHOTOS;
    warning.hidden = !overLimit;
    (postBtn as HTMLButtonElement).disabled = files.length === 0 || overLimit;
  }

  postBtn.addEventListener('click', () => {
    if (files.length === 0 || files.length > MAX_PHOTOS) return;
    onPost({ files: [...files], notes: notes.value.trim() });
    modal.remove();
  });

  const closeBtn = html`<button class="photo-modal-close" type="button" aria-label="Cancel">✕</button>`;
  closeBtn.addEventListener('click', () => { onCancel(); modal.remove(); });

  const modal = html`<div class="photo-modal">
    <div class="photo-modal-head">
      <span class="photo-modal-title">Review photos</span>
      ${closeBtn}
    </div>
    <div class="photo-modal-body">
      ${grid}
      ${addRow}
      ${warning}
      ${notes}
    </div>
    <div class="photo-modal-foot">
      ${postBtn}
    </div>
  </div>`;

  renderGrid();
  return modal;
}
