export interface ImageInputOptions {
  /** Allow selecting more than one file (answer photos). Default: false (single). */
  multiple?: boolean;
  /** Called with the chosen file(s) on each selection. */
  onFiles: (files: File[]) => void;
}

export interface ImageInput {
  /** The control's root element — append it where you want the buttons. */
  element: HTMLElement;
  /** Clear the underlying inputs so the same file can be re-selected. */
  reset(): void;
  /** Enable/disable both buttons (e.g. while uploading). */
  setDisabled(disabled: boolean): void;
}

/**
 * Take-photo + Choose-image controls over a hidden file input. "Take photo" sets
 * capture="environment" (rear camera on mobile; a normal dialog on desktop). The
 * caller owns upload + progress UX via `onFiles`. Single file by default; pass
 * `multiple: true` for the answer-photo case.
 */
export function createImageInput(opts: ImageInputOptions): ImageInput {
  const element = document.createElement('span');
  element.className = 'image-input';

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.className = 'image-input-file';
  file.style.display = 'none';
  if (opts.multiple) file.multiple = true;

  // Separate camera-capture input so "Take photo" requests the rear camera without
  // affecting the plain "Choose image" picker.
  const camera = document.createElement('input');
  camera.type = 'file';
  camera.accept = 'image/*';
  camera.capture = 'environment';
  camera.className = 'image-input-camera-file';
  camera.style.display = 'none';
  if (opts.multiple) camera.multiple = true;

  const takeBtn = document.createElement('button');
  takeBtn.type = 'button';
  takeBtn.className = 'btn image-input-camera';
  takeBtn.textContent = 'Take photo';

  const chooseBtn = document.createElement('button');
  chooseBtn.type = 'button';
  chooseBtn.className = 'btn image-input-choose';
  chooseBtn.textContent = 'Choose image';

  takeBtn.addEventListener('click', () => camera.click());
  chooseBtn.addEventListener('click', () => file.click());

  function emit(input: HTMLInputElement): void {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > 0) opts.onFiles(files);
    input.value = ''; // allow re-selecting the same file
  }
  file.addEventListener('change', () => emit(file));
  camera.addEventListener('change', () => emit(camera));

  element.append(takeBtn, chooseBtn, file, camera);

  return {
    element,
    reset(): void {
      file.value = '';
      camera.value = '';
    },
    setDisabled(disabled: boolean): void {
      takeBtn.disabled = disabled;
      chooseBtn.disabled = disabled;
    },
  };
}
