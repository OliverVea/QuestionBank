import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Render a question's canonicalText into `host`: prose with **bold** / *italic* and
 * paragraph breaks, with $…$ inline math and $$…$$ display math rendered by KaTeX.
 * Malformed math renders as KaTeX's visible error token (throwOnError: false) so a
 * bad expression never blanks the row — the raw source is recoverable via edit mode.
 *
 * Three units, two of them pure so the real logic is testable without a DOM:
 *   - splitMath(source): pure, source string -> ordered text/math segments
 *   - renderMarkup(text): pure, a text segment -> HTML string (small markdown subset)
 *   - renderContent(host, source): DOM assembly, math via KaTeX
 */

export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean };

export function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let text = ''; // accumulates literal text (with \$ already unescaped) until the next math run

  const pushText = (): void => {
    if (text.length > 0) segments.push({ kind: 'text', value: text });
    text = '';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // Escaped dollar: emit a literal '$' and skip both characters.
    if (ch === '\\' && source[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }

    if (ch === '$') {
      const display = source[i + 1] === '$';
      const open = display ? i + 2 : i + 1;
      const close = findClosingDollar(source, open, display);
      if (close === -1) {
        // Unbalanced: treat the rest as literal text. Consume one char and continue
        // so the '$' itself is preserved in the output.
        text += ch;
        i += 1;
        continue;
      }
      pushText();
      segments.push({ kind: 'math', value: source.slice(open, close), display });
      i = display ? close + 2 : close + 1;
      continue;
    }

    text += ch;
    i += 1;
  }

  pushText();
  return segments;
}

/**
 * Find the index of the closing delimiter starting the search at `from`.
 * For display math the closer is `$$`; for inline it is a single `$`.
 * An escaped `\$` inside is not a closer. Returns -1 if none found.
 */
function findClosingDollar(source: string, from: number, display: boolean): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] === '\\') {
      j++; // skip the escaped character
      continue;
    }
    if (source[j] === '$') {
      if (display) {
        if (source[j + 1] === '$') return j;
        // a lone '$' inside a display run is not a closer; keep scanning
        continue;
      }
      return j;
    }
  }
  return -1;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Render the small known markdown subset of a text segment to an HTML string. Pure. */
export function renderMarkup(text: string): string {
  // 1. Escape first so question content can never inject HTML.
  let html = escapeHtml(text);
  // 2. Bold before italic so the inner * of **…** is consumed by bold, not italic.
  html = html.replace(/\*\*([^]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  // 3. Paragraph breaks (blank line) before line breaks (single newline).
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Render `source` into `host`. Owns the host's contents: clears it, then appends
 * rendered prose (with the small markdown subset) and KaTeX-rendered math. Display
 * math is wrapped in a `.qbody-display` element that scrolls horizontally on narrow
 * screens. Malformed math renders as KaTeX's visible error token (throwOnError:false)
 * and never throws.
 */
export function renderContent(host: HTMLElement, source: string): void {
  host.innerHTML = '';
  for (const segment of splitMath(source)) {
    if (segment.kind === 'text') {
      const span = document.createElement('span');
      span.innerHTML = renderMarkup(segment.value);
      host.appendChild(span);
      continue;
    }
    const mathHost = segment.display ? document.createElement('div') : document.createElement('span');
    if (segment.display) mathHost.className = 'qbody-display';
    katex.render(segment.value, mathHost, {
      displayMode: segment.display,
      throwOnError: false,
    });
    host.appendChild(mathHost);
  }
}
