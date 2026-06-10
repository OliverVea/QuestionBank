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
})();
