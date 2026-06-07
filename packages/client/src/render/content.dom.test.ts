// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderContent } from './content.js';

describe('renderContent', () => {
  it('renders a known math expression into a .katex element', () => {
    const host = document.createElement('div');
    renderContent(host, 'value is $x+1$ here');
    expect(host.querySelector('.katex')).not.toBeNull();
    expect(host.textContent).toContain('value is');
    expect(host.textContent).toContain('here');
  });

  it('renders bold prose as a <strong> element', () => {
    const host = document.createElement('div');
    renderContent(host, 'this is **important**');
    expect(host.querySelector('strong')?.textContent).toBe('important');
  });

  it('does not throw on malformed math and renders an error token', () => {
    const host = document.createElement('div');
    expect(() => renderContent(host, 'broken $\\frac{1$ end')).not.toThrow();
    expect(host.querySelector('.katex-error')).not.toBeNull();
  });

  it('clears any prior content of the host before rendering', () => {
    const host = document.createElement('div');
    host.textContent = 'STALE';
    renderContent(host, 'fresh');
    expect(host.textContent).not.toContain('STALE');
    expect(host.textContent).toContain('fresh');
  });

  it('wraps display math so it can scroll horizontally', () => {
    const host = document.createElement('div');
    renderContent(host, '$$x+1$$');
    expect(host.querySelector('.qbody-display')).not.toBeNull();
  });
});
