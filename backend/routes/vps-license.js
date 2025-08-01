const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database/init');

const router = express.Router();

// VPS License API Configuration
const VALID_API_KEYS = [
  'PPE-MANAGEMENT-LICENSE-API-2024',
  process.env.LICENSE_API_KEY
].filter(Boolean);

/**
 * Middleware to validate API key
 */
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.body.apiKey;
  
  if (!apiKey || !VALID_API_KEYS.includes(apiKey)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      message: 'Valid API key required for license operations'
    });
  }
  
  next();
};

/**
 * Initialize VPS license database tables
 */
async function initializeLicenseDatabase() {
  const db = getDb();
  
  // Check if database is available
  if (!db) {
    console.log('⚠️ Database not available for VPS license initialization, will retry later');
    return false;
  }
  
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Licensed devices table
      db.run(`
        CREATE TABLE IF NOT EXISTS licensed_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          license_key TEXT NOT NULL,
          device_fingerprint TEXT NOT NULL,
          client_info TEXT,
          activation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'active',
          expiry_date DATETIME,
          activation_count INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(license_key, device_fingerprint)
        )
      `, (err) => {
        if (err) console.error('Error creating licensed_devices table:', err);
      });

      // License heartbeats table
      db.run(`
        CREATE TABLE IF NOT EXISTS license_heartbeats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          license_key TEXT NOT NULL,
          device_fingerprint TEXT NOT NULL,
          heartbeat_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          system_status TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (license_key) REFERENCES licensed_devices (license_key)
        )
      `, (err) => {
        if (err) console.error('Error creating license_heartbeats table:', err);
      });

      // License validation logs
      db.run(`
        CREATE TABLE IF NOT EXISTS license_validation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          license_key TEXT NOT NULL,
          device_fingerprint TEXT NOT NULL,
          action TEXT NOT NULL,
          result TEXT NOT NULL,
          error_message TEXT,
          client_ip TEXT,
          user_agent TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating license_validation_logs table:', err);
        resolve();
      });
    });
  });
}

/**
 * Log license validation attempt
 */
async function logValidationAttempt(licenseKey, deviceFingerprint, action, result, errorMessage = null, req = null) {
  const db = getDb();
  
  return new Promise((resolve) => {
    db.run(`
      INSERT INTO license_validation_logs 
      (license_key, device_fingerprint, action, result, error_message, client_ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      licenseKey?.substring(0, 20) || 'unknown',
      deviceFingerprint?.substring(0, 32) || 'unknown',
      action,
      result,
      errorMessage,
      req?.ip || req?.connection?.remoteAddress || 'unknown',
      req?.headers['user-agent'] || 'unknown'
    ], (err) => {
      if (err) console.error('Error logging validation attempt:', err);
      resolve();
    });
  });
}

/**
 * Check if license key format is valid
 */
function isValidLicenseKey(licenseKey) {
  // Basic validation - adjust based on your license key format
  return licenseKey && 
         typeof licenseKey === 'string' && 
         licenseKey.length >= 10 && 
         licenseKey.length <= 100;
}

/**
 * Check if device fingerprint format is valid
 */
function isValidDeviceFingerprint(fingerprint) {
  return fingerprint && 
         typeof fingerprint === 'string' && 
         fingerprint.length === 64 && // SHA-256 hex
         /^[a-f0-9]+$/i.test(fingerprint);
}

/**
 * GET /api/license/status
 * Get VPS license server status
 */
router.get('/status', validateApiKey, async (req, res) => {
  try {
    const db = getDb();
    
    // Get basic statistics
    const stats = await new Promise((resolve) => {
      db.all(`
        SELECT 
          COUNT(*) as total_devices,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_devices,
          COUNT(CASE WHEN last_seen > datetime('now', '-1 hour') THEN 1 END) as recently_active
        FROM licensed_devices
      `, [], (err, rows) => {
        resolve(err ? {} : rows[0]);
      });
    });

    res.json({
      success: true,
      status: 'online',
      version: '2.0',
      serverTime: new Date().toISOString(),
      statistics: stats,
      message: 'VPS License Server operational'
    });

  } catch (error) {
    console.error('License status error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'Unable to get server status'
    });
  }
});

/**
 * POST /api/license/validate
 * Main license validation endpoint
 */
