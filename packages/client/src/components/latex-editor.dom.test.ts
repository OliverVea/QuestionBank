// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createLatexEditor } from './latex-editor.js';

// KaTeX does real rendering in jsdom — we just verify DOM structure, not math output.

describe('createLatexEditor — editable:true (textarea + live preview)', () => {
  it('renders a textarea with the initial value', () => {
    const { element } = createLatexEditor({ value: 'hello', editable: true });
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea');
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('hello');
  });

  it('renders a preview element below the textarea', () => {
    const { element } = createLatexEditor({ value: 'x', editable: true });
    expect(element.querySelector('.latex-editor-preview')).not.toBeNull();
  });

  it('calls onChange when the textarea value changes', () => {
    const onChange = vi.fn();
    const { element } = createLatexEditor({ value: '', editable: true, onChange });
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    ta.value = 'new text';
    ta.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith('new text');
  });

  it('getValue returns the current textarea value', () => {
    const { element, getValue } = createLatexEditor({ value: 'init', editable: true });
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    ta.value = 'updated';
    ta.dispatchEvent(new Event('input'));
    expect(getValue()).toBe('updated');
  });

  it('setValue updates the textarea and preview', () => {
    const { element, setValue, getValue } = createLatexEditor({ value: '', editable: true });
    setValue('replaced');
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    expect(ta.value).toBe('replaced');
    expect(getValue()).toBe('replaced');
  });
});

describe('createLatexEditor — editable:false (render-only, tap to edit)', () => {
  it('renders a rendered view and no textarea initially', () => {
    const { element } = createLatexEditor({ value: 'hello', editable: false });
    expect(element.querySelector('.latex-editor-rendered')).not.toBeNull();
    expect(element.querySelector('.latex-editor-textarea')).toBeNull();
  });

  it('clicking the rendered view switches to a textarea', () => {
    const { element } = createLatexEditor({ value: 'hello', editable: false });
    const rendered = element.querySelector<HTMLElement>('.latex-editor-rendered')!;
    rendered.click();
    expect(element.querySelector('.latex-editor-textarea')).not.toBeNull();
    expect(element.querySelector('.latex-editor-rendered')).toBeNull();
  });

  it('textarea is populated with the current value on tap-to-edit', () => {
    const { element } = createLatexEditor({ value: 'my answer', editable: false });
    element.querySelector<HTMLElement>('.latex-editor-rendered')!.click();
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    expect(ta.value).toBe('my answer');
  });

  it('calls onChange when editing after tap-to-edit', () => {
    const onChange = vi.fn();
    const { element } = createLatexEditor({ value: '', editable: false, onChange });
    element.querySelector<HTMLElement>('.latex-editor-rendered')!.click();
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    ta.value = 'typed';
    ta.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith('typed');
  });

  it('calls onCommit when the commit button is clicked', () => {
    const onCommit = vi.fn();
    const { element } = createLatexEditor({ value: 'ans', editable: false, onCommit });
    element.querySelector<HTMLElement>('.latex-editor-rendered')!.click();
    const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea')!;
    ta.value = 'edited';
    ta.dispatchEvent(new Event('input'));
    element.querySelector<HTMLButtonElement>('.latex-editor-commit')!.click();
    expect(onCommit).toHaveBeenCalledWith('edited');
  });

  it('getValue returns the current value in render mode', () => {
    const { getValue } = createLatexEditor({ value: 'abc', editable: false });
    expect(getValue()).toBe('abc');
  });

  it('setValue updates the rendered view without switching to edit mode', () => {
    const { element, setValue, getValue } = createLatexEditor({ value: 'old', editable: false });
    setValue('new');
    expect(getValue()).toBe('new');
    expect(element.querySelector('.latex-editor-rendered')).not.toBeNull();
    expect(element.querySelector('.latex-editor-textarea')).toBeNull();
  });
});
