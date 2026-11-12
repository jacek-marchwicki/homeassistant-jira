// Jira Dashboard Service Worker (PWA)
const CACHE_NAME = 'jira-dashboard-v3';

// Core assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './favicon.svg',
  './manifest.webmanifest',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-192x192.png',
  './pwa-maskable-512x512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching warning (some non-critical assets skipped):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Bypass all non-GET requests, WebSockets, and Jira API calls
  if (
    request.method !== 'GET' ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/ws') ||
    url.protocol.startsWith('ws')
  ) {
    return;
  }

  // 2. Navigation & HTML document requests: Stale-While-Revalidate
  // Serves cached HTML shell instantly (< 10ms) without waiting for network calls,
  // and revalidates in the background so updates are captured for subsequent visits.
  const isHtmlNavigation =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isHtmlNavigation) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        // Fallback to pre-cached root or index.html if route has no direct entry
        const matchPromise = cachedResponse
          ? Promise.resolve(cachedResponse)
          : caches.match('./').then((fallback) => fallback || caches.match('/index.html'));

        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline or network error: background fetch fails silently
          });

        return matchPromise.then((cached) => {
          if (cached) {
            // Instant startup from cache; background fetch updates cache
            return cached;
          }
          // Cold start with empty cache: wait for network response
          return networkFetch;
        });
      })
    );
    return;
  }

  // 3. Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Ignore network errors for background fetch
        });

      return cachedResponse || fetchPromise;
    })
  );
});