router.post('/validate', validateApiKey, async (req, res) => {
  try {
    const { action, licenseKey, deviceFingerprint, clientInfo, timestamp } = req.body;
    
    console.log(`📥 VPS License ${action} request:`, {
      license: licenseKey?.substring(0, 8) + '...',
      device: deviceFingerprint?.substring(0, 16) + '...',
      timestamp: timestamp
    });

    // Validate required fields
    if (!action || !licenseKey || !deviceFingerprint) {
      await logValidationAttempt(licenseKey, deviceFingerprint, action || 'unknown', 'failed', 'Missing required fields', req);
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'action, licenseKey, and deviceFingerprint are required'
      });
    }

    // Validate formats
    if (!isValidLicenseKey(licenseKey)) {
      await logValidationAttempt(licenseKey, deviceFingerprint, action, 'failed', 'Invalid license key format', req);
      return res.status(400).json({
        success: false,
        error: 'Invalid license key format',
        message: 'License key format is not valid'
      });
    }

    if (!isValidDeviceFingerprint(deviceFingerprint)) {
      await logValidationAttempt(licenseKey, deviceFingerprint, action, 'failed', 'Invalid device fingerprint format', req);
      return res.status(400).json({
        success: false,
        error: 'Invalid device fingerprint format',
        message: 'Device fingerprint must be 64-character hex string'
      });
    }

    const db = getDb();

    // Handle different actions
    switch (action.toLowerCase()) {
      case 'activate':
        return await handleLicenseActivation(db, licenseKey, deviceFingerprint, clientInfo, req, res);
      
      case 'validate':
        return await handleLicenseValidation(db, licenseKey, deviceFingerprint, req, res);
      
      case 'deactivate':
        return await handleLicenseDeactivation(db, licenseKey, deviceFingerprint, req, res);
      
      default:
        await logValidationAttempt(licenseKey, deviceFingerprint, action, 'failed', 'Invalid action', req);
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          message: 'Supported actions: activate, validate, deactivate'
        });
    }

  } catch (error) {
    console.error('License validation error:', error);
    await logValidationAttempt(req.body.licenseKey, req.body.deviceFingerprint, req.body.action, 'error', error.message, req);
    
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'License validation failed due to server error'
    });
  }
});

/**
 * Handle license activation
 */
async function handleLicenseActivation(db, licenseKey, deviceFingerprint, clientInfo, req, res) {
  return new Promise((resolve) => {
    // Check if this license key is already activated on a different device
    db.get(`
      SELECT * FROM licensed_devices 
      WHERE license_key = ? AND device_fingerprint != ? AND status = 'active'
    `, [licenseKey, deviceFingerprint], async (err, existingDevice) => {
      if (err) {
        console.error('Database error during activation check:', err);
        await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'error', err.message, req);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          message: 'Unable to check existing activations'
        });
      }

      if (existingDevice) {
        // License already activated on different device
        console.log(`❌ License sharing detected:`, {
          license: licenseKey.substring(0, 8) + '...',
          existingDevice: existingDevice.device_fingerprint.substring(0, 16) + '...',
          newDevice: deviceFingerprint.substring(0, 16) + '...'
        });
        
        await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'failed', 'License already activated on different device', req);
        return res.status(409).json({
          success: false,
          error: 'License already activated',
          message: 'This license is already activated on a different device',
          details: `License activated on device ${existingDevice.device_fingerprint.substring(0, 16)}... at ${existingDevice.activation_date}`
        });
      }

      // Check if this exact combination already exists
      db.get(`
        SELECT * FROM licensed_devices 
        WHERE license_key = ? AND device_fingerprint = ?
      `, [licenseKey, deviceFingerprint], async (err, existingRecord) => {
        if (err) {
          console.error('Database error during duplicate check:', err);
          await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'error', err.message, req);
          return res.status(500).json({
            success: false,
            error: 'Database error',
            message: 'Unable to check existing records'
          });
        }

        if (existingRecord) {
          // Update existing record
          db.run(`
            UPDATE licensed_devices 
            SET status = 'active', last_seen = CURRENT_TIMESTAMP, activation_count = activation_count + 1,
                client_info = ?, updated_at = CURRENT_TIMESTAMP
            WHERE license_key = ? AND device_fingerprint = ?
          `, [JSON.stringify(clientInfo), licenseKey, deviceFingerprint], async (err) => {
            if (err) {
              console.error('Database error during activation update:', err);
              await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'error', err.message, req);
              return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Unable to update license activation'
              });
            }

            console.log(`✅ License reactivated:`, {
              license: licenseKey.substring(0, 8) + '...',
              device: deviceFingerprint.substring(0, 16) + '...'
            });

            await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'success', null, req);
            res.json({
              success: true,
              status: 'reactivated',
              message: 'License reactivated successfully',
              deviceMatch: true,
              activationDate: existingRecord.activation_date,
              activationCount: existingRecord.activation_count + 1
            });
          });
        } else {
          // Create new activation record
          db.run(`
            INSERT INTO licensed_devices 
            (license_key, device_fingerprint, client_info, status, last_seen)
            VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
          `, [licenseKey, deviceFingerprint, JSON.stringify(clientInfo)], async (err) => {
            if (err) {
              console.error('Database error during activation insert:', err);
              await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'error', err.message, req);
              return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Unable to create license activation'
              });
            }

            console.log(`✅ License activated:`, {
              license: licenseKey.substring(0, 8) + '...',
              device: deviceFingerprint.substring(0, 16) + '...'
            });

            await logValidationAttempt(licenseKey, deviceFingerprint, 'activate', 'success', null, req);
            res.json({
              success: true,
              status: 'activated',
              message: 'License activated successfully',
              deviceMatch: true,
              activationDate: new Date().toISOString(),
              activationCount: 1
            });
          });
        }
      });
    });
  });
}

