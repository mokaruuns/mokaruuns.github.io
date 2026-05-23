const CACHE_PREFIX = 'breath-cache-';
const CACHE_VERSION = 'v2-calm-focus';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_SCOPE = '/calm-focus/';

const ASSETS = [
  APP_SCOPE,
  `${APP_SCOPE}index.html`,
  `${APP_SCOPE}style.css`,
  `${APP_SCOPE}app.js`,
  `${APP_SCOPE}manifest.webmanifest`,
  `${APP_SCOPE}service-worker.js`,
  `${APP_SCOPE}icons/icon-192.svg`,
  `${APP_SCOPE}icons/icon-512.svg`,
  `${APP_SCOPE}icons/icon-maskable.svg`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }
  if (!url.pathname.startsWith(APP_SCOPE)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
          return response;
        })
        .catch(() => caches.match(`${APP_SCOPE}index.html`));
    })
  );
});
