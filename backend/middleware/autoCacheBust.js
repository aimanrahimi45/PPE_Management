const cacheBuster = require('../utils/cacheUtils');
const fs = require('fs');
const path = require('path');

/**
 * Middleware to automatically replace cache-busting placeholders in HTML files
 */
function autoCacheBustMiddleware(req, res, next) {
    // Only process HTML files
    if (!req.path.endsWith('.html') && !req.path.endsWith('/')) {
        return next();
    }

    // Store original send method
    const originalSend = res.send;
    
    // Override send method
    res.send = function(data) {
        if (typeof data === 'string' && data.includes('{{')) {
            // Replace cache-busting placeholders with aggressive versioning
            const timestamp = Date.now();
            const manifestVersion = `${cacheBuster.getManifestVersion()}-${timestamp}`;
            
            data = data.replace(/\{\{MANIFEST_VERSION\}\}/g, manifestVersion);
            data = data.replace(/\{\{SERVER_VERSION\}\}/g, cacheBuster.getServerVersion());
            data = data.replace(/\{\{TIMESTAMP\}\}/g, timestamp);
            
            // Replace asset versions - matches {{ASSET:path/to/file}}
            data = data.replace(/\{\{ASSET:([^}]+)\}\}/g, (match, assetPath) => {
                return cacheBuster.getAssetVersion(assetPath.trim());
            });
            
            console.log(`🔄 Auto cache-bust applied to ${req.path}`);
        }
        
        // Call original send with modified data
        return originalSend.call(this, data);
    };
    
    next();
}

/**
 * Express route handler for serving HTML files with automatic cache busting
 */
function serveHTMLWithCacheBust(filePath) {
    return (req, res) => {
        try {
            let html = fs.readFileSync(filePath, 'utf8');
            
            // Replace cache-busting placeholders with aggressive versioning
            const timestamp = Date.now();
            const manifestVersion = `${cacheBuster.getManifestVersion()}-${timestamp}`;
            
            html = html.replace(/\{\{MANIFEST_VERSION\}\}/g, manifestVersion);
            html = html.replace(/\{\{SERVER_VERSION\}\}/g, cacheBuster.getServerVersion());
            html = html.replace(/\{\{TIMESTAMP\}\}/g, timestamp);
            
            // Replace asset versions
            html = html.replace(/\{\{ASSET:([^}]+)\}\}/g, (match, assetPath) => {
                return cacheBuster.getAssetVersion(assetPath.trim());
            });
            
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('X-Timestamp', Date.now()); // Force browser reload
            
            res.send(html);
        } catch (error) {
            console.error('Error serving HTML with cache bust:', error);
            res.status(500).send('Internal Server Error');
        }
    };
}

/**
 * API endpoint to get current versions (useful for debugging)
 */
function getVersionInfo(req, res) {
    const versions = {
        server: cacheBuster.getServerVersion(),
        manifest: cacheBuster.getManifestVersion(),
        timestamp: Date.now(),
        assets: {
            'worker.html': cacheBuster.getAssetVersion('pages/worker.html'),
            'admin.html': cacheBuster.getAssetVersion('pages/admin.html'),
            'frontend/manifest.json': cacheBuster.getAssetVersion('frontend/manifest.json')
        }
    };
    
    res.json(versions);
}

module.exports = {
    autoCacheBustMiddleware,
    serveHTMLWithCacheBust,
    getVersionInfo
};