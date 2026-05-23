const CACHE_PREFIX = 'calm-focus-cache-';
const CACHE_VERSION = 'v3';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SCOPE = '/calm-focus/';
const APP_SHELL = `${APP_SCOPE}index.html`;
const NETWORK_TIMEOUT_MS = 2500;

const PRECACHE_ASSETS = [
  APP_SCOPE,
  APP_SHELL,
  `${APP_SCOPE}style.css`,
  `${APP_SCOPE}app.js`,
  `${APP_SCOPE}manifest.webmanifest`,
  `${APP_SCOPE}icons/icon-192.svg`,
  `${APP_SCOPE}icons/icon-512.svg`,
  `${APP_SCOPE}icons/icon-maskable.svg`
];

const PRECACHE_URLS = new Set(PRECACHE_ASSETS.map(path => new URL(path, self.location.origin).href));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_SCOPE)) return;

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, APP_SHELL));
    return;
  }

  if (shouldUseCacheFirst(request, url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

function shouldUseCacheFirst(request, url) {
  const cacheFirstDestinations = new Set(['script', 'style', 'manifest', 'image', 'font', 'audio']);
  return PRECACHE_URLS.has(url.href) || cacheFirstDestinations.has(request.destination);
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  await cacheResponse(request, response);
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    await cacheResponse(request, response);
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match(fallbackUrl))
      || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  const fresh = fetch(request)
    .then(async response => {
      await cacheResponse(request, response);
      return response;
    })
    .catch(() => cached);

  return cached || fresh;
}

function fetchWithTimeout(request, timeoutMs) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), timeoutMs))
  ]);
}

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}
