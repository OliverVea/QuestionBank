// Shared "back to gallery" footer for the mocks. Include on every mock page
// EXCEPT index.html with: <script src="footer.js" defer></script>
// Styled by .mock-footer in mocks.css. Injected via JS because the mocks are
// opened as file:// pages, where HTML includes/fetches are blocked by CORS.
(() => {
  // Don't show the back-link on the gallery itself.
  const file = location.pathname.split('/').pop() || '';
  if (file === '' || file === 'index.html') return;

  const footer = document.createElement('nav');
  footer.className = 'mock-footer';
  footer.innerHTML =
    '<a href="index.html"><span aria-hidden="true">←</span> Back to gallery</a>';
  document.body.appendChild(footer);
})();
