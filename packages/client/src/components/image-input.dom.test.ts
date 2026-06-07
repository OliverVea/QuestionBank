// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createImageInput } from './image-input.js';

describe('createImageInput', () => {
  it('renders Take-photo and Choose-image controls', () => {
    const { element } = createImageInput({ onFiles: () => {} });
    expect(element.querySelector('.image-input-camera')).not.toBeNull();
    expect(element.querySelector('.image-input-choose')).not.toBeNull();
  });

  it('emits a single file by default', () => {
    const onFiles = vi.fn();
    const { element } = createImageInput({ onFiles });
    const input = element.querySelector<HTMLInputElement>('.image-input-file')!;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('multiple:true sets the multiple attribute and emits all files', () => {
    const onFiles = vi.fn();
    const { element } = createImageInput({ multiple: true, onFiles });
    const input = element.querySelector<HTMLInputElement>('.image-input-file')!;
    expect(input.multiple).toEqual(true);
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith(files);
  });
});
