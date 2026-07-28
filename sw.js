const CACHE_NAME = 'shipment-prevent-v5';

// Assets to precache on install
const PRECACHE_ASSETS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'manifest.json',
  'icon.svg',
  // CDN Core assets for absolute offline operation
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching precached assets');
        // Cache assets individually so one failure does not break the entire service worker installation
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url => {
            return cache.add(url).catch(err => {
              console.warn(`Failed to precache asset: ${url}`, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Cache First with Network Fallback)
self.addEventListener('fetch', event => {
  // Only handle HTTP/HTTPS protocols (avoid chrome-extension://, etc.)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache
          return cachedResponse;
        }

        // Fetch from network and cache
        return fetch(event.request)
          .then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && !event.request.url.includes('cdn')) {
              return networkResponse;
            }

            // Clone and save response to cache for offline availability
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          })
          .catch(err => {
            console.warn('Network fetch failed, and no cache matches for:', event.request.url, err);
            // We could return a custom offline page or resource here if needed
          });
      })
  );
});
