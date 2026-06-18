import { html } from '@/lib/html';
import './ImageSourcePicker.css';

export interface ImageSourcePickerProps {
  /** Called with the chosen files once the user picks from camera or device. */
  onFiles: (files: File[]) => void;
  /** Label under the camera button. Defaults to 'Camera'. */
  cameraLabel?: string;
  /** Label under the device button. Defaults to 'Device'. */
  deviceLabel?: string;
}

const cameraIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A2 2 0 0 1 11.8 4h.4a2 2 0 0 1 1.6.8L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  <circle cx="12" cy="12.5" r="3.2" />
</svg>`;

const deviceIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <circle cx="8.5" cy="9" r="1.6" />
  <path d="m4 18 5-5 3.5 3.5L16 12l4 4" />
</svg>`;

/**
 * A Camera / Device pair that both feed images back through one `onFiles`
 * callback. Both buttons drive a single hidden file input; the only difference
 * is the `capture` attribute:
 *  - Camera sets `capture="environment"` so mobile opens the rear camera
 *    directly. Cameras shoot one frame at a time, so `multiple` is off there.
 *  - Device clears `capture`, so the OS shows the gallery/file picker, with
 *    `multiple` on for multi-select.
 * On desktop `capture` is ignored, so both buttons open the same file dialog —
 * harmless, and the labels still read sensibly.
 */
export function ImageSourcePicker({
  onFiles,
  cameraLabel = 'Camera',
  deviceLabel = 'Device',
}: ImageSourcePickerProps): HTMLElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;

  input.addEventListener('change', () => {
    const files = input.files;
    if (files?.length) onFiles([...files]);
    input.value = '';
  });

  function open(useCamera: boolean) {
    if (useCamera) {
      input.setAttribute('capture', 'environment');
      input.multiple = false;
    } else {
      input.removeAttribute('capture');
      input.multiple = true;
    }
    input.click();
  }

  const cameraBtn = html`<button class="img-src-btn img-src-camera" type="button">
    <span class="img-src-icon" aria-hidden="true">${htmlSvg(cameraIcon)}</span>
    ${cameraLabel}
  </button>`;
  const deviceBtn = html`<button class="img-src-btn img-src-device" type="button">
    <span class="img-src-icon" aria-hidden="true">${htmlSvg(deviceIcon)}</span>
    ${deviceLabel}
  </button>`;

  cameraBtn.addEventListener('click', () => open(true));
  deviceBtn.addEventListener('click', () => open(false));

  return html`<div class="img-src-picker">
    ${cameraBtn}
    ${deviceBtn}
    ${input}
  </div>`;
}

/** Parse a trusted inline SVG string into a real node for interpolation. */
function htmlSvg(svg: string): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg.trim();
  return tpl.content.firstElementChild as SVGElement;
}
