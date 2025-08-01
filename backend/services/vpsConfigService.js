const crypto = require('crypto');
const { getDb } = require('../database/init');

/**
 * VPS Configuration Service - Tamper-resistant VPS settings
 * Hardcoded configuration to prevent user tampering
 */
class VPSConfigService {
  constructor() {
    // Hardcoded VPS configuration (tamper-resistant)
    this.vpsConfig = {
      enabled: true, // Always enabled - no user override
      serverUrl: 'http://62.72.45.202:3001',
      apiKey: 'PPE-MANAGEMENT-LICENSE-API-2024',
      fallbackServers: [
        'http://62.72.45.202:3001',
        // Add backup servers if needed
      ],
      maxRetries: 3,
      timeout: 30000,
      gracePeriodDays: 7
    };

    // Generate config hash for tamper detection
    this.configHash = this.generateConfigHash();
  }

  /**
   * Get VPS configuration (tamper-resistant)
   * @returns {Object} VPS configuration
   */
  getVPSConfig() {
    // Always return hardcoded config - ignore .env overrides
    const config = {
      enabled: true, // Force enabled
      serverUrl: this.vpsConfig.serverUrl,
      apiKey: this.vpsConfig.apiKey,
      fallbackServers: this.vpsConfig.fallbackServers,
      maxRetries: this.vpsConfig.maxRetries,
      timeout: this.vpsConfig.timeout,
      gracePeriodDays: this.vpsConfig.gracePeriodDays
    };

    // Log any tampering attempts
    this.detectTamperingAttempts();

    return config;
  }

  /**
   * Check if VPS validation is enabled (always true)
   * @returns {boolean} Always returns true
   */
  isVPSValidationEnabled() {
    // Always enabled - ignore environment variables
    this.detectTamperingAttempts();
    return true;
  }

  /**
   * Get VPS server URL with fallback logic
   * @returns {string} VPS server URL
   */
  getVPSServerUrl() {
    // Return hardcoded URL - ignore environment override
    return this.vpsConfig.serverUrl;
  }

  /**
   * Get all possible VPS server URLs (for fallback)
   * @returns {string[]} Array of server URLs
   */
  getVPSServerUrls() {
    return [...this.vpsConfig.fallbackServers];
  }

