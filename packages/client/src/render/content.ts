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

/** Split source into ordered text/math segments. Pure. */
export function splitMath(source: string): Segment[] {
  return [{ kind: 'text', value: source }]; // stub — replaced in Task 2
}

/** Render the small known markdown subset of a text segment to an HTML string. Pure. */
export function renderMarkup(text: string): string {
  return text; // stub — replaced in Task 3
}
