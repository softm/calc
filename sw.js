/* Bump this value whenever an offline asset changes. */
const CACHE_VERSION = '2026-10-26-office-keypad-v1';
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = 'calc-static:' + SCOPE_URL.pathname + ':';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const HOME_URL = new URL('./index.html', SCOPE_URL).href;

const PRECACHE_ASSETS = [
  './index.html',
  './styles.css',
  './app.js',
  './office.js',
  './engine.js',
  './input.js',
  './notes.js',
  './notes.css',
  './stitch.css',
  './hardware.css',
  './adfit-config.js',
  './adfit.js',
  './adfit.css',
  './privacy.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const PRECACHE_URLS = new Set(
  PRECACHE_ASSETS.map(function (path) {
    return new URL(path, SCOPE_URL).href;
  })
);

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Fetch a complete new version, bypassing older HTTP-cache responses.
      // If any required file fails, installation fails and the active version stays.
      return cache.addAll(Array.from(PRECACHE_URLS, function (url) {
        return new Request(url, {
          cache: 'reload',
          credentials: 'same-origin',
          mode: 'same-origin',
          redirect: 'error'
        });
      }));
    })
  );
  // An updated worker waits until the page explicitly accepts the update.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      // The page must not reload on its first controllerchange event.
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

async function cachedResponse(cacheKey) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(cacheKey);
  } catch {
    // A storage failure must not prevent an otherwise available online response.
    return undefined;
  }
}

function offlineNotice() {
  return new Response(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>calc</title><body><h1>calc를 불러올 수 없어요.</h1><p>인터넷에 연결한 뒤 다시 열어 주세요.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function navigationResponse(request) {
  // Keep HTML and scripts on the same installed version until update acceptance.
  const cached = await cachedResponse(HOME_URL);
  if (cached) return cached;
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    return response.ok ? response : offlineNotice();
  } catch {
    return offlineNotice();
  }
}

async function staticResponse(request, cacheKey) {
  const cached = await cachedResponse(cacheKey);
  if (cached) return cached;
  try {
    // Read-through recovery only: fetch handlers never overwrite a version cache.
    return await fetch(request, { cache: 'no-cache' });
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) return;

  if (request.mode === 'navigate') {
    const isHome = url.pathname === SCOPE_URL.pathname ||
      url.pathname === new URL(HOME_URL).pathname;
    if (isHome) event.respondWith(navigationResponse(request));
    return;
  }

  // Only cache the listed application files. No origin-wide or external cache.
  url.search = '';
  url.hash = '';
  const cacheKey = url.href;
  if (PRECACHE_URLS.has(cacheKey)) {
    event.respondWith(staticResponse(request, cacheKey));
  }
});
