/**
 * In-memory transfer slot for passing File objects between pages in the SPA.
 * sessionStorage can't hold large images (QuotaExceededError), so we keep
 * them in memory. Safe because hash navigation doesn't reload the page.
 */

export interface PhotoTransfer {
  files: File[];
  notes: string;
  /** The book's learning goal, if set — used for auto-relevance scoring at extraction. */
  learningGoal?: string;
}

let pending: PhotoTransfer | null = null;

export function stashPhotos(transfer: PhotoTransfer): void {
  pending = transfer;
}

export function unstashPhotos(): PhotoTransfer | null {
  const t = pending;
  pending = null;
  return t;
}
