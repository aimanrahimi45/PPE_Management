const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Use built-in fetch (Node.js 18+) or fallback to node-fetch
const fetch = globalThis.fetch || require('node-fetch');

class LicenseService {
  constructor() {
    // Enhanced secret key generation
    this.secretKey = process.env.LICENSE_SECRET || this.generateSystemSecret();
    this.algorithm = 'aes-256-gcm';
    this.licenseFileName = 'system.lic';
    
    // Bulletproof path resolution for any customer environment
    this.licensePath = this.resolveLicensePath();
    this.keyDerivationIterations = 100000; // PBKDF2 iterations
    
    // License validation cache to prevent excessive API calls
    this.validationCache = {
      result: null,
      timestamp: null,
      ttl: 30000, // 30 seconds cache TTL
      licenseFileModTime: null, // Track license file modification time
      dbLastModified: null // Track database changes
    };
  }

  /**
   * Cache license validation result to prevent excessive API calls
   * @param {Object} result - Validation result to cache
   * @returns {Object} The same result for chaining
   */
  async cacheValidationResult(result) {
    this.validationCache.result = result;
    this.validationCache.timestamp = Date.now();
    
    // Store current modification times for future comparison
    try {
      const fileStats = await fs.stat(this.licensePath);
      this.validationCache.licenseFileModTime = fileStats.mtime.getTime();
    } catch (err) {
      this.validationCache.licenseFileModTime = 0;
    }

    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      const dbLicense = await new Promise((resolve, reject) => {
        db.get(`SELECT updated_at FROM license_config WHERE id = 'current-license' ORDER BY updated_at DESC LIMIT 1`, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      this.validationCache.dbLastModified = dbLicense ? new Date(dbLicense.updated_at).getTime() : 0;
    } catch (err) {
      this.validationCache.dbLastModified = 0;
    }
    
    return result;
  }

  /**
   * Clear license validation cache (use when license/database changes)
   */
  clearValidationCache() {
    console.log('🗑️ Clearing license validation cache');
    this.validationCache.result = null;
    this.validationCache.timestamp = null;
    this.validationCache.licenseFileModTime = null;
    this.validationCache.dbLastModified = null;
  }

  /**
   * Check if cached validation is still valid by comparing file/database modification times
   * @returns {boolean} True if cache is still valid
   */
  async isCacheStillValid() {
    try {
      // Check license file modification time
      let currentFileModTime = null;
      try {
        const fileStats = await fs.stat(this.licensePath);
        currentFileModTime = fileStats.mtime.getTime();
      } catch (err) {
        // File doesn't exist or can't be accessed
        currentFileModTime = 0;
      }

      // Check database license modification time
      let currentDbModTime = null;
      try {
        const { getDb } = require('../database/init');
        const db = getDb();
        const dbLicense = await new Promise((resolve, reject) => {
          db.get(`SELECT updated_at FROM license_config WHERE id = 'current-license' ORDER BY updated_at DESC LIMIT 1`, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        currentDbModTime = dbLicense ? new Date(dbLicense.updated_at).getTime() : 0;
      } catch (err) {
        currentDbModTime = 0;
      }

      // Compare with cached modification times
      const fileChanged = this.validationCache.licenseFileModTime !== currentFileModTime;
      const dbChanged = this.validationCache.dbLastModified !== currentDbModTime;

      if (fileChanged || dbChanged) {
        console.log(`🔍 Detected changes - File: ${fileChanged}, DB: ${dbChanged}`);
        // Update cached modification times for next comparison
        this.validationCache.licenseFileModTime = currentFileModTime;
        this.validationCache.dbLastModified = currentDbModTime;
        return false; // Cache is invalid
      }

      return true; // Cache is still valid
    } catch (error) {
      console.error('Error checking cache validity:', error);
      return false; // Assume cache is invalid on error
    }
  }

  /**
   * Resolve license file path safely for any deployment environment
   * @returns {string} Absolute path to license file
   */
  resolveLicensePath() {
    // Try multiple possible locations in order of preference
    const possiblePaths = [
      // 1. Environment variable override (highest priority)
      process.env.PPE_LICENSE_PATH,
      
      // 2. Project root relative to this service file
      path.resolve(__dirname, '..', '..', this.licenseFileName),
      
      // 3. Backend directory relative to this service file  
      path.resolve(__dirname, '..', this.licenseFileName),
      
      // 4. Current working directory (fallback)
      path.resolve(process.cwd(), this.licenseFileName),
      
      // 5. System-specific locations
      process.platform === 'win32' 
        ? path.resolve(process.env.PROGRAMDATA || 'C:\\ProgramData', 'PPE-Management', this.licenseFileName)
        : path.resolve('/etc/ppe-management', this.licenseFileName)
    ].filter(Boolean); // Remove null/undefined values
    
    // Return the first valid path, or default to project root
    return possiblePaths[0]; // Use first available path after filtering nulls
  }

  /**
   * Resolve database path safely for any deployment environment
   * @returns {string} Absolute path to database file
   */
  resolveDatabasePath() {
    // Try multiple possible locations in order of preference
    const possiblePaths = [
      // 1. Environment variable override (highest priority)
      process.env.PPE_DATABASE_PATH,
      
      // 2. Standard backend/database location
      path.resolve(__dirname, '..', 'database', 'ppe_management.db'),
      
      // 3. Alternative database location (current structure)
      path.resolve(__dirname, 'database', 'ppe_management.db'),
      
      // 4. Current working directory fallback
      path.resolve(process.cwd(), 'database', 'ppe_management.db'),
      
      // 5. System-specific locations
      process.platform === 'win32'
        ? path.resolve(process.env.PROGRAMDATA || 'C:\\ProgramData', 'PPE-Management', 'ppe_management.db')
        : path.resolve('/var/lib/ppe-management', 'ppe_management.db')
    ].filter(Boolean);
    
    return possiblePaths[0]; // Use the first valid path (after filtering nulls)
  }

  /**
   * Generate system-specific secret key
   * @returns {string}
   */
  generateSystemSecret() {
    const systemInfo = os.platform() + os.arch() + os.hostname();
    return crypto.createHash('sha256').update(systemInfo + 'PPE-LICENSE-2024').digest('hex');
  }

  /**
   * Get system fingerprint for hardware binding
   * @returns {string}
   */
  getSystemFingerprint() {
    const networkInterfaces = os.networkInterfaces();
    const macAddresses = [];
    
    // Extract MAC addresses
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const networkInterface of interfaces) {
        if (!networkInterface.internal && networkInterface.mac !== '00:00:00:00:00:00') {
          macAddresses.push(networkInterface.mac);
        }
      }
    }
    
    // Create fingerprint from system info
    const systemData = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      macAddresses: macAddresses.sort(), // Sort for consistency
      cpus: os.cpus().length
    };
    
    return crypto.createHash('sha256').update(JSON.stringify(systemData)).digest('hex');
  }

  /**
   * Generate a secure license file with hardware binding
   * @param {Object} licenseData - License information
   * @returns {string} Encrypted and signed license
   */
  generateLicense(licenseData) {
    const {
      clientName,
      clientId,
      subscriptionTier,
      features,
      expirationDate,
      maxEmployees,
      generatedDate = new Date().toISOString(),
      version = '2.0'
    } = licenseData;

    // Generate unique installation ID
    const installationId = crypto.randomBytes(16).toString('hex');
    
    // Create enhanced payload with security features
    const payload = {
      client_name: clientName,
      client_id: clientId,
      subscription_tier: subscriptionTier,
      features: features,
      expiration_date: expirationDate,
      max_employees: maxEmployees,
      generated_date: generatedDate,
      version: version,
      installation_id: installationId,
      system_fingerprint: null, // Will be set during activation
      security_hash: crypto.randomBytes(32).toString('hex'),
      checksum: this.generateChecksum(clientName, clientId, subscriptionTier, expirationDate, installationId)
    };

    // Use proper AES encryption instead of Base64
    const encrypted = this.encryptPayload(JSON.stringify(payload));
    
    // Sign the encrypted data
    const signature = this.signData(encrypted);
    
    // Return format: VERSION:SIGNATURE:ENCRYPTED_DATA
    return `v2:${signature}:${encrypted}`;
  }

  /**
   * Encrypt payload using AES-256-CBC with HMAC
   * @param {string} data - Data to encrypt
   * @returns {string} Encrypted data with IV and HMAC
   */
  encryptPayload(data) {
    // Generate random IV
    const iv = crypto.randomBytes(16);
    
    // Create cipher with proper key derivation
    const key = crypto.scryptSync(this.secretKey, 'ppe-license-salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    // Encrypt data
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Generate HMAC for authentication
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(iv.toString('hex') + encrypted);
    const authTag = hmac.digest('hex');
    
    // Return IV|AuthTag|EncryptedData (using | to avoid colon conflicts)
    return `${iv.toString('hex')}|${authTag}|${encrypted}`;
  }

  /**
   * Decrypt payload using AES-256-CBC with HMAC verification
   * @param {string} encryptedData - Encrypted data string
   * @returns {string} Decrypted data
   */
  decryptPayload(encryptedData) {
    const parts = encryptedData.split('|');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivHex, authTag, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    
    // Verify HMAC authentication
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(ivHex + encrypted);
    const expectedAuthTag = hmac.digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(authTag, 'hex'), Buffer.from(expectedAuthTag, 'hex'))) {
      throw new Error('Authentication failed - license may be tampered');
    }
    
    // Create decipher with proper key derivation
    const key = crypto.scryptSync(this.secretKey, 'ppe-license-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // Decrypt data
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Validate license with enhanced security and hardware binding
   * @param {string} licenseContent - Optional license content to validate directly
   * @returns {Object} License information or null if invalid
   */
  async validateLicense(licenseContent = null) {
    try {
      let content;
      
      if (licenseContent) {
        console.log('🔍 Using provided license content for validation');
        content = licenseContent;
      } else {
        // First try to load from database (primary storage)
        console.log('🔍 Attempting to load license from database...');
        content = await this.loadLicenseFromDatabase();
        
        // If not in database, try file system (fallback)
        if (!content) {
          console.log('⚠️ No license found in database, checking file system...');
          const licenseExists = await this.checkLicenseFile();
          if (!licenseExists) {
            console.log('❌ No license file found on file system');
            return { valid: false, error: 'No valid license found - all features disabled' };
          }
          console.log('📄 Loading license from file system...');
          content = await fs.readFile(this.licensePath, 'utf8');
        }
      }
      
      if (!content || content.trim() === '') {
        console.log('❌ License content is empty');
        return { valid: false, error: 'License content is empty - please activate license' };
      }
      
      console.log(`🔍 License format detected: ${content.substring(0, 10)}...`);
      
      // Check if it's new secure format (v2) or legacy format
      if (content.startsWith('v2:') || content.startsWith('v2|')) {
        console.log('🔐 Validating v2 secure license format...');
        const result = await this.validateSecureLicense(content);
        console.log(`🔍 validateSecureLicense returned:`, { valid: result.valid, error: result.error || 'none', client_name: result.client_name || 'none' });
        return result;
      } else {
        console.log('📜 Validating legacy license format...');
        // Legacy Base64 format - still support but warn
        const result = await this.validateLegacyLicense(content);
        console.log(`🔍 validateLegacyLicense returned:`, { valid: result.valid, error: result.error || 'none', client_name: result.client_name || 'none' });
        return result;
      }

    } catch (error) {
      console.error('❌ License validation error:', error);
      return { valid: false, error: 'License validation failed - system error' };
    }
  }

  /**
   * Get trusted time from multiple sources with grace period tracking
   * @returns {Promise<{time: Date, trusted: boolean, gracePeriodRemaining: number, suspended: boolean}>} 
   */
  async getTrustedTime() {
    const timeSources = [
      'https://api.github.com',
      'https://httpbin.org/json',
      'https://jsonplaceholder.typicode.com/posts/1'
    ];

    // Check grace period status from database
    const graceStatus = await this.checkGracePeriodStatus();

    for (const source of timeSources) {
      try {
        console.log(`🌐 Trying time source: ${source.split('/')[2]}...`);
        
        // Use Promise.race for timeout (more reliable)
        const fetchPromise = fetch(source, {
          headers: {
            'User-Agent': 'PPE-Management-License-System/2.0'
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        );
        
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Use HTTP Date header as trusted time source (more reliable than API-specific JSON)
        const dateHeader = response.headers.get('date');
        if (!dateHeader) {
          throw new Error('No Date header found in response');
        }
        
        // Parse HTTP Date header (RFC 7231 format - always in GMT/UTC)
        const trustedTime = new Date(dateHeader);
        
        console.log(`📊 Time from ${source.split('/')[2]}: HTTP Date="${dateHeader}", Parsed="${trustedTime.toISOString()}"`);        
        
        if (trustedTime && !isNaN(trustedTime.getTime())) {
          console.log(`✅ Got trusted time from ${source.split('/')[2]}: ${trustedTime.toISOString()}`);
          
          // Reset grace period on successful time fetch
          await this.resetGracePeriod();
          
          return {
            time: trustedTime,
            trusted: true,
            gracePeriodRemaining: 7,
            suspended: false,
            source: source.split('/')[2]
          };
        }
      } catch (error) {
        console.log(`⚠️  Time source ${source.split('/')[2]} failed: ${error.message}`);
      }
    }
    
    // All time sources failed - handle grace period
    const gracePeriodResult = await this.handleOfflineGracePeriod(graceStatus);
    
    if (gracePeriodResult.suspended) {
      console.log('🚨 LICENSE SUSPENDED: No internet time verification for 7+ days');
      return {
        time: new Date(),
        trusted: false,
        gracePeriodRemaining: 0,
        suspended: true,
        error: 'License suspended due to lack of internet time verification'
      };
    }
    
    console.log(`⚠️  All time sources failed, using system time (Grace period: ${gracePeriodResult.daysRemaining} days remaining)`);
    return {
      time: new Date(),
      trusted: false,
      gracePeriodRemaining: gracePeriodResult.daysRemaining,
      suspended: false
    };
  }

  /**
   * Check grace period status from database
   * @returns {Promise<Object>} Grace period status
   */
  async checkGracePeriodStatus() {
    try {
      const db = await this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM time_verification_grace 
          WHERE id = 'grace_period' 
          ORDER BY created_at DESC 
          LIMIT 1
        `, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (!row) {
            // First time - create initial record
            resolve({
              firstOfflineDate: null,
              lastSuccessfulVerification: new Date().toISOString(),
              consecutiveFailureDays: 0,
              suspended: false
            });
          } else {
            resolve({
              firstOfflineDate: row.first_offline_date,
              lastSuccessfulVerification: row.last_successful_verification,
              consecutiveFailureDays: row.consecutive_failure_days,
              suspended: row.suspended === 1
            });
          }
        });
      });
    } catch (error) {
      console.error('Error checking grace period status:', error);
      return {
        firstOfflineDate: null,
        lastSuccessfulVerification: new Date().toISOString(),
        consecutiveFailureDays: 0,
        suspended: false
      };
    }
  }

  /**
   * Handle offline grace period logic
   * @param {Object} graceStatus Current grace status
   * @returns {Promise<Object>} Updated grace period result
   */
  async handleOfflineGracePeriod(graceStatus) {
    const now = new Date();
    const maxGraceDays = 7;
    
    let firstOfflineDate = graceStatus.firstOfflineDate ? new Date(graceStatus.firstOfflineDate) : now;
    let consecutiveFailureDays = graceStatus.consecutiveFailureDays;
    
    // If this is the first offline day, record it
    if (!graceStatus.firstOfflineDate) {
      firstOfflineDate = now;
      consecutiveFailureDays = 0;
    }
    
    // Calculate days since first offline
    const daysSinceFirstOffline = Math.floor((now - firstOfflineDate) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, maxGraceDays - daysSinceFirstOffline);
    const suspended = daysSinceFirstOffline >= maxGraceDays;
    
    // Update database record
    await this.updateGracePeriodStatus({
      firstOfflineDate: firstOfflineDate.toISOString(),
      lastAttempt: now.toISOString(),
      consecutiveFailureDays: daysSinceFirstOffline,
      suspended: suspended
    });
    
    return {
      daysRemaining,
      suspended,
      daysSinceFirstOffline
    };
  }

  /**
   * Reset grace period on successful time verification
   */
  async resetGracePeriod() {
    try {
      const db = await this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.run(`
          INSERT OR REPLACE INTO time_verification_grace (
            id, first_offline_date, last_successful_verification, 
            consecutive_failure_days, suspended, updated_at
          ) VALUES (?, NULL, ?, 0, 0, CURRENT_TIMESTAMP)
        `, ['grace_period', new Date().toISOString()], (err) => {
          if (err) {
            console.error('Error resetting grace period:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Error in resetGracePeriod:', error);
    }
  }

  /**
   * Update grace period status in database
   * @param {Object} status Grace period status to update
   */
  async updateGracePeriodStatus(status) {
    try {
      const db = await this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.run(`
          INSERT OR REPLACE INTO time_verification_grace (
            id, first_offline_date, last_successful_verification, 
            consecutive_failure_days, suspended, last_attempt, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          'grace_period',
          status.firstOfflineDate,
          status.lastSuccessfulVerification || new Date().toISOString(),
          status.consecutiveFailureDays,
          status.suspended ? 1 : 0,
          status.lastAttempt
        ], (err) => {
          if (err) {
            console.error('Error updating grace period status:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Error in updateGracePeriodStatus:', error);
    }
  }

  /**
   * Get database connection
   * @returns {Promise<Object>} Database connection
   */
  async getDatabaseConnection() {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = this.resolveDatabasePath();
    
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('❌ License service database connection error:', err);
          reject(err);
        } else {
          resolve(db);
        }
      });
    });
  }

  /**
   * Get dynamic timezone information for the deployment environment
   * @returns {Object} Timezone information
   */
  getTimezoneInfo() {
    const now = new Date();
    
    // Get system timezone information
    const timezoneOffset = now.getTimezoneOffset(); // Minutes from UTC (negative for ahead of UTC)
    const timezoneOffsetHours = timezoneOffset / -60; // Convert to hours (positive for ahead of UTC)
    
    // Try to get timezone name using Intl API (more reliable)
    let timezoneName = 'Unknown';
    let timezoneCity = 'Unknown';
    
    try {
      // Get timezone name using Intl API
      timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
      timezoneCity = timezoneName.split('/').pop() || timezoneName;
      
      // Common timezone mappings for better identification
      const timezoneMap = {
        'Asia/Kuala_Lumpur': 'Malaysia (UTC+8)',
        'Asia/Singapore': 'Singapore (UTC+8)', 
        'Asia/Tokyo': 'Japan (UTC+9)',
        'Asia/Seoul': 'South Korea (UTC+9)',
        'Asia/Bangkok': 'Thailand (UTC+7)',
        'Asia/Jakarta': 'Indonesia (UTC+7)',
        'Asia/Manila': 'Philippines (UTC+8)',
        'Asia/Hong_Kong': 'Hong Kong (UTC+8)',
        'Europe/London': 'UK (UTC+0/+1)',
        'America/New_York': 'US East (UTC-5/-4)',
        'America/Los_Angeles': 'US West (UTC-8/-7)'
      };
      
      if (timezoneMap[timezoneName]) {
        timezoneCity = timezoneMap[timezoneName];
      }
      
    } catch (e) {
      // Fallback for older Node.js versions or systems without Intl support
      console.log('⚠️ Intl.DateTimeFormat not available, using offset detection');
      
      // Timezone detection based on common offsets
      const offsetMap = {
        8: 'Southeast Asia (UTC+8) - Malaysia/Singapore/Philippines',
        9: 'East Asia (UTC+9) - Japan/South Korea',
        7: 'Southeast Asia (UTC+7) - Thailand/Indonesia',
        0: 'UTC/GMT (UTC+0) - UK',
        '-5': 'US East Coast (UTC-5)',
        '-8': 'US West Coast (UTC-8)'
      };
      
      timezoneCity = offsetMap[timezoneOffsetHours] || `UTC${timezoneOffsetHours >= 0 ? '+' : ''}${timezoneOffsetHours}`;
    }
    
    return {
      name: timezoneName,
      city: timezoneCity,
      offsetMinutes: timezoneOffset,
      offsetHours: timezoneOffsetHours,
      offsetString: `UTC${timezoneOffsetHours >= 0 ? '+' : ''}${timezoneOffsetHours}`
    };
  }

  /**
   * Get business timezone from admin user settings
   * @returns {Promise<Object>} Business timezone information
   */
  async getBusinessTimezone() {
    try {
      const db = await this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.get(`
          SELECT business_timezone, timezone_auto_detected, name
          FROM users 
          WHERE role = 'ADMIN' AND business_timezone IS NOT NULL
          ORDER BY setup_completed_at DESC 
          LIMIT 1
        `, (err, row) => {
          if (err) {
            // Check if error is due to missing column (during database initialization)
            if (err.message.includes('no such column') || 
                err.message.includes('business_timezone') || 
                err.message.includes('timezone_auto_detected') ||
                err.code === 'SQLITE_ERROR') {
              console.log('ℹ️ Timezone columns not yet available (database initializing), using system timezone detection');
              console.log(`   Database error: ${err.message}`);
              resolve(null);
            } else {
              console.error('❌ Error getting business timezone:', err);
              resolve(null);
            }
          } else if (row && row.business_timezone) {
            console.log(`🏢 Business timezone: ${row.business_timezone} (Admin: ${row.name})`);
            resolve({
              timezone: row.business_timezone,
              autoDetected: row.timezone_auto_detected === 1,
              adminName: row.name
            });
          } else {
            console.log('⚠️ No business timezone configured, using system detection');
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.error('❌ Database error getting business timezone:', error);
      return null;
    }
  }

  /**
   * Detect suspicious time manipulation with business timezone awareness
   * @param {Date} trustedTime - Time from trusted source (UTC)
   * @returns {Object} Manipulation detection result
   */
  async detectTimeManipulation(trustedTime) {
    const systemTime = new Date();
    
    // Get business timezone from database
    const businessTimezone = await this.getBusinessTimezone();
    const systemTimezoneInfo = this.getTimezoneInfo();
    
    // Both times are compared in UTC milliseconds (JavaScript handles this automatically)
    const systemUTC = systemTime;
    const trustedUTC = trustedTime;
    
    // Calculate actual time difference
    const timeDiff = Math.abs(trustedUTC.getTime() - systemUTC.getTime());
    const diffMinutes = Math.round(timeDiff / 60000);
    
    // Display timezone information
    if (businessTimezone) {
      console.log(`🏢 Business Timezone: ${businessTimezone.timezone} (Set by: ${businessTimezone.adminName})`);
      console.log(`🖥️ System Timezone: ${systemTimezoneInfo.city} (${systemTimezoneInfo.offsetString})`);
    } else {
      console.log(`🌍 Using System Timezone: ${systemTimezoneInfo.city} (${systemTimezoneInfo.offsetString})`);
    }
    
    console.log(`🕐 Time Check: System UTC: ${systemUTC.toISOString()}, Trusted UTC: ${trustedUTC.toISOString()}`);
    console.log(`⏰ Time Difference: ${diffMinutes} minutes`);
    
    // Dynamic tolerance based on business configuration
    const baseTolerance = 15 * 60 * 1000; // 15 minutes base tolerance
    const businessTolerance = 3 * 60 * 60 * 1000; // 3 hours for business deployment (increased for global business)
    
    // Check for reasonable time drift first
    if (timeDiff <= baseTolerance) {
      console.log(`✅ Time validation passed: ${diffMinutes} minutes (within 15min tolerance)`);
      return {
        manipulated: false,
        businessTimezone: businessTimezone,
        systemTimezone: systemTimezoneInfo,
        difference: diffMinutes + ' minutes',
        note: 'Time validation successful'
      };
    }
    
    // Check for acceptable business deployment tolerance
    if (timeDiff <= businessTolerance) {
      const timezoneContext = businessTimezone ? 
        `business deployment (${businessTimezone.timezone})` : 
        `system deployment (${systemTimezoneInfo.city})`;
      
      console.log(`⚠️ Time drift detected but within business tolerance: ${diffMinutes} minutes`);
      console.log(`✅ Acceptable for ${timezoneContext}`);
      return {
        manipulated: false,
        businessTimezone: businessTimezone,
        systemTimezone: systemTimezoneInfo,
        difference: diffMinutes + ' minutes',
        note: `Time drift acceptable for ${timezoneContext}`
      };
    }
    
    // Beyond acceptable tolerance - possible manipulation
    console.log(`❌ Excessive time drift detected: ${diffMinutes} minutes`);
    console.log(`🚨 Exceeds business deployment tolerance (3 hours)`);
    
    return {
      manipulated: true,
      businessTimezone: businessTimezone,
      systemTimezone: systemTimezoneInfo,
      systemTime: systemUTC.toISOString(),
      trustedTime: trustedUTC.toISOString(),
      difference: diffMinutes + ' minutes',
      note: `Excessive time drift detected - possible manipulation`
    };
  }

  /**
   * Validate secure license with hardware binding and trusted time
   * @param {string} licenseContent - License content to validate
   * @returns {Object} Validation result
   */
  async validateSecureLicense(licenseContent) {
    try {
      // Parse license format: VERSION:SIGNATURE:ENCRYPTED_DATA (prefer : over |)
      const delimiter = licenseContent.includes(':') ? ':' : '|';
      let parts;
      
      if (delimiter === ':') {
        // For colon format, only split on first two colons to handle colons in encrypted data
        const firstColon = licenseContent.indexOf(':');
        const secondColon = licenseContent.indexOf(':', firstColon + 1);
        
        if (firstColon === -1 || secondColon === -1) {
          return { valid: false, error: 'Invalid license format' };
        }
        
        parts = [
          licenseContent.substring(0, firstColon),
          licenseContent.substring(firstColon + 1, secondColon),
          licenseContent.substring(secondColon + 1)
        ];
      } else {
        // Fallback to pipe delimiter
        parts = licenseContent.trim().split(delimiter);
        if (parts.length !== 3) {
          return { valid: false, error: 'Invalid license format' };
        }
      }
      
      const [version, signature, encryptedData] = parts;
      
      // Check version
      if (version !== 'v2') {
        return { valid: false, error: 'Unsupported license version' };
      }
      
      // Verify signature
      if (!this.verifySignature(encryptedData, signature)) {
        return { valid: false, error: 'License signature verification failed - possible tampering' };
      }
      
      // Decrypt payload
      let payload;
      try {
        const decryptedData = this.decryptPayload(encryptedData);
        payload = JSON.parse(decryptedData);
      } catch (e) {
        return { valid: false, error: 'License decryption failed - corrupted or invalid' };
      }
      
      // Validate payload structure
      if (!payload.client_name || !payload.subscription_tier || !payload.features) {
        return { valid: false, error: 'Invalid license payload structure' };
      }
      
      // Check expiration with trusted time
      const expirationDate = new Date(payload.expiration_date);
      const trustedTimeResult = await this.getTrustedTime();
      
      // Check if license is suspended due to grace period expiration
      if (trustedTimeResult.suspended) {
        return {
          valid: false,
          error: 'License suspended: No internet time verification for 7+ days. Please ensure internet connectivity for time verification.',
          grace_period_expired: true,
          days_offline: 7,
          requires_online_verification: true
        };
      }
      
      // Use the time from the result
      const trustedTime = trustedTimeResult.time;
      
      // Detect time manipulation if we have trusted time
      if (trustedTimeResult.trusted) {
        const timeCheck = await this.detectTimeManipulation(trustedTime);
        if (timeCheck.manipulated) {
          return {
            valid: false,
            error: `Suspicious system clock detected. System time differs from trusted time by ${timeCheck.difference}`,
            time_manipulation_detected: true,
            system_time: timeCheck.systemTime,
            trusted_time: timeCheck.trustedTime
          };
        }
      }
      
      if (expirationDate < trustedTime) {
        return { 
          valid: false, 
          error: 'License expired (verified with trusted time source)',
          expiration_date: payload.expiration_date,
          trusted_time_used: trustedTimeResult.trusted,
          grace_period_remaining: trustedTimeResult.gracePeriodRemaining
        };
      }
      
      // License activation tracking (replaces hardware binding)
      console.log(`🔍 Checking license activation for installation_id: ${payload.installation_id}`);
      const activationCheck = await this.checkLicenseActivation(payload.installation_id, licenseContent);
      console.log(`🔍 Activation check result:`, activationCheck);
      console.log(`🔍 Activation details: isActivated=${activationCheck.isActivated}, isCurrentSystem=${activationCheck.isCurrentSystem}`);
      
      if (activationCheck.isActivated && !activationCheck.isCurrentSystem) {
        console.log(`❌ License blocked: Already activated on different system`);
        return { 
          valid: false, 
          error: 'License key is already activated on another system. Each license can only be used once.' 
        };
      }
      console.log(`✅ Activation check passed - proceeding with license validation`);
      
      // First activation or license replacement - track this system
      if (!activationCheck.isActivated) {
        console.log(`🔄 Activating license for: ${payload.client_name}`);
        await this.activateLicense(payload.installation_id, payload.client_name, licenseContent);
        console.log(`✅ License activated for: ${payload.client_name}`);
      } else {
        console.log(`✅ License already activated on this system: ${payload.client_name}`);
      }

      // Anti-tampering: Check last validation timestamp  
      console.log(`🔍 Checking for time jumps...`);
      const timeJumpCheck = await this.checkTimeJump(trustedTime);
      console.log(`🔍 Time jump check result:`, timeJumpCheck);
      if (timeJumpCheck.suspicious) {
        console.log(`❌ Time jump detected - blocking license`);
        return {
          valid: false,
          error: `Suspicious time jump detected: ${timeJumpCheck.message}`,
          time_jump_detected: true,
          last_validation: timeJumpCheck.lastValidation,
          current_time: trustedTime.toISOString()
        };
      }
      console.log(`✅ Time jump check passed`);
      
      // Return validated license
      console.log(`🎉 LICENSE VALIDATION SUCCESSFUL - Returning valid license for: ${payload.client_name}`);
      console.log(`🎯 License tier: ${payload.subscription_tier}, Features: ${payload.features.length}, Days remaining: ${Math.ceil((expirationDate - trustedTime) / (1000 * 60 * 60 * 24))}`);
      return {
        valid: true,
        client_name: payload.client_name,
        client_id: payload.client_id,
        subscription_tier: payload.subscription_tier,
        features: payload.features,
        expiration_date: payload.expiration_date,
        max_employees: payload.max_employees,
        installation_id: payload.installation_id,
        activation_status: 'activated',
        days_remaining: Math.ceil((expirationDate - trustedTime) / (1000 * 60 * 60 * 24)),
        security_level: 'high',
        trusted_time_used: trustedTimeResult.trusted,
        grace_period_remaining: trustedTimeResult.gracePeriodRemaining,
        grace_period_active: !trustedTimeResult.trusted && !trustedTimeResult.suspended
      };
      
    } catch (error) {
      console.error('Secure license validation error:', error);
      return { valid: false, error: 'License validation failed - system error' };
    }
  }

  /**
   * Validate legacy Base64 license (backward compatibility)
   * @param {string} content - Legacy license content
   * @returns {Object} Validation result
   */
  async validateLegacyLicense(content) {
    try {
      // Parse the base64 encoded JSON payload
      let payload;
      try {
        payload = JSON.parse(Buffer.from(content, 'base64').toString());
      } catch (e) {
        return { valid: false, error: 'License file corrupted or invalid format' };
      }

      // Basic validation
      if (!payload.client_name || !payload.subscription_tier || !payload.features) {
        return { valid: false, error: 'Invalid license format' };
      }

      // Check expiration
      const expirationDate = new Date(payload.expiration_date);
      const now = new Date();
      
      if (expirationDate < now) {
        return { 
          valid: false, 
          error: 'License expired',
          expiration_date: payload.expiration_date 
        };
      }

      // Return valid license with security warning
      return {
        valid: true,
        client_name: payload.client_name,
        client_id: payload.client_id,
        subscription_tier: payload.subscription_tier,
        features: payload.features,
        expiration_date: payload.expiration_date,
        max_employees: payload.max_employees,
        generated_date: payload.generated_date,
        days_remaining: Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24)),
        security_level: 'legacy_low',
        security_warning: 'This license uses legacy security. Consider upgrading to secure license format.'
      };

    } catch (error) {
      console.error('Legacy license validation error:', error);
      return { valid: false, error: 'License file corrupted or invalid' };
    }
  }

  /**
   * Check for suspicious time jumps (anti-manipulation)
   * @param {Date} currentTime - Current time to validate
   * @returns {Object} Time jump analysis
   */
  async checkTimeJump(currentTime) {
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve) => {
      // Get last validation timestamp
      db.get(`
        SELECT last_validation_time, validation_count 
        FROM license_config 
        WHERE id = 'current-license'
      `, [], (err, row) => {
        if (err || !row || !row.last_validation_time) {
          // First validation - store current time
          this.updateLastValidation(currentTime);
          resolve({ suspicious: false, message: 'First validation' });
          return;
        }
        
        const lastValidation = new Date(row.last_validation_time);
        const timeDiff = currentTime.getTime() - lastValidation.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        
        // Detect suspicious backward time jumps
        if (timeDiff < -3600000) { // More than 1 hour backward
          resolve({
            suspicious: true,
            message: `Time moved backward by ${Math.abs(Math.round(hoursDiff))} hours`,
            lastValidation: lastValidation.toISOString(),
            timeDiff: hoursDiff
          });
          return;
        }
        
        // Detect unrealistic forward jumps (more than 30 days)
        if (timeDiff > 30 * 24 * 60 * 60 * 1000) {
          resolve({
            suspicious: true, 
            message: `Unrealistic time jump forward by ${Math.round(hoursDiff / 24)} days`,
            lastValidation: lastValidation.toISOString(),
            timeDiff: hoursDiff
          });
          return;
        }
        
        // Update last validation time
        this.updateLastValidation(currentTime);
        resolve({ suspicious: false, message: 'Normal time progression' });
      });
    });
  }

  /**
   * Update last validation timestamp
   * @param {Date} validationTime - Time of validation
   */
  async updateLastValidation(validationTime) {
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve) => {
      db.run(`
        UPDATE license_config 
        SET last_validation_time = ?, validation_count = COALESCE(validation_count, 0) + 1
        WHERE id = 'current-license'
      `, [validationTime.toISOString()], () => resolve());
    });
  }

  /**
   * Check if THIS SPECIFIC license is already activated (replaces hardware binding)
   * @param {string} installationId - Installation ID from current license
   * @param {string} licenseKey - The specific license key being validated
   * @returns {Object} Activation status
   */
  async checkLicenseActivation(installationId, licenseKey) {
    const { getDb } = require('../database/init');
    const db = getDb();
    
    console.log(`🔍 checkLicenseActivation called with installationId: ${installationId}`);
    console.log(`🔍 licenseKey: ${licenseKey.substring(0, 20)}...`);
    
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT installation_id, client_name, license_key 
        FROM license_config 
        WHERE id = 'current-license'
      `, (err, row) => {
        if (err) {
          console.log(`❌ Database error in checkLicenseActivation:`, err);
          reject(err);
        } else {
          console.log(`🔍 Database row found:`, row ? {
            installation_id: row.installation_id,
            client_name: row.client_name,
            license_key: row.license_key ? `${row.license_key.substring(0, 20)}...` : 'null'
          } : 'No row');
          
          if (!row || !row.license_key) {
            // No license activated yet
            console.log(`📝 No license activated yet - allowing activation`);
            resolve({ isActivated: false, isCurrentSystem: false });
          } else if (row.license_key === licenseKey) {
            // Same license key - check installation ID
            if (row.installation_id === installationId) {
              // Same license, same installation ID - valid
              console.log(`✅ Same license, same installation - allowing`);
              resolve({ isActivated: true, isCurrentSystem: true, clientName: row.client_name });
            } else {
              // Same license, different installation ID - moved to different system
              console.log(`❌ Same license, different installation - blocking`);
              resolve({ isActivated: true, isCurrentSystem: false, clientName: row.client_name });
            }
          } else {
            // Different license key - allow activation (replace old license)
            console.log('🔄 Different license key - replacing existing license with new one');
            resolve({ isActivated: false, isCurrentSystem: false });
          }
        }
      });
    });
  }

  /**
   * Activate license on this system (replaces hardware binding)
   * @param {string} installationId - Installation ID from license
   * @param {string} clientName - Client name from license
   * @param {string} licenseKey - The license key being activated
   */
  async activateLicense(installationId, clientName, licenseKey) {
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO license_config 
        (id, installation_id, client_name, license_key, status, created_at, updated_at)
        VALUES ('current-license', ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [installationId, clientName, licenseKey], (err) => {
        if (err) reject(err);
        else {
          console.log(`🔐 License activated: ${clientName} (${installationId})`);
          resolve();
        }
      });
    });
  }

  /**
   * Load license from database (primary storage)
   * @returns {string|null} License content or null if not found
   */
  async loadLicenseFromDatabase() {
    try {
      const db = await this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.get(`
          SELECT license_key, status, client_name FROM license_config 
          WHERE id = 'current-license'
        `, (err, row) => {
          if (err) {
            // Check if error is due to missing column (during database initialization)
            if (err.message.includes('no such column') || 
                err.message.includes('client_name') ||
                err.code === 'SQLITE_ERROR') {
              console.log('ℹ️ License config columns not yet available (database initializing), checking without client_name');
              // Retry without client_name column
              db.get(`
                SELECT license_key, status FROM license_config 
                WHERE id = 'current-license'
              `, (err2, row2) => {
                if (err2) {
                  console.error('❌ Database license lookup error (fallback):', err2);
                  resolve(null);
                } else if (row2) {
                  console.log(`📋 License found in database: Status=${row2.status || 'Unknown'}`);
                  if (row2.status === 'active' && row2.license_key) {
                    console.log('✅ Active license loaded from database (fallback)');
                    resolve(row2.license_key);
                  } else if (row2.license_key && row2.status !== 'active') {
                    console.log(`⚠️ License found but status is '${row2.status}' (not active) (fallback) - license deactivated`);
                    resolve(null);
                  } else {
                    console.log('❌ License record exists but no license_key found (fallback)');
                    resolve(null);
                  }
                } else {
                  console.log('⚠️ No license record found in database (fallback)');
                  resolve(null);
                }
              });
            } else {
              console.error('❌ Database license lookup error:', err);
              resolve(null);
            }
          } else if (row) {
            console.log(`📋 License found in database: Client=${row.client_name || 'Unknown'}, Status=${row.status || 'Unknown'}`);
            if (row.status === 'active' && row.license_key) {
              console.log('✅ Active license loaded from database');
              resolve(row.license_key);
            } else if (row.license_key && row.status !== 'active') {
              console.log(`⚠️ License found but status is '${row.status}' (not active) - license deactivated`);
              resolve(null); // Don't return inactive licenses
            } else {
              console.log('❌ License record exists but no license_key found');
              resolve(null);
            }
          } else {
            console.log('⚠️ No license record found in database');
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.error('Error loading license from database:', error);
      return null;
    }
  }

  /**
   * Check if license file exists
   * @returns {boolean}
   */
  async checkLicenseFile() {
    try {
      await fs.access(this.licensePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save license file
   * @param {string} licenseContent - Encrypted license content
   */
  async saveLicense(licenseContent) {
    await fs.writeFile(this.licensePath, licenseContent, 'utf8');
    // Clear cache when license is updated
    this.clearValidationCache();
  }

  /**
   * Generate enhanced checksum for license validation
   * @param {string} clientName
   * @param {string} clientId  
   * @param {string} tier
   * @param {string} expiration
   * @param {string} installationId
   * @returns {string}
   */
  generateChecksum(clientName, clientId, tier, expiration, installationId = '') {
    const data = `${clientName}|${clientId}|${tier}|${expiration}|${installationId}`;
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  /**
   * Sign data with HMAC-SHA512
   * @param {string} data - Data to sign
   * @returns {string} Signature
   */
  signData(data) {
    return crypto.createHmac('sha512', this.secretKey).update(data).digest('hex');
  }

  /**
   * Sign license data (legacy method name for compatibility)
   * @param {string} data
   * @returns {string}
   */
  signLicense(data) {
    return this.signData(data);
  }

  /**
   * Verify data signature with timing-safe comparison
   * @param {string} data - Original data
   * @param {string} signature - Signature to verify
   * @returns {boolean} Verification result
   */
  verifySignature(data, signature) {
    const expectedSignature = this.signData(data);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Get feature availability based on license
   * @param {string} featureName
   * @returns {boolean}
   */
  async isFeatureEnabled(featureName) {
    const licenseStatus = await this.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.requires_license) {
      return false;
    }

    // Import here to avoid circular dependency
    const { FEATURE_DEFINITIONS } = require('../middleware/featureFlag');
    const featureDefinition = FEATURE_DEFINITIONS[featureName];
    
    // If feature is marked as coming soon, always return false
    if (featureDefinition && featureDefinition.status === 'coming_soon') {
      return false;
    }

    // Enhanced feature access logic: Check both license features AND tier-based features
    let hasFeatureAccess = false;
    
    // Method 1: Check if feature is explicitly listed in license
    if (licenseStatus.features && licenseStatus.features.includes(featureName)) {
      hasFeatureAccess = true;
    }
    
    // Method 2: Check if feature is available based on subscription tier
    if (!hasFeatureAccess && licenseStatus.subscription_tier && featureDefinition) {
      const userTier = licenseStatus.subscription_tier.toLowerCase();
      const requiredTier = featureDefinition.tier.toLowerCase();
      
      // Tier hierarchy: basic < pro < enterprise
      const tierHierarchy = { basic: 1, pro: 2, enterprise: 3 };
      const userTierLevel = tierHierarchy[userTier] || 0;
      const requiredTierLevel = tierHierarchy[requiredTier] || 0;
      
      hasFeatureAccess = userTierLevel >= requiredTierLevel;
    }
    
    // Method 3: Check database license config as fallback
    if (!hasFeatureAccess) {
      try {
        const { getDb } = require('../database/init');
        const db = getDb();
        
        if (db) {
          const dbConfig = await new Promise((resolve, reject) => {
            db.get('SELECT enabled_features FROM license_config WHERE id = ? AND status = ?', 
              ['current-license', 'active'], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });
          
          if (dbConfig && dbConfig.enabled_features) {
            const dbFeatures = JSON.parse(dbConfig.enabled_features);
            hasFeatureAccess = dbFeatures.includes(featureName);
          }
        }
      } catch (dbError) {
        console.log(`ℹ️  Database feature check failed for ${featureName}:`, dbError.message);
      }
    }
    
    return hasFeatureAccess;
  }

  /**
   * Check if employee limit is exceeded
   * @returns {Object} Employee limit status
   */
  async checkEmployeeLimit() {
    const licenseInfo = await this.getLicenseStatus();
    
    if (!licenseInfo || licenseInfo.status === 'invalid' || licenseInfo.requires_license) {
      return { 
        valid: false, 
        error: 'Invalid license',
        current_employees: 0,
        max_employees: 0,
        exceeded: true
      };
    }

    // Get current active employee count
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve) => {
      db.get(
        'SELECT COUNT(*) as count FROM staff_directory WHERE active = 1',
        [],
        (err, row) => {
          if (err) {
            console.error('Error counting employees:', err);
            const maxEmployees = licenseInfo.max_employees;
            const isUnlimited = maxEmployees === -1;
            
            resolve({ 
              valid: false, 
              error: 'Database error',
              current_employees: 0,
              max_employees: maxEmployees,
              exceeded: !isUnlimited, // Don't show unlimited plans as exceeded even on DB error
              is_unlimited: isUnlimited
            });
            return;
          }

          const currentEmployees = row.count || 0;
          const maxEmployees = licenseInfo.max_employees;
          
          // Handle unlimited employees (-1) properly
          const isUnlimited = maxEmployees === -1;
          const exceeded = !isUnlimited && currentEmployees > maxEmployees;
          const remaining = isUnlimited ? Infinity : Math.max(0, maxEmployees - currentEmployees);

          const result = {
            valid: !exceeded,
            current_employees: currentEmployees,
            max_employees: maxEmployees,
            exceeded,
            remaining,
            is_unlimited: isUnlimited
          };
          
          console.log('🔍 Employee limit check:', {
            maxEmployees,
            isUnlimited,
            currentEmployees,
            exceeded,
            result
          });
          
          resolve(result);
        }
      );
    });
  }

  /**
   * Get license status summary
   * @returns {Object}
   */
  async getLicenseStatus() {
    try {
      // Check validation cache first to prevent excessive API calls
      const now = Date.now();
      if (this.validationCache.result && 
          this.validationCache.timestamp && 
          (now - this.validationCache.timestamp < this.validationCache.ttl)) {
        
        // Smart cache invalidation: check if license file or database changed
        const cacheStillValid = await this.isCacheStillValid();
        if (cacheStillValid) {
          console.log(`📋 Using cached license validation (${Math.round((now - this.validationCache.timestamp)/1000)}s old)`);
          return this.validationCache.result;
        } else {
          console.log('🔄 Cache invalidated due to file/database changes');
          this.clearValidationCache();
        }
      }
      
      // First check database for active license
      const { getDb } = require('../database/init');
      const db = getDb();
      
      const dbLicense = await new Promise((resolve, reject) => {
        db.get(`
          SELECT * FROM license_config 
          WHERE id = 'current-license' AND status = 'active'
          ORDER BY updated_at DESC LIMIT 1
        `, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (dbLicense && dbLicense.license_key) {
        console.log(`✅ Active license loaded from database`);
        console.log(`🔍 Database license info: client=${dbLicense.client_name}, status=${dbLicense.status}`);
        
        // Validate the stored license
        console.log(`🔍 About to validate license from database...`);
        const validation = await this.validateLicense(dbLicense.license_key);
        console.log(`🔍 License validation completed. Result: valid=${validation.valid}, error=${validation.error || 'none'}`);
        
        if (validation.valid) {
          console.log(`✅ Database license validation PASSED - processing status...`);
          const expirationDate = new Date(validation.expiration_date);
          const now = new Date();
          const daysRemaining = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
          
          let status = 'active';
          if (daysRemaining <= 0) {
            status = 'expired';
          } else if (daysRemaining <= 30) {
            status = 'expiring_soon';
          }
          
          const finalResult = {
            status: status,
            client_name: validation.client_name,
            subscription_tier: validation.subscription_tier,
            expiration_date: validation.expiration_date,
            days_remaining: daysRemaining,
            features: validation.features,
            max_employees: validation.max_employees
          };
          console.log(`🎉 RETURNING SUCCESSFUL LICENSE STATUS:`, finalResult);
          return await this.cacheValidationResult(finalResult);
        } else {
          console.log(`❌ Database license validation FAILED - validation.valid is false`);
          console.log(`❌ Validation error: ${validation.error}`);
        }
      }
      
      // Fallback to file-based license (legacy)
      console.log(`🔍 No database license found - trying file-based license (legacy)...`);
      const fileLicense = await this.validateLicense();
      
      if (!fileLicense.valid) {
        console.log(`❌ File-based license validation also failed: ${fileLicense.error}`);
        console.log(`🔒 No valid license found - all features disabled`);
        return await this.cacheValidationResult({
          status: 'invalid',
          error: fileLicense.error,
          requires_license: true
        });
      }

      const daysRemaining = fileLicense.days_remaining;
      let status = 'active';
      
      if (daysRemaining <= 0) {
        status = 'expired';
      } else if (daysRemaining <= 30) {
        status = 'expiring_soon';
      }

      return await this.cacheValidationResult({
        status: status,
        client_name: fileLicense.client_name,
        subscription_tier: fileLicense.subscription_tier,
        expiration_date: fileLicense.expiration_date,
        days_remaining: daysRemaining,
        features: fileLicense.features,
        max_employees: fileLicense.max_employees
      });
      
    } catch (error) {
      console.error('❌ Get license status error:', error);
      return await this.cacheValidationResult({
        status: 'invalid',
        error: 'License validation failed',
        requires_license: true
      });
    }
  }

}

module.exports = new LicenseService();