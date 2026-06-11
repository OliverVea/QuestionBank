/**
 * LaTeX segmenting + KaTeX rendering utility.
 *
 * Ported from docs/mocks/problems-list.js — the logic is identical across
 * learn.html, grade.html, and problems-list.js in the mocks. Pure functions:
 * `splitMath` parses a LaTeX-mixed string into text/math segments, and
 * `renderLatex` renders those segments into a host element using KaTeX.
 */

import katex from 'katex';

export interface MathSegment {
  kind: 'math';
  value: string;
  display: boolean;
}

export interface TextSegment {
  kind: 'text';
  value: string;
}

export type Segment = MathSegment | TextSegment;

/** Find the closing `$` (or `$$` if display) starting from `from`. */
function findClosingDollar(source: string, from: number, display: boolean): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] === '\\') { j++; continue; }
    if (source[j] === '$') {
      if (display) { if (source[j + 1] === '$') return j; continue; }
      return j;
    }
  }
  return -1;
}

/** Split a string containing mixed text and `$...$` / `$$...$$` LaTeX. */
export function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  const pushText = () => { if (text.length > 0) { segments.push({ kind: 'text', value: text }); text = ''; } };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && source[i + 1] === '$') { text += '$'; i += 2; continue; }
    if (ch === '$') {
      const display = source[i + 1] === '$';
      const open = display ? i + 2 : i + 1;
      const close = findClosingDollar(source, open, display);
      if (close === -1) { text += ch; i += 1; continue; }
      pushText();
      segments.push({ kind: 'math', value: source.slice(open, close), display });
      i = display ? close + 2 : close + 1;
      continue;
    }
    text += ch; i += 1;
  }
  pushText();
  return segments;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/**
 * Render a LaTeX-mixed source string into a host element. Wipes the host first.
 * If source is empty, renders a placeholder span.
 */
export function renderLatex(host: HTMLElement, source: string, placeholder?: string): void {
  host.innerHTML = '';
  if (!source) {
    const ph = document.createElement('span');
    ph.className = 'latex-empty';
    ph.textContent = placeholder ?? 'Tap to write (LaTeX)…';
    host.appendChild(ph);
    return;
  }
  for (const seg of splitMath(source)) {
    if (seg.kind === 'text') {
      const span = document.createElement('span');
      span.innerHTML = escapeHtml(seg.value).replace(/\n/g, '<br>');
      host.appendChild(span);
      continue;
    }
    const mathHost = seg.display ? document.createElement('div') : document.createElement('span');
    katex.render(seg.value, mathHost, { displayMode: seg.display, throwOnError: false });
    host.appendChild(mathHost);
  }
}
