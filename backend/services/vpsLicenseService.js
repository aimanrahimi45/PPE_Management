const crypto = require('crypto');
const os = require('os');

// Use built-in fetch (Node.js 18+) or fallback to node-fetch
const fetch = globalThis.fetch || require('node-fetch');

class VPSLicenseService {
  constructor() {
    // Use tamper-resistant configuration service
    const vpsConfigService = require('./vpsConfigService');
    const config = vpsConfigService.getVPSConfig();
    
    this.licenseServerUrl = config.serverUrl;
    this.apiKey = config.apiKey;
    
    // Enhanced device fingerprinting
    this.fingerprintVersion = '2.0';
    
    // Validation cache to prevent excessive API calls
    this.validationCache = {
      result: null,
      timestamp: null,
      ttl: 300000, // 5 minutes cache for VPS validation
      licenseKey: null
    };
    
    // Heartbeat configuration
    this.heartbeatInterval = 30 * 60 * 1000; // 30 minutes
    this.heartbeatTimer = null;
  }

  /**
   * Generate enhanced device fingerprint for license binding (STABLE VERSION)
   * @returns {string} Enhanced device fingerprint resistant to abnormal shutdowns
   */
  generateDeviceFingerprint() {
    const networkInterfaces = os.networkInterfaces();
    const physicalMacAddresses = [];
    
    // Extract only PHYSICAL MAC addresses (exclude virtual/temporary ones)
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const networkInterface of interfaces) {
        if (!networkInterface.internal && 
            networkInterface.mac !== '00:00:00:00:00:00' &&
            !interfaceName.toLowerCase().includes('vmware') &&
            !interfaceName.toLowerCase().includes('virtualbox') &&
            !interfaceName.toLowerCase().includes('hyper-v') &&
            !interfaceName.toLowerCase().includes('docker') &&
            !interfaceName.toLowerCase().includes('wsl') &&
            !interfaceName.toLowerCase().includes('vpn') &&
            !interfaceName.toLowerCase().includes('loopback')) {
          physicalMacAddresses.push(networkInterface.mac);
        }
      }
    }
    
    // Get stable hardware identifiers
    const cpus = os.cpus();
    const primaryCpuModel = cpus[0]?.model || 'unknown';
    
    // Round memory to nearest GB to handle small variations
    const memoryGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    
    // Create STABLE fingerprint (resistant to shutdown variations)
    const stableFingerprintData = {
      version: this.fingerprintVersion,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname().toLowerCase(), // Normalize case
      username: os.userInfo().username.toLowerCase(), // Normalize case
      physicalMacs: physicalMacAddresses.sort(), // Only physical MACs, sorted
      primaryCpuModel: primaryCpuModel.replace(/\s+/g, ' ').trim(), // Normalize CPU model
      cpuCount: cpus.length,
      memoryGB: memoryGB, // Rounded to GB for stability
      nodeVersionMajor: process.version.split('.')[0] // Only major version for stability
    };
    
    const fingerprintString = JSON.stringify(stableFingerprintData);
    const fingerprint = crypto.createHash('sha256').update(fingerprintString).digest('hex');
    
    console.log(`🆔 Stable Device Fingerprint Generated:`);
    console.log(`   Platform: ${stableFingerprintData.platform} ${stableFingerprintData.arch}`);
    console.log(`   Host: ${stableFingerprintData.hostname} (${stableFingerprintData.username})`);
    console.log(`   Physical MACs: ${physicalMacAddresses.length} interfaces`);
    console.log(`   Hardware: ${stableFingerprintData.cpuCount} cores, ${stableFingerprintData.memoryGB}GB RAM`);
    console.log(`   CPU: ${primaryCpuModel.substring(0, 30)}...`);
    console.log(`   Fingerprint: ${fingerprint.substring(0, 16)}...`);
    
    return fingerprint;
  }

  /**
   * Activate license on VPS server
   * @param {string} licenseKey - License key to activate
   * @param {object} clientInfo - Client information
   * @returns {Promise<object>} Activation result
   */
  async activateLicense(licenseKey, clientInfo = {}) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      // Extract VPS tracking key for activation
      const vpsTrackingKey = await this.extractVPSTrackingKey(licenseKey);
      
      const payload = {
        action: 'activate',
        licenseKey: vpsTrackingKey, // Use tracking key for VPS activation
        deviceFingerprint: deviceFingerprint,
        clientInfo: {
          ...clientInfo,
          activationTime: new Date().toISOString(),
          systemInfo: {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            nodeVersion: process.version,
            version: this.fingerprintVersion
          }
        }
      };

      console.log(`🔄 Activating license on VPS server...`);
      console.log(`   License: ${licenseKey.substring(0, 8)}...`);
      console.log(`   Device: ${deviceFingerprint.substring(0, 16)}...`);
      console.log(`   Server: ${this.licenseServerUrl}`);

      const response = await this.makeSecureRequest('/api/license/validate', payload);
      
      if (response.success) {
        console.log(`✅ License activated successfully on VPS`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Expires: ${response.expiryDate || 'Never'}`);
        
        // Start heartbeat for active license
        this.startHeartbeat(licenseKey, deviceFingerprint);
        
        return {
          success: true,
          status: response.status,
          deviceFingerprint: deviceFingerprint,
          serverResponse: response,
          activatedAt: new Date().toISOString()
        };
      } else {
        console.log(`❌ License activation failed: ${response.error}`);
        return {
          success: false,
          error: response.error,
          details: response.details
        };
      }

    } catch (error) {
      console.error(`❌ VPS License activation error:`, error.message);
      return {
        success: false,
        error: 'VPS communication failed',
        details: error.message,
        fallbackMode: true
      };
    }
  }

  /**
   * Extract VPS tracking key from license content using simple pattern matching
   * @param {string} fullLicenseKey - Full encrypted license key
   * @returns {Promise<string>} VPS tracking key from license or generated key
   */
  async extractVPSTrackingKey(fullLicenseKey) {
    try {
      console.log(`🔑 Extracting VPS tracking key from license...`);
      
      // For new licenses generated with our enhanced generator, 
      // we'll use a deterministic approach based on license content
      const crypto = require('crypto');
      
      // Check if this looks like a v2 encrypted license
      if (fullLicenseKey.startsWith('v2:')) {
        // Create a deterministic tracking key based on the encrypted content
        // This ensures the same license always generates the same tracking key
        const contentHash = crypto.createHash('sha256').update(fullLicenseKey).digest('hex');
        
        // Use complete license signature for consistency
        const parts = fullLicenseKey.split(':');
        if (parts.length >= 2) {
          const licenseSignature = parts[1]; // Full signature, not truncated
          console.log(`📋 License signature: ${licenseSignature.substring(0, 16)}... (${licenseSignature.length} chars)`);
          
          const sigHash = crypto.createHash('sha256').update(licenseSignature).digest('hex');
          const trackingKey = `VPS-${sigHash.substring(0, 16).toUpperCase()}`;
          console.log(`🔑 Generated deterministic VPS tracking key: ${trackingKey}`);
          return trackingKey;
        }
      }
      
      // Fallback for any license format
      const hash = crypto.createHash('sha256').update(fullLicenseKey).digest('hex');
      const fallbackKey = `LEGACY-${hash.substring(0, 16).toUpperCase()}`;
      console.log(`🔑 Using legacy VPS tracking key: ${fallbackKey}`);
      return fallbackKey;
      
    } catch (error) {
      console.error('❌ Failed to extract VPS tracking key:', error.message);
      
      // Ultimate fallback
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(fullLicenseKey || 'unknown').digest('hex');
      const emergencyKey = `EMERGENCY-${hash.substring(0, 12).toUpperCase()}`;
      console.log(`🔑 Using emergency VPS tracking key: ${emergencyKey}`);
      return emergencyKey;
    }
  }

  /**
   * Validate license with VPS server
   * @param {string} licenseKey - License key to validate
   * @returns {Promise<object>} Validation result
   */
  async validateWithVPS(licenseKey) {
    try {
      // Check cache first
      if (this.isValidationCached(licenseKey)) {
        console.log(`📋 Using cached VPS validation result`);
        return this.validationCache.result;
      }

      const deviceFingerprint = this.generateDeviceFingerprint();
      
      // Extract VPS tracking key from license (not the full encrypted license)
      const vpsTrackingKey = await this.extractVPSTrackingKey(licenseKey);
      
      const payload = {
        action: 'validate',
        licenseKey: vpsTrackingKey, // Use tracking key for VPS validation
        deviceFingerprint: deviceFingerprint,
        timestamp: new Date().toISOString(),
        originalLicense: licenseKey.substring(0, 20) + '...' // Keep reference to original
      };

      console.log(`🔍 Validating license with VPS server...`);
      
      // First try validation
      let response = await this.makeSecureRequest('/api/license/validate', payload);
      
      // Check if we need to attempt activation (for new licenses or device mismatches)
      const needsActivation = (!response.success && (
        // Device fingerprint mismatch (existing license, different device)
        response.error === 'Device fingerprint mismatch' ||
        response.error?.includes('fingerprint mismatch') ||
        response.error?.includes('different device') ||
        response.status === 403 ||
        // License not activated (new license, needs first activation)
        response.error === 'License not activated' ||
        response.error?.includes('not activated') ||
        response.error?.includes('not found') ||
        response.status === 404
      ));
      
      if (needsActivation) {
        if (response.error?.includes('not activated') || response.error?.includes('not found') || response.status === 404) {
          console.log(`🚀 New license detected, attempting first-time activation...`);
        } else {
          console.log(`🔄 Device/fingerprint mismatch detected, attempting activation for new device...`);
        }
        console.log(`   Original error: ${response.error}`);
        
        const activationPayload = {
          ...payload,
          action: 'activate'
        };
        
        response = await this.makeSecureRequest('/api/license/validate', activationPayload);
        
        if (response.success) {
          console.log(`✅ License activated successfully: ${response.status}`);
        } else {
          console.log(`❌ License activation failed: ${response.error}`);
        }
      }
      
      const result = {
        valid: response.success === true,
        vpsValidated: true,
        error: response.error || null,
        details: response.details || null,
        status: response.status || 'unknown',
        expiryDate: response.expiryDate || null,
        deviceMatch: response.deviceMatch === true,
        lastSeen: new Date().toISOString()
      };

      // Cache the result
      this.cacheValidationResult(licenseKey, result);
      
      if (result.valid) {
        console.log(`✅ VPS License validation successful`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Device Match: ${result.deviceMatch}`);
        
        // Ensure heartbeat is running for valid licenses
        this.startHeartbeat(licenseKey, deviceFingerprint);
      } else {
        console.log(`❌ VPS License validation failed: ${result.error}`);
        this.stopHeartbeat();
      }
      
      return result;

    } catch (error) {
      console.error(`❌ VPS validation error:`, error.message);
      
      // Return graceful fallback
      return {
        valid: false,
        vpsValidated: false,
        error: 'VPS communication failed',
        details: error.message,
        fallbackMode: true,
        lastSeen: new Date().toISOString()
      };
    }
  }

  /**
   * Send heartbeat to VPS to maintain license status
   * @param {string} licenseKey - License key
   * @param {string} deviceFingerprint - Device fingerprint
   */
  async sendHeartbeat(licenseKey, deviceFingerprint) {
    try {
      // Extract VPS tracking key for heartbeat
      const vpsTrackingKey = await this.extractVPSTrackingKey(licenseKey);
      
      const payload = {
        action: 'heartbeat',
        licenseKey: vpsTrackingKey,
        deviceFingerprint: deviceFingerprint,
        timestamp: new Date().toISOString(),
        systemStatus: {
          uptime: os.uptime(),
          loadAvg: os.loadavg(),
          freeMemory: os.freemem(),
          totalMemory: os.totalmem()
        }
      };

      console.log(`💓 Sending license heartbeat to VPS...`);
      const response = await this.makeSecureRequest('/api/license/heartbeat', payload);
      
      if (response.success) {
        console.log(`✅ Heartbeat acknowledged by VPS`);
        return true;
      } else {
        console.log(`⚠️ Heartbeat warning: ${response.error}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Heartbeat failed:`, error.message);
      return false;
    }
  }

  /**
   * Start periodic heartbeat to VPS
   * @param {string} licenseKey - License key
   * @param {string} deviceFingerprint - Device fingerprint
   */
  startHeartbeat(licenseKey, deviceFingerprint) {
    // Stop existing heartbeat
    this.stopHeartbeat();
    
    console.log(`🔄 Starting license heartbeat (${this.heartbeatInterval / 60000} minutes interval)`);
    
    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeat(licenseKey, deviceFingerprint);
    }, this.heartbeatInterval);
    
    // Send initial heartbeat
    setTimeout(() => {
      this.sendHeartbeat(licenseKey, deviceFingerprint);
    }, 5000); // 5 seconds delay
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log(`⏹️ License heartbeat stopped`);
    }
  }

  /**
   * Deactivate license on VPS server
   * @param {string} licenseKey - License key to deactivate
   * @returns {Promise<object>} Deactivation result
   */
  async deactivateLicense(licenseKey) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      // Extract VPS tracking key for deactivation
      const vpsTrackingKey = await this.extractVPSTrackingKey(licenseKey);
      
      const payload = {
        action: 'deactivate',
        licenseKey: vpsTrackingKey,
        deviceFingerprint: deviceFingerprint,
        timestamp: new Date().toISOString()
      };

      console.log(`🔄 Deactivating license on VPS server...`);
      const response = await this.makeSecureRequest('/api/license/validate', payload);
      
      this.stopHeartbeat();
      this.clearValidationCache();
      
      return {
        success: response.success === true,
        message: response.message || 'License deactivated',
        error: response.error || null
      };

    } catch (error) {
      console.error(`❌ License deactivation error:`, error.message);
      return {
        success: false,
        error: 'VPS communication failed',
        details: error.message
      };
    }
  }

  /**
   * Make secure request to VPS license server
   * @param {string} endpoint - API endpoint
   * @param {object} payload - Request payload
   * @returns {Promise<object>} Response data
   */
  async makeSecureRequest(endpoint, payload) {
    const url = `${this.licenseServerUrl}${endpoint}`;
    
    const requestPayload = {
      ...payload,
      apiKey: this.apiKey,
      timestamp: new Date().toISOString(),
      version: this.fingerprintVersion
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PPE-Management-License-Client/2.0',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(requestPayload),
      timeout: 30000 // 30 second timeout
    });

    if (!response.ok) {
      // For HTTP error responses, try to get JSON error details
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        // If JSON parsing fails, use generic error
        errorData = {
          success: false,
          error: `HTTP ${response.status}`,
          message: response.statusText
        };
      }
      
      // Return structured error response instead of throwing
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}`,
        message: errorData.message || response.statusText,
        details: errorData.details || null,
        status: response.status
      };
    }

    return await response.json();
  }

  /**
   * Check if validation result is cached and valid
   * @param {string} licenseKey - License key
   * @returns {boolean} Whether cached result is valid
   */
  isValidationCached(licenseKey) {
    const cache = this.validationCache;
    const now = Date.now();
    
    return (
      cache.result &&
      cache.licenseKey === licenseKey &&
      cache.timestamp &&
      (now - cache.timestamp) < cache.ttl
    );
  }

  /**
   * Cache validation result
   * @param {string} licenseKey - License key
   * @param {object} result - Validation result
   */
  cacheValidationResult(licenseKey, result) {
    this.validationCache = {
      result: result,
      licenseKey: licenseKey,
      timestamp: Date.now(),
      ttl: this.validationCache.ttl
    };
  }

  /**
   * Clear validation cache
   */
  clearValidationCache() {
    this.validationCache = {
      result: null,
      timestamp: null,
      ttl: this.validationCache.ttl,
      licenseKey: null
    };
  }

  /**
   * Get license server status
   * @returns {Promise<object>} Server status
   */
  async getServerStatus() {
    try {
      const response = await fetch(`${this.licenseServerUrl}/api/license/status`, {
        headers: {
          'X-API-Key': this.apiKey
        },
        timeout: 10000
      });

      if (response.ok) {
        const data = await response.json();
        return {
          online: true,
          version: data.version || 'unknown',
          serverTime: data.serverTime || new Date().toISOString()
        };
      } else {
        return {
          online: false,
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      return {
        online: false,
        error: error.message
      };
    }
  }
}

module.exports = new VPSLicenseService();