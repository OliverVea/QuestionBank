/**
 * The single authoring primitive for @qb/client.
 *
 * Parses the static markup **once** and returns the root `HTMLElement`
 * (a real live node, not a string). It is sugar over the same direct-DOM
 * construction every framework compiles down to.
 *
 * Interpolation rules:
 *  - an `HTMLElement` (or an array of them) is inserted as real node(s),
 *    which is what makes components compose: html`<div>${Card(props)}</div>`;
 *  - a `string` or `number` is inserted as **text**, so values are
 *    HTML-injection-safe by default.
 *
 * The one acknowledged cost: markup inside the backticks is not type-checked
 * (it is a string until parsed) — acceptable for a hand-built component library.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): HTMLElement {
  // Stitch the static chunks together, marking each interpolation slot with a
  // unique comment node. Comments are inert in HTML parsing and can sit between
  // any elements, so they are a safe, position-stable placeholder.
  let markup = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    markup += `<!--qb:${i}-->` + (strings[i + 1] ?? '');
  }

  const template = document.createElement('template');
  template.innerHTML = markup.trim();

  const content = template.content;

  // Collect the placeholder comment nodes up front (the walk is read-only;
  // we mutate the tree afterwards).
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_COMMENT);
  const markers: Comment[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = (current as Comment).data;
    if (/^qb:\d+$/.test(text)) markers.push(current as Comment);
    current = walker.nextNode();
  }

  // Replace each placeholder with its value's real node(s) or text.
  for (const marker of markers) {
    const index = Number(marker.data.slice('qb:'.length));
    const value = values[index];
    const nodes = toNodes(value);
    marker.replaceWith(...nodes);
  }

  const root = content.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error('html`` template must have a single root HTMLElement');
  }
  return root;
}

/** Normalize an interpolated value into the DOM nodes it should become. */
function toNodes(value: unknown): Node[] {
  if (value instanceof Node) return [value];
  if (Array.isArray(value)) return value.flatMap(toNodes);
  // null / undefined / false render nothing, so `${cond && el}` is safe — the
  // same convention every JSX runtime uses for conditional children.
  if (value == null || value === false) return [];
  // string | number (and other values) → text (injection-safe).
  return [document.createTextNode(String(value))];
}
