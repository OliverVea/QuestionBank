import { describe, expect, it } from 'vitest';
import { splitMath, renderMarkup } from './content.js';

describe('splitMath', () => {
  it('returns a single text segment when there is no math', () => {
    expect(splitMath('plain prose')).toEqual([{ kind: 'text', value: 'plain prose' }]);
  });

  it('extracts one inline $…$ segment between text', () => {
    expect(splitMath('a $x+1$ b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'math', value: 'x+1', display: false },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('extracts one display $$…$$ segment', () => {
    expect(splitMath('a $$x+1$$ b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'math', value: 'x+1', display: true },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('keeps the right text/math order for a mixed real example', () => {
    expect(splitMath('Prove that $-(-v) = v$ for every $v \\in V$.')).toEqual([
      { kind: 'text', value: 'Prove that ' },
      { kind: 'math', value: '-(-v) = v', display: false },
      { kind: 'text', value: ' for every ' },
      { kind: 'math', value: 'v \\in V', display: false },
      { kind: 'text', value: '.' },
    ]);
  });

  it('keeps a $$\\begin{cases}…\\end{cases}$$ block as one display segment', () => {
    const src = '$$\\begin{cases} a \\\\ b \\end{cases}$$';
    expect(splitMath(src)).toEqual([
      { kind: 'math', value: '\\begin{cases} a \\\\ b \\end{cases}', display: true },
    ]);
  });

  it('treats an unbalanced trailing $ as literal text (no swallowed tail)', () => {
    expect(splitMath('cost is $5 today')).toEqual([
      { kind: 'text', value: 'cost is $5 today' },
    ]);
  });

  it('treats an unbalanced trailing $$ as literal text', () => {
    expect(splitMath('open $$x+1')).toEqual([{ kind: 'text', value: 'open $$x+1' }]);
  });

  it('treats an escaped \\$ as a literal dollar, not a delimiter', () => {
    expect(splitMath('price \\$5 and \\$6')).toEqual([
      { kind: 'text', value: 'price $5 and $6' },
    ]);
  });

  it('does not mis-split display math as two inline spans', () => {
    const out = splitMath('$$a$$');
    expect(out).toEqual([{ kind: 'math', value: 'a', display: true }]);
  });
});

describe('renderMarkup', () => {
  it('renders **bold** as <strong>', () => {
    expect(renderMarkup('a **b** c')).toBe('a <strong>b</strong> c');
  });

  it('renders *italic* as <em>', () => {
    expect(renderMarkup('a *b* c')).toBe('a <em>b</em> c');
  });

  it('renders a bold run that contains italic', () => {
    expect(renderMarkup('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
  });

  it('HTML-escapes content so questions cannot inject markup', () => {
    expect(renderMarkup('1 < 2 & <script>x</script>')).toBe(
      '1 &lt; 2 &amp; &lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('leaves non-markdown punctuation like (a), _ and ^ literal', () => {
    expect(renderMarkup('(a) x_1 ^2')).toBe('(a) x_1 ^2');
  });

  it('turns a blank line into a paragraph break', () => {
    expect(renderMarkup('one\n\ntwo')).toBe('one</p><p>two');
  });

  it('turns a single newline into a line break', () => {
    expect(renderMarkup('one\ntwo')).toBe('one<br>two');
  });
});
