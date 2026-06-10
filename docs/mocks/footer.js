// Shared chrome for the mocks. Include on every mock page EXCEPT index.html
// with: <script src="footer.js" defer></script>. Styled by mocks.css. Injected
// via JS so the markup stays in one place across the served pages.
(() => {
  // ---- Load-in animation style switch ----
  // Pick the animation style with ?anim=fade|cascade|pop (default cascade) so
  // styles can be compared without editing CSS. Sets a class on <body> that the
  // .anim-* rules in mocks.css key off. Done first so it applies before paint.
  const anim = new URLSearchParams(location.search).get('anim') || 'cascade';
  const known = { fade: 'anim-fade', cascade: 'anim-cascade', pop: 'anim-pop' };
  document.body.classList.add(known[anim] || known.cascade);

  // ---- Back-to-gallery pill ----
  // Skipped on the gallery itself, on pages with <body data-no-footer>, or via
  // ?footer=0 / ?nofooter in the URL (toggle per-visit without editing HTML).
  const file = location.pathname.split('/').pop() || '';
  if (file === '' || file === 'index.html') return;
  if (document.body.hasAttribute('data-no-footer')) return;
  const params = new URLSearchParams(location.search);
  if (params.get('footer') === '0' || params.has('nofooter')) return;

  const footer = document.createElement('nav');
  footer.className = 'mock-footer';
  footer.innerHTML =
    '<a href="index.html"><span aria-hidden="true">←</span> Back to gallery</a>';
  document.body.appendChild(footer);
})();