/**
 * Handle license validation
 */
async function handleLicenseValidation(db, licenseKey, deviceFingerprint, req, res) {
  return new Promise((resolve) => {
    db.get(`
      SELECT * FROM licensed_devices 
      WHERE license_key = ? AND device_fingerprint = ? AND status = 'active'
    `, [licenseKey, deviceFingerprint], async (err, record) => {
      if (err) {
        console.error('Database error during validation:', err);
        await logValidationAttempt(licenseKey, deviceFingerprint, 'validate', 'error', err.message, req);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          message: 'Unable to validate license'
        });
      }

      if (!record) {
        // Check if license exists on different device
        db.get(`
          SELECT * FROM licensed_devices 
          WHERE license_key = ? AND status = 'active'
        `, [licenseKey], async (err2, otherDevice) => {
          if (!err2 && otherDevice) {
            console.log(`❌ License validation failed - device mismatch:`, {
              license: licenseKey.substring(0, 8) + '...',
              expectedDevice: otherDevice.device_fingerprint.substring(0, 16) + '...',
              actualDevice: deviceFingerprint.substring(0, 16) + '...'
            });
            
            await logValidationAttempt(licenseKey, deviceFingerprint, 'validate', 'failed', 'Device fingerprint mismatch', req);
            return res.status(403).json({
              success: false,
              error: 'Device fingerprint mismatch',
              message: 'License is activated on a different device',
              deviceMatch: false
            });
          } else {
            console.log(`❌ License validation failed - not found:`, {
              license: licenseKey.substring(0, 8) + '...',
              device: deviceFingerprint.substring(0, 16) + '...'
            });
            
            await logValidationAttempt(licenseKey, deviceFingerprint, 'validate', 'failed', 'License not activated', req);
            return res.status(404).json({
              success: false,
              error: 'License not activated',
              message: 'License not found or not activated on this device'
            });
          }
        });
        return;
      }

      // Update last seen timestamp
      db.run(`
        UPDATE licensed_devices 
        SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE license_key = ? AND device_fingerprint = ?
      `, [licenseKey, deviceFingerprint], async (err) => {
        if (err) {
          console.error('Error updating last seen:', err);
        }

        console.log(`✅ License validation successful:`, {
          license: licenseKey.substring(0, 8) + '...',
          device: deviceFingerprint.substring(0, 16) + '...',
          activatedAt: record.activation_date
        });

        await logValidationAttempt(licenseKey, deviceFingerprint, 'validate', 'success', null, req);
        res.json({
          success: true,
          status: 'valid',
          message: 'License is valid and active',
          deviceMatch: true,
          activationDate: record.activation_date,
          lastSeen: new Date().toISOString(),
          activationCount: record.activation_count
        });
      });
    });
  });
}

/**
 * Handle license deactivation
 */
