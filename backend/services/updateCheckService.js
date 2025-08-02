/**
 * Update Check Service
 * Handles automatic update checking and notification system
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

class UpdateCheckService {
  constructor() {
    this.currentVersion = '2.2.0'; // Update this with each release
    this.vpsServerUrl = process.env.VPS_LICENSE_SERVER || 'http://62.72.45.202:3001';
    this.apiKey = 'PPE-MANAGEMENT-LICENSE-API-2024';
    this.updateCheckInterval = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
    this.deviceFingerprint = null; // Will be generated during initialization
    this.licenseKey = null;
    this.lastUpdateCheck = null;
    this.updateAvailable = false;
    this.latestVersionInfo = null;
  }

  /**
   * Initialize update checking service
   */
  async initialize() {
    try {
      console.log('🔄 Update check service initializing...');
      
      // Generate enhanced device fingerprint (DYNAMIC)
      this.deviceFingerprint = this.generateDeviceFingerprint();
      
      // Ensure database table exists first
      await this.ensureUpdateNotificationsTable();
      
      // Load license key from system
      await this.loadLicenseKey();
      
      // Start periodic update checking
      this.startPeriodicUpdateCheck();
      
      console.log('✅ Update check service initialized');
      console.log(`📦 Current version: ${this.currentVersion}`);
      console.log(`🔍 Update check interval: ${this.updateCheckInterval / 1000 / 60} minutes`);
      
    } catch (error) {
      console.error('❌ Failed to initialize update check service:', error);
    }
  }

  /**
   * Ensure update_notifications table exists
   */
  async ensureUpdateNotificationsTable() {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      if (!db) {
        console.warn('⚠️ Database not available - skipping table creation');
        return false;
      }

      await new Promise((resolve, reject) => {
        db.run(`
          CREATE TABLE IF NOT EXISTS update_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            changelog TEXT,
            release_date DATETIME,
            security_update BOOLEAN DEFAULT 0,
            mandatory BOOLEAN DEFAULT 0,
            dismissed BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('❌ Failed to create update_notifications table:', err);
            reject(err);
          } else {
            console.log('✅ update_notifications table ready');
            resolve();
          }
        });
      });

      return true;
    } catch (error) {
      console.error('❌ Table creation failed:', error);
      return false;
    }
  }

  /**
   * Generate device fingerprint for update tracking (DYNAMIC: matches VPS license service)
   */
  generateDeviceFingerprint() {
    try {
      // DYNAMIC APPROACH: Try to use the same enhanced fingerprint as VPS license service
      const vpsLicenseService = require('./vpsLicenseService');
      if (vpsLicenseService && typeof vpsLicenseService.generateDeviceFingerprint === 'function') {
        console.log('🔗 Using enhanced VPS device fingerprint for update service');
        return vpsLicenseService.generateDeviceFingerprint();
      }
    } catch (error) {
      console.log('⚠️ Could not use VPS fingerprint, using fallback:', error.message);
    }
    
    // FALLBACK: Stable fingerprint logic (matches VPS service stable version)
    console.log('🔧 Using fallback stable device fingerprint generation');
    
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
    
    // Create STABLE fingerprint (matches VPS service)
    const stableFingerprintData = {
      version: '2.0', // Match VPS service version
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
    
    console.log(`🆔 Stable Device Fingerprint Generated (Update Service):`);
    console.log(`   Platform: ${stableFingerprintData.platform} ${stableFingerprintData.arch}`);
    console.log(`   Host: ${stableFingerprintData.hostname} (${stableFingerprintData.username})`);
    console.log(`   Physical MACs: ${physicalMacAddresses.length} interfaces`);
    console.log(`   Hardware: ${stableFingerprintData.cpuCount} cores, ${stableFingerprintData.memoryGB}GB RAM`);
    console.log(`   CPU: ${primaryCpuModel.substring(0, 30)}...`);
    console.log(`   Fingerprint: ${fingerprint.substring(0, 16)}...`);
    
    return fingerprint;
  }

  /**
   * Load license key from the system with multiple fallback strategies
   */
  async loadLicenseKey() {
    const strategies = [
      // Strategy 1: Database license_config lookup
      async () => {
        try {
          const { getDb } = require('../database/init');
          const db = getDb();
          
          if (!db) return null;

          return new Promise((resolve) => {
            db.get(`
              SELECT license_key FROM license_config 
              WHERE id = 'current-license' AND status = 'active'
              ORDER BY updated_at DESC LIMIT 1
            `, [], (err, row) => {
              if (err) {
                console.log('⚠️ Database license_config strategy failed:', err.message);
                resolve(null);
              } else if (row && row.license_key) {
                console.log('✅ License loaded from license_config table');
                resolve(row.license_key);
              } else {
                console.log('⚠️ No active license found in license_config table');
                resolve(null);
              }
            });
          });
        } catch (error) {
          console.log('⚠️ Database license_config strategy failed:', error.message);
        }
        return null;
      },

      // Strategy 2: Direct file system check
      async () => {
        try {
          const licensePaths = [
            path.join(process.cwd(), 'system.lic'),
            path.join(process.cwd(), 'backend', 'system.lic'),
            path.join(process.cwd(), '..', 'system.lic')
          ];

          for (const licensePath of licensePaths) {
            if (fs.existsSync(licensePath)) {
              const licenseContent = fs.readFileSync(licensePath, 'utf8').trim();
              if (licenseContent && licenseContent.length > 10) {
                console.log('✅ License loaded from file:', licensePath);
                return licenseContent;
              }
            }
          }
        } catch (error) {
          console.log('⚠️ File system strategy failed:', error.message);
        }
        return null;
      },

      // Strategy 3: Alternative database tables check
      async () => {
        try {
          const { getDb } = require('../database/init');
          const db = getDb();
          
          if (!db) return null;

          // Try different possible table names
          const tables = ['license_info', 'licenses', 'system_license'];
          
          for (const table of tables) {
            try {
              const result = await new Promise((resolve) => {
                db.get(`SELECT license_key FROM ${table} LIMIT 1`, [], (err, row) => {
                  if (err) {
                    resolve(null);
                  } else if (row && row.license_key) {
                    console.log(`✅ License loaded from ${table} table`);
                    resolve(row.license_key);
                  } else {
                    resolve(null);
                  }
                });
              });
              
              if (result) return result;
            } catch (tableError) {
              // Table doesn't exist, continue to next
            }
          }
          
          return null;
        } catch (error) {
          console.log('⚠️ Alternative database strategy failed:', error.message);
        }
        return null;
      }
    ];

    // Try each strategy until one succeeds
    for (let i = 0; i < strategies.length; i++) {
      try {
        const licenseKey = await strategies[i]();
        if (licenseKey) {
          this.licenseKey = licenseKey;
          console.log(`✅ License key loaded successfully using strategy ${i + 1}`);
          return licenseKey;
        }
      } catch (error) {
        console.log(`⚠️ Strategy ${i + 1} failed:`, error.message);
      }
    }

    console.warn('⚠️ All license loading strategies failed');
    return null;
  }

  /**
   * Extract VPS tracking key from license (same as heartbeat service)
   */
  extractVPSTrackingKey(licenseContent) {
    try {
      if (!licenseContent || licenseContent.length < 100) {
        console.error('❌ Invalid license content for VPS key extraction');
        return null;
      }

      // Extract license signature from v2 format: v2:signature:encrypted_data
      let licenseSignature;
      if (licenseContent.startsWith('v2:')) {
        const parts = licenseContent.split(':');
        if (parts.length >= 2) {
          licenseSignature = parts[1]; // Extract signature part
        }
      } else {
        // For v1 format, use first part as signature
        licenseSignature = licenseContent.substring(0, 128);
      }

      if (!licenseSignature || licenseSignature.length < 32) {
        console.error('❌ Could not extract license signature');
        return null;
      }

      console.log('🔑 Extracting VPS tracking key from license...');
      console.log(`📋 License signature: ${licenseSignature.substring(0, 16)}... (${licenseSignature.length} chars)`);

      // Generate deterministic key from license signature (same algorithm as heartbeat)
      const crypto = require('crypto');
      const vpsKey = crypto
        .createHash('sha256')
        .update(licenseSignature)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();

      const vpsTrackingKey = `VPS-${vpsKey}`;
      console.log(`🔑 Generated deterministic VPS tracking key: ${vpsTrackingKey}`);
      
      return vpsTrackingKey;
    } catch (error) {
      console.error('❌ VPS tracking key extraction failed:', error);
      return null;
    }
  }

  /**
   * Check for software updates from VPS server
   */
  async checkForUpdates() {
    try {
      // Try to reload license if not available
      if (!this.licenseKey) {
        console.log('🔑 No license key - attempting reload...');
        await this.loadLicenseKey();
      }

      if (!this.licenseKey) {
        console.log('ℹ️ Skipping update check - no license key available');
        return null;
      }

      // Extract VPS tracking key from license (same as heartbeat service)
      const vpsTrackingKey = this.extractVPSTrackingKey(this.licenseKey);
      if (!vpsTrackingKey) {
        console.error('❌ Failed to extract VPS tracking key from license');
        return null;
      }

      const requestData = {
        licenseKey: vpsTrackingKey, // Use VPS tracking key, not raw license
        deviceFingerprint: this.deviceFingerprint,
        currentVersion: this.currentVersion,
        companyName: await this.getCompanyName(),
        adminEmail: await this.getAdminEmail()
      };

      console.log('🔍 Checking for software updates...');
      console.log('📤 Sending update check request:', {
        licenseKey: vpsTrackingKey,
        deviceFingerprint: this.deviceFingerprint.substring(0, 8) + '...',
        currentVersion: this.currentVersion
      });
      
      const response = await this.makeHttpRequest('/api/updates/check', 'POST', requestData);
      
      if (response && response.success) {
        this.lastUpdateCheck = new Date();
        this.updateAvailable = response.updateAvailable;
        this.latestVersionInfo = response.latestVersion;
        
        console.log(`✅ Update check completed:`, {
          current: response.currentVersion,
          latest: response.latestVersion?.version || 'none',
          updateAvailable: response.updateAvailable
        });
        
        if (response.updateAvailable) {
          console.log('🆕 New version available:', response.latestVersion.version);
          
          // Store update notification for admin dashboard
          await this.storeUpdateNotification(response.latestVersion);
        } else {
          console.log('✅ System is up to date - clearing old notifications');
          // Clear old notifications when system is up to date
          await this.clearOldUpdateNotifications();
        }
        
        return response;
      } else {
        console.error('❌ Update check failed:', response?.error || 'Unknown error');
        console.error('📥 Full VPS response:', JSON.stringify(response, null, 2));
        return null;
      }
      
    } catch (error) {
      console.error('❌ Update check error:', error);
      return null;
    }
  }

  /**
   * Get changelog for a specific version
   */
  async getChangelog(version) {
    try {
      if (!this.licenseKey) {
        return null;
      }

      const response = await this.makeHttpRequest(`/api/updates/changelog/${version}`, 'GET');
      
      if (response && response.success) {
        return response;
      } else {
        console.error('❌ Changelog fetch failed:', response?.error || 'Unknown error');
        return null;
      }
      
    } catch (error) {
      console.error('❌ Changelog fetch error:', error);
      return null;
    }
  }

  /**
   * Store update notification in database for admin dashboard
   */
  async storeUpdateNotification(versionInfo) {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      if (!db) {
        console.warn('⚠️ Database not available for update notification storage');
        return;
      }

      // Create update notifications table if it doesn't exist (dynamic approach)
      await new Promise((resolve, reject) => {
        db.run(`
          CREATE TABLE IF NOT EXISTS update_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            changelog TEXT,
            release_date DATETIME,
            security_update BOOLEAN DEFAULT 0,
            mandatory BOOLEAN DEFAULT 0,
            dismissed BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            console.error('❌ Failed to create update_notifications table:', err);
            reject(err);
          } else {
            console.log('✅ update_notifications table ready');
            resolve();
          }
        });
      });

      // Insert or update update notification
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT OR REPLACE INTO update_notifications 
          (version, changelog, release_date, security_update, mandatory, dismissed, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `, [
          versionInfo.version,
          versionInfo.changelog,
          versionInfo.releaseDate,
          versionInfo.securityUpdate ? 1 : 0,
          versionInfo.mandatory ? 1 : 0
        ], (err) => {
          if (err) {
            console.error('❌ Failed to store update notification:', err);
            reject(err);
          } else {
            console.log('📝 Update notification stored in database');
            resolve();
          }
        });
      });
      
    } catch (error) {
      console.error('❌ Failed to store update notification:', error);
    }
  }

  /**
   * Get pending update notifications for admin dashboard
   */
  async getPendingUpdateNotifications() {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      if (!db) {
        return [];
      }

      const notifications = await new Promise((resolve, reject) => {
        db.all(`
          SELECT * FROM update_notifications 
          WHERE dismissed = 0 
          ORDER BY created_at DESC
        `, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      
      return notifications;
      
    } catch (error) {
      console.error('❌ Failed to get update notifications:', error);
      return [];
    }
  }

  /**
   * Clear old update notifications when system is up to date
   */
  async clearOldUpdateNotifications() {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      if (!db) {
        return false;
      }

      await new Promise((resolve, reject) => {
        db.run(`
          UPDATE update_notifications 
          SET dismissed = 1, updated_at = CURRENT_TIMESTAMP
          WHERE dismissed = 0
        `, [], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log(`🧹 Cleared old update notifications - system is up to date`);
      return true;
      
    } catch (error) {
      console.error('❌ Failed to clear old update notifications:', error);
      return false;
    }
  }

  /**
   * Dismiss update notification
   */
  async dismissUpdateNotification(version) {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      if (!db) {
        return false;
      }

      await new Promise((resolve, reject) => {
        db.run(`
          UPDATE update_notifications 
          SET dismissed = 1 
          WHERE version = ?
        `, [version], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log(`✅ Update notification dismissed for version ${version}`);
      return true;
      
    } catch (error) {
      console.error('❌ Failed to dismiss update notification:', error);
      return false;
    }
  }

  /**
   * Start periodic update checking
   */
  startPeriodicUpdateCheck() {
    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkForUpdates();
    }, 30000);

    // Then check every 6 hours
    setInterval(() => {
      this.checkForUpdates();
    }, this.updateCheckInterval);
  }

  /**
   * Get company name for update tracking
   */
  async getCompanyName() {
    try {
      const emailConfigService = require('./emailConfigService');
      const config = await emailConfigService.getEmailConfig();
      return config?.company_name || 'PPE Management System';
    } catch (error) {
      return 'PPE Management System';
    }
  }

  /**
   * Get admin email for update tracking
   */
  async getAdminEmail() {
    try {
      const emailConfigService = require('./emailConfigService');
      const config = await emailConfigService.getEmailConfig();
      return config?.admin_email || config?.from_email || 'system@localhost';
    } catch (error) {
      return 'system@localhost';
    }
  }

  /**
   * Make HTTP request to VPS server
   */
  async makeHttpRequest(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const url = require('url');
      const http = require('http');
      const https = require('https');
      
      const fullUrl = `${this.vpsServerUrl}${endpoint}`;
      const parsedUrl = url.parse(fullUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        timeout: 10000 // 10 second timeout
      };
      
      if (data && method !== 'GET') {
        const postData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }
      
      const req = client.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(responseData);
            resolve(parsedData);
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (data && method !== 'GET') {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  /**
   * Get current update status
   */
  getUpdateStatus() {
    return {
      currentVersion: this.currentVersion,
      lastUpdateCheck: this.lastUpdateCheck,
      updateAvailable: this.updateAvailable,
      latestVersionInfo: this.latestVersionInfo,
      licenseKey: this.licenseKey ? 'loaded' : 'not_loaded'
    };
  }
}

module.exports = new UpdateCheckService();