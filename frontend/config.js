// Production-safe configuration
const CONFIG = {
  // Auto-generate cache version from build timestamp
  CACHE_VERSION: `ppe-v${Date.now()}`,
  
  // Base paths that work in any deployment
  MANIFEST_PATH: '/frontend/manifest.json',
  SERVICE_WORKER_PATH: '/frontend/sw.js',
  
  // Feature flags for safe deployment
  ENABLE_SERVICE_WORKER: true,
  ENABLE_PUSH_NOTIFICATIONS: true,
  
  // Deployment environment
  ENVIRONMENT: 'production'
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.PPE_CONFIG = CONFIG;
}