  /**
   * Test VPS server connectivity with fallback
   * @returns {Promise<{success: boolean, serverUrl: string, error?: string}>}
   */
  async testVPSConnectivity() {
    const serverUrls = this.getVPSServerUrls();
    
    for (const serverUrl of serverUrls) {
      try {
        console.log(`🔗 Testing VPS connectivity: ${serverUrl}`);
        
        const fetch = globalThis.fetch || require('node-fetch');
        const response = await fetch(`${serverUrl}/health`, {
          method: 'GET',
          timeout: 10000,
          headers: {
            'User-Agent': 'PPE-Management-License-Client/2.0'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'healthy') {
            console.log(`✅ VPS server healthy: ${serverUrl}`);
            return {
              success: true,
              serverUrl: serverUrl,
              serverInfo: data
            };
          }
        }
      } catch (error) {
        console.log(`❌ VPS server unreachable: ${serverUrl} - ${error.message}`);
      }
    }

    return {
      success: false,
      error: 'All VPS servers unreachable',
      attemptedServers: serverUrls
    };
  }

  /**
   * Generate configuration hash for tamper detection
   * @returns {string} Configuration hash
   */
  generateConfigHash() {
    const configString = JSON.stringify(this.vpsConfig);
    return crypto.createHash('sha256').update(configString + 'VPS-CONFIG-SALT').digest('hex');
  }

  /**
   * Detect tampering attempts by checking environment variables
   */
  detectTamperingAttempts() {
    const suspiciousActivity = [];

    // Check if user tried to disable VPS validation
    if (process.env.ENABLE_VPS_LICENSE_CHECK === 'false') {
      suspiciousActivity.push('Attempted to disable VPS validation via environment');
    }

    // Check if user tried to override server URL
    if (process.env.LICENSE_SERVER_URL && process.env.LICENSE_SERVER_URL !== this.vpsConfig.serverUrl) {
      suspiciousActivity.push(`Attempted to override VPS server URL to: ${process.env.LICENSE_SERVER_URL}`);
    }

    // Check if user tried to override API key
    if (process.env.LICENSE_API_KEY && process.env.LICENSE_API_KEY !== this.vpsConfig.apiKey) {
      suspiciousActivity.push('Attempted to override VPS API key');
    }

    if (suspiciousActivity.length > 0) {
      console.log('🚨 VPS configuration tampering detected:');
      suspiciousActivity.forEach(activity => {
        console.log(`   - ${activity}`);
      });
      
      // Record tampering attempt in database
      this.recordTamperingAttempt(suspiciousActivity);
    }
  }

  /**
   * Record tampering attempt in database
   * @param {string[]} suspiciousActivity - List of suspicious activities
   */
  async recordTamperingAttempt(suspiciousActivity) {
    try {
      const db = getDb();
      if (!db) return;

      const tamperingDetails = {
        timestamp: new Date().toISOString(),
        activities: suspiciousActivity,
        environment: {
          ENABLE_VPS_LICENSE_CHECK: process.env.ENABLE_VPS_LICENSE_CHECK,
          LICENSE_SERVER_URL: process.env.LICENSE_SERVER_URL,
          LICENSE_API_KEY: process.env.LICENSE_API_KEY ? '[REDACTED]' : undefined
        }
      };

      await new Promise((resolve) => {
        db.run(`
          UPDATE license_config 
          SET 
            vps_validation_failures = COALESCE(vps_validation_failures, 0) + 1,
            last_vps_error = ?
          WHERE id = 1
        `, [JSON.stringify(tamperingDetails)], (err) => {
          if (err) {
            console.error('Error recording tampering attempt:', err);
          } else {
            console.log('⚠️ Tampering attempt recorded in database');
          }
          resolve();
        });
      });

    } catch (error) {
      console.error('Failed to record tampering attempt:', error);
    }
  }

  /**
   * Get system integrity status
   * @returns {Promise<{secure: boolean, issues: string[], recommendations: string[]}>}
   */
  async getSystemIntegrityStatus() {
    const issues = [];
    const recommendations = [];

    // Check for environment variable tampering
    if (process.env.ENABLE_VPS_LICENSE_CHECK === 'false') {
      issues.push('VPS validation disabled via environment variable');
      recommendations.push('Remove ENABLE_VPS_LICENSE_CHECK=false from .env file');
    }

    if (process.env.LICENSE_SERVER_URL && process.env.LICENSE_SERVER_URL !== this.vpsConfig.serverUrl) {
      issues.push('VPS server URL modified');
      recommendations.push('Remove LICENSE_SERVER_URL override from .env file');
    }

    // Check database tampering history
    try {
      const db = getDb();
      const tamperingHistory = await new Promise((resolve) => {
        db.get(`
          SELECT vps_validation_failures, last_vps_error 
          FROM license_config 
          WHERE id = 1
        `, [], (err, row) => {
          resolve(err ? null : row);
        });
      });

      if (tamperingHistory && tamperingHistory.vps_validation_failures > 5) {
        issues.push('Multiple tampering attempts detected');
        recommendations.push('System requires immediate VPS validation');
      }
    } catch (error) {
      console.error('Error checking tampering history:', error);
    }

    return {
      secure: issues.length === 0,
      issues: issues,
      recommendations: recommendations,
      configHash: this.configHash
    };
  }

  /**
   * Force VPS validation check (ignores grace period for security)
   * @returns {boolean} Whether VPS validation should be forced
   */
  shouldForceVPSValidation() {
    // Always force if tampering detected
    const envTampering = process.env.ENABLE_VPS_LICENSE_CHECK === 'false' ||
                        (process.env.LICENSE_SERVER_URL && process.env.LICENSE_SERVER_URL !== this.vpsConfig.serverUrl);
    
    if (envTampering) {
      console.log('🔒 Forcing VPS validation due to configuration tampering');
      return true;
    }

    return false;
  }
}

module.exports = new VPSConfigService();