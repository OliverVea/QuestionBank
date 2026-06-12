import { html } from '@/lib/html';
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

  const postBtn = html`<button class="photo-post-btn" type="button">Post this</button>`;

  // Hidden file input for adding more
  const addInput = document.createElement('input');
  addInput.type = 'file';
  addInput.accept = 'image/*';
  addInput.multiple = true;
  addInput.hidden = true;

  addInput.addEventListener('change', () => {
    if (addInput.files) {
      for (const f of addInput.files) files.push(f);
      addInput.value = '';
      renderGrid();
    }
  });

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

    // "Add more" tile
    const addTile = html`<button class="photo-add-more" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14"/><path d="M5 12h14"/>
      </svg>
      Add more
    </button>`;
    addTile.addEventListener('click', () => addInput.click());
    grid.appendChild(addTile);

    (postBtn as HTMLButtonElement).disabled = files.length === 0;
  }

  postBtn.addEventListener('click', () => {
    if (files.length === 0) return;
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
      ${notes}
      ${addInput}
    </div>
    <div class="photo-modal-foot">
      ${postBtn}
    </div>
  </div>`;

  renderGrid();
  return modal;
}
