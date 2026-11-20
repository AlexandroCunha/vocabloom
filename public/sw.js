/*
 * Vocabloom service worker.
 * GENERATED into public/sw.js by scripts/build.js (which fills in the version and the file list):
 * edit src/sw.template.js, then run: npm run build
 *
 * It lets the app keep working without a connection:
 *   1. the app itself (one page, its icons and manifest) is kept in a cache named after this version;
 *   2. every worksheet a student opens through a short link is kept, so it opens again offline;
 *   3. everything else is left alone. Uploads and conversions (anything that is not a plain GET) never
 *      go through this file, and student answers never leave the page, so there is nothing of theirs to keep.
 */
const VERSION = '3b0aee94fb7d';
const APP_CACHE = 'vocabloom-app-' + VERSION;
const WORKSHEET_CACHE = 'vocabloom-worksheets';   // kept when a new version of the app is installed
const APP_FILES = ["/","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-512.png","/icons/apple-touch-icon.png","/privacy.html"];
const MAX_WORKSHEETS = 40;
const SHORT_ID = /^[A-Za-z0-9_-]{12}$/;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.indexOf('vocabloom-app-') === 0 && name !== APP_CACHE)
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

/** A worksheet behind a short link never changes, so a copy that was kept is always right. */
function worksheetResponse(event) {
  return caches.open(WORKSHEET_CACHE).then(cache => cache.match(event.request).then(kept => {
    if (kept) return kept;
    return fetch(event.request).then(response => {
      if (response.ok) event.waitUntil(cache.put(event.request, response.clone()).then(() => trimWorksheets(cache)));
      return response;
    });
  }));
}

/** Keeps the newest MAX_WORKSHEETS worksheets (the cache lists its entries oldest first). */
function trimWorksheets(cache) {
  return cache.keys().then(requests => Promise.all(requests.slice(0, Math.max(0, requests.length - MAX_WORKSHEETS)).map(request => cache.delete(request))));
}

function appFile(request, path) {
  return caches.open(APP_CACHE).then(cache => cache.match(path)).then(kept => kept || fetch(request));
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/share') {
    if (SHORT_ID.test(url.searchParams.get('id') || '')) event.respondWith(worksheetResponse(event));
    return;
  }
  if (url.pathname.indexOf('/api/') === 0) return;

  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(appFile(request, '/'));
    return;
  }
  if (APP_FILES.indexOf(url.pathname) !== -1) event.respondWith(appFile(request, url.pathname));
});
