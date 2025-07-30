const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CacheBuster {
    constructor() {
        this.hashCache = new Map();
    }

    /**
     * Generate hash-based version for any file
     * @param {string} filePath - Absolute path to file
     * @returns {string} - Hash-based version string
     */
    getFileVersion(filePath) {
        try {
            // Check if we already have a cached hash
            const stats = fs.statSync(filePath);
            const lastModified = stats.mtime.getTime();
            
            const cacheKey = filePath;
            const cached = this.hashCache.get(cacheKey);
            
            // Return cached hash if file hasn't been modified
            if (cached && cached.lastModified === lastModified) {
                return cached.hash;
            }
            
            // Generate new hash
            const fileContent = fs.readFileSync(filePath);
            const hash = crypto
                .createHash('md5')
                .update(fileContent)
                .digest('hex')
                .substring(0, 8); // Use first 8 characters
            
            // Cache the result
            this.hashCache.set(cacheKey, {
                hash,
                lastModified
            });
            
            return hash;
        } catch (error) {
            console.warn(`Failed to generate version for ${filePath}:`, error.message);
            // Fallback to timestamp
            return Date.now().toString(36);
        }
    }

    /**
     * Get version for manifest.json specifically
     */
    getManifestVersion() {
        const manifestPath = path.resolve(__dirname, '../../frontend/manifest.json');
        return this.getFileVersion(manifestPath);
    }

    /**
     * Get version for any static asset
     * @param {string} relativePath - Path relative to project root
     */
    getAssetVersion(relativePath) {
        const assetPath = path.resolve(__dirname, '../..', relativePath);
        return this.getFileVersion(assetPath);
    }

    /**
     * Clear cache for a specific file (useful when file is modified)
     */
    clearCache(filePath) {
        this.hashCache.delete(filePath);
    }

    /**
     * Clear all cached versions
     */
    clearAllCache() {
        this.hashCache.clear();
    }

    /**
     * Get server startup timestamp (alternative method)
     */
    getServerVersion() {
        return process.env.SERVER_START_TIME || Date.now().toString(36);
    }
}

// Singleton instance
const cacheBuster = new CacheBuster();

// Set server start time
if (!process.env.SERVER_START_TIME) {
    process.env.SERVER_START_TIME = Date.now().toString(36);
}

module.exports = cacheBuster;