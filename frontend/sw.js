const CACHE_NAME = 'ppe-manager-v4';
const API_CACHE = 'ppe-api-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/frontend/manifest.json'
];

const API_ENDPOINTS = [
  '/api/dashboard/stats',
  '/api/inventory',
  '/api/auth/login',
  '/api/ppe-requests'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('SW: Install event');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('SW: Activate event');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== API_CACHE) {
              console.log('SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Fetch event - handle network requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  
  // Handle static assets
  event.respondWith(
    caches.match(request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          return response;
        }
        
        // Fetch from network and cache
        return fetch(request)
          .then((response) => {
            // Only cache successful responses
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseClone);
                });
            }
            return response;
          })
          .catch(() => {
            // Return offline fallback for HTML requests
            if (request.headers.get('accept').includes('text/html')) {
              return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>PPE Manager - Offline</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 50px; }
                    .offline { color: #666; }
                  </style>
                </head>
                <body>
                  <h1>PPE Manager</h1>
                  <p class="offline">You're currently offline. Please check your connection and try again.</p>
                  <button onclick="window.location.reload()">Retry</button>
                </body>
                </html>
              `, {
                headers: { 'Content-Type': 'text/html' }
              });
            }
          });
      })
  );
});

// Handle API requests with caching strategy
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  try {
    // For PPE requests, try network first
    if (url.pathname.includes('/ppe/request')) {
      return await handlePPERequest(request);
    }
    
    // For dashboard/stats, use cache-first strategy
    if (url.pathname.includes('/dashboard/stats')) {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        // Return cached data immediately, then update in background
        fetchAndUpdateCache(request);
        return cachedResponse;
      }
    }
    
    // Default: network first, cache as fallback
    const response = await fetch(request);
    
    // Cache successful GET requests
    if (request.method === 'GET' && response.status === 200) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.log('SW: Network failed, trying cache');
    
    // Try to return cached response
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline response for failed requests
    return new Response(
      JSON.stringify({ 
        error: 'Network unavailable', 
        offline: true,
        timestamp: Date.now()
      }),
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Handle PPE requests with offline queue
async function handlePPERequest(request) {
  try {
    // Try network first
    const response = await fetch(request);
    return response;
    
  } catch (error) {
    // If network fails, queue the request for later
    const requestData = await request.json();
    await queueOfflineRequest(requestData);
    
    return new Response(
      JSON.stringify({
        success: true,
        offline: true,
        message: 'PPE request queued for when connection is restored',
        requestId: generateOfflineId()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Queue offline requests
async function queueOfflineRequest(requestData) {
  const offlineQueue = await getOfflineQueue();
  const queueItem = {
    id: generateOfflineId(),
    data: requestData,
    timestamp: Date.now(),
    url: '/api/ppe/request',
    method: 'POST'
  };
  
  offlineQueue.push(queueItem);
  await setOfflineQueue(offlineQueue);
  
  console.log('SW: Queued offline request:', queueItem.id);
}

// Background sync for offline requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-sync') {
    event.waitUntil(syncOfflineRequests());
  }
});

// Sync offline requests when connection is restored
async function syncOfflineRequests() {
  console.log('SW: Syncing offline requests');
  
  const offlineQueue = await getOfflineQueue();
  const syncedIds = [];
  
  for (const item of offlineQueue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data)
      });
      
      if (response.ok) {
        syncedIds.push(item.id);
        console.log('SW: Synced offline request:', item.id);
        
        // Notify client about successful sync
        notifyClients('request-synced', {
          offlineId: item.id,
          response: await response.json()
        });
      }
      
    } catch (error) {
      console.log('SW: Failed to sync request:', item.id, error);
    }
  }
  
  // Remove synced requests from queue
  const remainingQueue = offlineQueue.filter(item => !syncedIds.includes(item.id));
  await setOfflineQueue(remainingQueue);
}

// Background fetch for cache updates
async function fetchAndUpdateCache(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
  } catch (error) {
    console.log('SW: Background fetch failed');
  }
}

// Utility functions
function generateOfflineId() {
  return 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function getOfflineQueue() {
  try {
    const cache = await caches.open(API_CACHE);
    const response = await cache.match('/offline-queue');
    if (response) {
      return await response.json();
    }
  } catch (error) {
    console.log('SW: Error getting offline queue');
  }
  return [];
}

async function setOfflineQueue(queue) {
  try {
    const cache = await caches.open(API_CACHE);
    const response = new Response(JSON.stringify(queue), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/offline-queue', response);
  } catch (error) {
    console.log('SW: Error setting offline queue');
  }
}

// Notify clients about events
function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type, data });
    });
  });
}

// Push notification handling
self.addEventListener('push', (event) => {
  console.log('SW: Push notification received');
  
  const options = {
    body: 'You have a new PPE alert',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="40" fill="%2327AE60"/%3E%3Cpath d="M30 50h40M50 30v40" stroke="white" stroke-width="4" stroke-linecap="round"/%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="40" fill="%2327AE60"/%3E%3Cpath d="M30 50h40M50 30v40" stroke="white" stroke-width="4" stroke-linecap="round"/%3E%3C/svg%3E',
    tag: 'ppe-alert',
    renotify: true,
    actions: [
      {
        action: 'view',
        title: 'View Details'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  if (event.data) {
    const payload = event.data.json();
    options.body = payload.message || options.body;
    options.data = payload;
  }
  
  event.waitUntil(
    self.registration.showNotification('PPE Manager', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('SW: Notification click received');
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/?notification=clicked')
    );
  }
});