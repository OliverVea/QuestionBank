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
  // Previously we registered sw.js (a network pass-through) purely for PWA
  // installability. It caused the home screen to render blank in normal tabs —
  // an already-installed worker kept intercepting navigations across reloads
  // and server restarts, so the page came up empty. Mocks don't need offline
  // support, so we remove the worker entirely and actively unregister any copy
  // a previous visit left controlling this origin, plus drop its caches.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => { /* ignore in plain tab */ });
    if (window.caches && caches.keys) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }
})();