async function handleLicenseDeactivation(db, licenseKey, deviceFingerprint, req, res) {
  return new Promise((resolve) => {
    db.run(`
      UPDATE licensed_devices 
      SET status = 'deactivated', updated_at = CURRENT_TIMESTAMP
      WHERE license_key = ? AND device_fingerprint = ? AND status = 'active'
    `, [licenseKey, deviceFingerprint], async function(err) {
      if (err) {
        console.error('Database error during deactivation:', err);
        await logValidationAttempt(licenseKey, deviceFingerprint, 'deactivate', 'error', err.message, req);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          message: 'Unable to deactivate license'
        });
      }

      if (this.changes === 0) {
        await logValidationAttempt(licenseKey, deviceFingerprint, 'deactivate', 'failed', 'License not found or already deactivated', req);
        return res.status(404).json({
          success: false,
          error: 'License not found',
          message: 'License not found or already deactivated'
        });
      }

      console.log(`✅ License deactivated:`, {
        license: licenseKey.substring(0, 8) + '...',
        device: deviceFingerprint.substring(0, 16) + '...'
      });

      await logValidationAttempt(licenseKey, deviceFingerprint, 'deactivate', 'success', null, req);
      res.json({
        success: true,
        status: 'deactivated',
        message: 'License deactivated successfully'
      });
    });
  });
}

/**
 * POST /api/license/heartbeat
 * Handle license heartbeat
 */
router.post('/heartbeat', validateApiKey, async (req, res) => {
  try {
    const { licenseKey, deviceFingerprint, systemStatus, timestamp } = req.body;

    if (!licenseKey || !deviceFingerprint) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'licenseKey and deviceFingerprint are required'
      });
    }

    const db = getDb();

    // Verify the license is still valid
    db.get(`
      SELECT * FROM licensed_devices 
      WHERE license_key = ? AND device_fingerprint = ? AND status = 'active'
    `, [licenseKey, deviceFingerprint], (err, record) => {
      if (err) {
        console.error('Database error during heartbeat:', err);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          message: 'Unable to process heartbeat'
        });
      }

      if (!record) {
        return res.status(404).json({
          success: false,
          error: 'License not found',
          message: 'License not found or not active'
        });
      }

      // Update last seen and record heartbeat
      db.run(`
        UPDATE licensed_devices 
        SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE license_key = ? AND device_fingerprint = ?
      `, [licenseKey, deviceFingerprint], (err) => {
        if (err) {
          console.error('Error updating last seen for heartbeat:', err);
        }
      });

      // Record heartbeat
      db.run(`
        INSERT INTO license_heartbeats 
        (license_key, device_fingerprint, system_status)
        VALUES (?, ?, ?)
      `, [licenseKey, deviceFingerprint, JSON.stringify(systemStatus)], (err) => {
        if (err) {
          console.error('Error recording heartbeat:', err);
        }

        console.log(`💓 Heartbeat received:`, {
          license: licenseKey.substring(0, 8) + '...',
          device: deviceFingerprint.substring(0, 16) + '...'
        });

        res.json({
          success: true,
          message: 'Heartbeat acknowledged',
          serverTime: new Date().toISOString()
        });
      });
    });

  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'Unable to process heartbeat'
    });
  }
});

/**
 * GET /api/license/devices
 * Get all licensed devices (admin endpoint)
 */
router.get('/devices', validateApiKey, async (req, res) => {
  try {
    const db = getDb();
    
    db.all(`
      SELECT 
        license_key,
        device_fingerprint,
        status,
        activation_date,
        last_seen,
        activation_count,
        client_info
      FROM licensed_devices
      ORDER BY activation_date DESC
    `, [], (err, rows) => {
      if (err) {
        console.error('Database error getting devices:', err);
        return res.status(500).json({
          success: false,
          error: 'Database error',
          message: 'Unable to get licensed devices'
        });
      }

      // Mask sensitive data
      const devices = rows.map(row => ({
        licenseKey: row.license_key.substring(0, 8) + '...',
        deviceFingerprint: row.device_fingerprint.substring(0, 16) + '...',
        status: row.status,
        activationDate: row.activation_date,
        lastSeen: row.last_seen,
        activationCount: row.activation_count,
        clientInfo: row.client_info ? JSON.parse(row.client_info) : null
      }));

      res.json({
        success: true,
        devices: devices,
        total: devices.length,
        active: devices.filter(d => d.status === 'active').length
      });
    });

  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: 'Unable to get licensed devices'
    });
  }
});

// Initialize database tables when this module is loaded (database should be ready by now)
initializeLicenseDatabase().then(result => {
  if (result !== false) {
    console.log('✅ VPS license database tables initialized successfully');
  }
}).catch(error => {
  console.error('❌ Failed to initialize VPS license database tables:', error.message);
});

module.exports = router;