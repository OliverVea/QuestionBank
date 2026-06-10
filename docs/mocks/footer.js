// Shared chrome for the mocks. Include on every mock page with:
// <script src="footer.js" defer></script>.
(() => {
  // ---- Load-in animation style switch ----
  // Pick the animation style with ?anim=fade|cascade|pop (default cascade) so
  // styles can be compared without editing CSS. Sets a class on <body> that the
  // .anim-* rules in mocks.css key off.
  const anim = new URLSearchParams(location.search).get('anim') || 'cascade';
  const known = { fade: 'anim-fade', cascade: 'anim-cascade', pop: 'anim-pop' };
  document.body.classList.add(known[anim] || known.cascade);

  // ---- PWA service worker ----
  // Registering a service worker (with a fetch handler, see sw.js) is what makes
  // the app installable, so launching it from the home screen honors the
  // manifest's fullscreen display (no address bar). Scoped to the mocks dir.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* ignore in plain tab */ });
    });
  }
})();
