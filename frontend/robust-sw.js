// Robust Service Worker - Production Safe
// Automatically detects correct paths and handles errors gracefully

const CACHE_NAME = `ppe-cache-${self.location.hostname}-${Date.now()}`;

// Auto-detect correct manifest path
const POSSIBLE_MANIFEST_PATHS = [
  '/frontend/manifest.json',
  '/manifest.json',
  './manifest.json'
];

// Safe asset caching with fallback
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/worker.html'
];

// Safely test if a resource exists
async function resourceExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// Find the correct manifest path
async function findManifestPath() {
  for (const path of POSSIBLE_MANIFEST_PATHS) {
    if (await resourceExists(path)) {
      console.log('SW: Found manifest at:', path);
      return path;
    }
  }
  console.warn('SW: No manifest found, using fallback');
  return null;
}

// Install with error handling
self.addEventListener('install', (event) => {
  console.log('SW: Installing with safe caching');
  
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        
        // Add manifest if found
        const manifestPath = await findManifestPath();
        if (manifestPath) {
          STATIC_ASSETS.push(manifestPath);
        }
        
        // Cache assets that exist
        const validAssets = [];
        for (const asset of STATIC_ASSETS) {
          if (await resourceExists(asset)) {
            validAssets.push(asset);
          }
        }
        
        await cache.addAll(validAssets);
        console.log('SW: Cached', validAssets.length, 'assets');
        
        await self.skipWaiting();
      } catch (error) {
        console.error('SW: Install failed, continuing anyway:', error);
      }
    })()
  );
});

// Activate with cleanup
self.addEventListener('activate', (event) => {
  console.log('SW: Activating with cleanup');
  
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        
        // Only delete caches from this domain
        const currentDomain = new URL(self.location).hostname;
        const oldCaches = cacheNames.filter(name => 
          name.includes(currentDomain) && name !== CACHE_NAME
        );
        
        await Promise.all(oldCaches.map(name => caches.delete(name)));
        console.log('SW: Cleaned up', oldCaches.length, 'old caches');
        
        await self.clients.claim();
      } catch (error) {
        console.error('SW: Activation cleanup failed:', error);
      }
    })()
  );
});

// Safe fetch with fallbacks
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  event.respondWith(
    (async () => {
      try {
        // Try cache first
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Try network
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          // Cache successful responses
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        
        return networkResponse;
      } catch {
        // Fallback for offline
        return new Response('Offline - Please check your connection', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })()
  );
});

// Safe push notification handling
self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : { title: 'PPE Alert' };
    
    const options = {
      body: data.body || 'You have a new notification',
      icon: data.icon || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="40" fill="%2327AE60"/%3E%3C/svg%3E',
      tag: 'ppe-notification',
      requireInteraction: false,
      silent: false
    };
    
    event.waitUntil(self.registration.showNotification(data.title || 'PPE Alert', options));
  } catch (error) {
    console.error('SW: Push notification failed:', error);
  }
});

console.log('SW: Robust service worker loaded successfully');