// Minimal service worker for the mocks PWA.
//
// Its main job is to EXIST with a fetch handler: that's what makes the browser
// treat the site as installable (so launching from the home screen honors the
// manifest's fullscreen display, with no address bar). It's a pass-through to
// the network — these are mocks, so we don't pre-cache or do offline tricks.
// (Open Library covers / KaTeX are handled by the pages themselves.)

self.addEventListener('install', (event) => {
  self.skipWaiting();   // activate immediately on first load
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network pass-through. A fetch handler is required for installability even
  // when it does nothing clever.
  event.respondWith(fetch(event.request));
});
