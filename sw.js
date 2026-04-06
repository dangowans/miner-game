/* ─── Service Worker – Mini Miner ─────────────────────────────────────────
 *
 * Caches all game assets so the game works offline, and clears stale caches
 * whenever CACHE_VERSION is bumped (i.e. when a new version is deployed).
 * The page registers this worker and calls registration.update() periodically
 * so the browser checks for a fresh copy of this file even while the game is
 * running.  When a new worker takes control the page reloads automatically so
 * players always get the latest scripts.
 * ─────────────────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'v1';
const CACHE_NAME    = `miner-game-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './site.webmanifest',
  './js/constants.js',
  './js/audio.js',
  './js/world.js',
  './js/player.js',
  './js/renderer.js',
  './js/ui.js',
  './js/input.js',
  './js/storage.js',
  './js/game.js',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon-48x48.png',
  './apple-touch-icon.png',
  './android-chrome-192x192.png',
  './android-chrome-512x512.png',
];

/* ── Install: pre-cache all assets ───────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: delete caches from old versions ───────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: stale-while-revalidate ───────────────────────────────────── */
self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
              return response;
            }
            // Network returned an error; serve a stale cached copy if available.
            return cached || response;
          })
          .catch(err => {
            // Background update failed; if a cached copy was already served,
            // suppress the error.  Otherwise re-throw so the browser shows
            // its normal offline error.
            if (!cached) throw err;
          });
        // Serve the cached response immediately; update cache in background.
        return cached || networkFetch;
      })
    )
  );
});
