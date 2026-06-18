import { describe, test, expect, vi } from 'vitest';
import { SessionPause } from '@/components/SessionPause';

describe('SessionPause', () => {
  test('learn variant: title, count, label, and accent mode', () => {
    const el = SessionPause({
      mode: 'learn',
      count: 5,
      title: 'Chapter 1 done!',
      onContinue: () => {},
      onBreak: () => {},
    });
    expect(el.dataset.mode).toBe('learn');
    expect(el.querySelector('.pause-title')!.textContent).toBe('Chapter 1 done!');
    expect(el.querySelector('.pc-num')!.textContent).toBe('5');
    expect(el.querySelector('.pc-lbl')!.textContent).toBe('problems this session');
  });

  test('revisit variant uses the reviews label and revisit mode', () => {
    const el = SessionPause({
      mode: 'revisit',
      count: 10,
      title: 'Nice — 10 reviews done!',
      onContinue: () => {},
      onBreak: () => {},
    });
    expect(el.dataset.mode).toBe('revisit');
    expect(el.querySelector('.pc-lbl')!.textContent).toBe('reviews this session');
  });

  test('buttons fire their callbacks', () => {
    const onContinue = vi.fn();
    const onBreak = vi.fn();
    const el = SessionPause({ mode: 'learn', count: 1, title: 'x', onContinue, onBreak });
    el.querySelector<HTMLButtonElement>('.pb-continue')!.click();
    el.querySelector<HTMLButtonElement>('.pb-break')!.click();
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onBreak).toHaveBeenCalledOnce();
  });
});
