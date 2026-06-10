import { describe, test, expect } from 'vitest';
import { html } from './html';

describe('html', () => {
  test('returns the root element of the template', () => {
    const el = html`<section class="card"></section>`;
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toBe('card');
  });

  test('interpolates a string as text, not markup (injection-safe)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const el = html`<p>${evil}</p>`;
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe(evil);
  });

  test('interpolates a number as text', () => {
    const el = html`<span>${42}</span>`;
    expect(el.textContent).toBe('42');
  });

  test('interpolates an HTMLElement as a real node (identity preserved)', () => {
    const child = html`<b class="inner">hi</b>`;
    const el = html`<div>${child}</div>`;
    expect(el.querySelector('.inner')).toBe(child);
    expect(el.textContent).toBe('hi');
  });

  test('interpolates an array of elements, each as a real node, in order', () => {
    const items = ['a', 'b', 'c'].map((t) => html`<li>${t}</li>`);
    const el = html`<ul>${items}</ul>`;
    const lis = el.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect([...lis].map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
    expect(lis[0]).toBe(items[0]);
  });

  test('supports multiple interpolations of mixed kinds', () => {
    const name = 'world';
    const badge = html`<em>!</em>`;
    const el = html`<h1>hello ${name}${badge}</h1>`;
    expect(el.tagName).toBe('H1');
    expect(el.querySelector('em')).toBe(badge);
    expect(el.textContent).toBe('hello world!');
  });
});
