// Service Worker for PPE Management System
// Handles push notifications and offline functionality

const CACHE_NAME = 'ppe-management-{{SERVER_VERSION}}';
const urlsToCache = [
  '/worker.html',
  '/frontend/manifest.json',
  // Add other critical assets
];

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('Service Worker: Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Installation successful');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activate event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activation successful');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(() => {
        // If offline and no cache, return offline page
        if (event.request.destination === 'document') {
          return caches.match('/worker.html');
        }
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', event => {
  console.log('Service Worker: Push event received');
  
  let notificationData = {};
  
  if (event.data) {
    notificationData = event.data.json();
    console.log('Push notification data:', notificationData);
  } else {
    notificationData = {
      title: 'PPE Management',
      body: 'You have a new notification',
      icon: '/manifest-icon-192.png'
    };
  }

  const notificationOptions = {
    body: notificationData.body,
    icon: notificationData.icon || '/manifest-icon-192.png',
    badge: notificationData.badge || '/manifest-icon-192.png',
    data: notificationData.data || {},
    actions: notificationData.actions || [],
    requireInteraction: true,
    tag: 'ppe-notification'
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationOptions)
  );
});

// Notification click event - handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notification click event');
  
  event.notification.close();

  const notificationData = event.notification.data;
  const targetUrl = notificationData.url || '/worker.html';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      // Check if there's already a window/tab open with the target URL
      for (const client of clientList) {
        if (client.url.includes('/worker.html') && 'focus' in client) {
          client.focus();
          
          // Send message to client about the notification
          client.postMessage({
            type: 'notification_clicked',
            data: notificationData
          });
          
          return;
        }
      }
      
      // If no existing window, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl).then(windowClient => {
          // Send message to the new window
          if (windowClient) {
            windowClient.postMessage({
              type: 'notification_clicked',
              data: notificationData
            });
          }
        });
      }
    })
  );
});

// Background sync - handle offline form submissions (future feature)
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync event');
  
  if (event.tag === 'ppe-request-sync') {
    event.waitUntil(
      // Handle offline PPE request submissions
      syncPPERequests()
    );
  }
});

// Function to sync offline PPE requests (placeholder)
async function syncPPERequests() {
  console.log('Service Worker: Syncing offline PPE requests');
  
  // This would retrieve offline-stored requests and submit them
  // when connectivity is restored
  
  try {
    // Get stored requests from IndexedDB or similar
    // Submit them to the server
    // Clear stored requests on success
    
    console.log('Service Worker: PPE requests synced successfully');
  } catch (error) {
    console.error('Service Worker: Failed to sync PPE requests:', error);
  }
}

// Message event - handle messages from main thread
self.addEventListener('message', event => {
  console.log('Service Worker: Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('Service Worker: Loaded successfully');