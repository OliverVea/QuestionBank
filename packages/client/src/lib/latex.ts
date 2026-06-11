/**
 * LaTeX segmenting + KaTeX rendering — ported from docs/mocks/problems-list.js.
 * Pure (string → segments) and (host, source → DOM), reused everywhere math appears.
 */

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

/** Split a LaTeX-mixed string into text and math segments. */
export function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  const pushText = () => { if (text) { segments.push({ kind: 'text', value: text }); text = ''; } };
  let i = 0;
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$') { text += '$'; i += 2; continue; }
    if (source[i] === '$') {
      const display = source[i + 1] === '$';
      const open = display ? i + 2 : i + 1;
      const close = findClosingDollar(source, open, display);
      if (close === -1) { text += source[i]; i++; continue; }
      pushText();
      segments.push({ kind: 'math', value: source.slice(open, close), display });
      i = display ? close + 2 : close + 1;
      continue;
    }
    text += source[i]; i++;
  }
  pushText();
  return segments;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/** Render LaTeX-mixed source into a host element using KaTeX. */
export function renderLatex(host: HTMLElement, source: string): void {
  host.innerHTML = '';
  if (!source) {
    const ph = document.createElement('span');
    ph.className = 'pr-empty';
    ph.textContent = 'Tap to write the problem (LaTeX)\u2026';
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
    if ((window as any).katex) {
      (window as any).katex.render(seg.value, mathHost, { displayMode: seg.display, throwOnError: false });
    } else {
      mathHost.textContent = seg.display ? seg.value : '$' + seg.value + '$';
    }
    host.appendChild(mathHost);
  }
}
