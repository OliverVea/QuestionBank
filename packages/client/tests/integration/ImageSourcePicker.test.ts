import { describe, test, expect, vi } from 'vitest';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';

function setup() {
  const onFiles = vi.fn();
  const el = ImageSourcePicker({ onFiles });
  const [camera, device] = [...el.querySelectorAll('button')] as HTMLButtonElement[];
  const input = el.querySelector('input[type=file]') as HTMLInputElement;
  return { el, onFiles, camera, device, input };
}

describe('ImageSourcePicker', () => {
  test('renders a Camera and a Device button', () => {
    const { camera, device } = setup();
    expect(camera.textContent).toContain('Camera');
    expect(device.textContent).toContain('Device');
  });

  test('Camera sets capture=environment and single-shot before opening the input', () => {
    const { camera, input } = setup();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    camera.click();
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.multiple).toBe(false);
    expect(click).toHaveBeenCalled();
  });

  test('Device clears capture and allows multi-select before opening the input', () => {
    const { camera, device, input } = setup();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    camera.click(); // set capture first to prove Device clears it
    device.click();
    expect(input.hasAttribute('capture')).toBe(false);
    expect(input.multiple).toBe(true);
    expect(click).toHaveBeenCalledTimes(2);
  });

  test('forwards chosen files to onFiles and resets the input', () => {
    const { onFiles, input } = setup();
    const file = new File(['x'], 'page.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  test('custom labels override the defaults', () => {
    const onFiles = vi.fn();
    const el = ImageSourcePicker({ onFiles, cameraLabel: 'Add (camera)', deviceLabel: 'Add (device)' });
    const [camera, device] = [...el.querySelectorAll('button')] as HTMLButtonElement[];
    expect(camera.textContent).toContain('Add (camera)');
    expect(device.textContent).toContain('Add (device)');
  });
});
