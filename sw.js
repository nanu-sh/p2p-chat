// Service Worker for P2P Chat PWA - Version 3
const CACHE_NAME = 'p2p-chat-v3';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/crypto.js',
    './icons/icon-192.svg',
    './icons/icon-512.svg'
];

// Install event - cache assets
self.addEventListener('install', event => {
    console.log('SW v2: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('SW v2: Caching files');
                return cache.addAll(urlsToCache);
            })
            .catch(err => console.log('SW v2: Cache failed:', err))
    );
    // Force immediate activation
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('SW v2: Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('SW v2: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Take control immediately
    self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // For external resources, always use network
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Network first strategy for better updates
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone and cache the response
                if (response && response.status === 200) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache if network fails
                return caches.match(event.request);
            })
    );
});
