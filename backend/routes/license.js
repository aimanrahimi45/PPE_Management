const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const licenseService = require('../services/licenseService');
const { getDb } = require('../database/init');
const multer = require('multer');
const fs = require('fs');

const router = express.Router();

// Configure multer for license file uploads
const upload = multer({
  dest: 'uploads/licenses/',
  fileFilter: (req, file, cb) => {
    // Accept .lic files or text files
    if (file.originalname.endsWith('.lic') || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only .lic license files are allowed'), false);
    }
  },
  limits: {
    fileSize: 1024 * 1024 // 1MB limit
  }
});

// Upload and activate license file
router.post('/upload', upload.single('licenseFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No license file provided'
      });
    }

    // Read the uploaded license file
    const licenseContent = fs.readFileSync(req.file.path, 'utf8');
    
    // Auto-clear license cache when new license is uploaded
    console.log('🗑️ Auto-clearing license cache for new license upload...');
    try {
      const licenseService = require('../services/licenseService');
      const vpsLicenseService = require('../services/vpsLicenseService');
      
      // Clear license service cache
      if (licenseService.clearValidationCache) {
        licenseService.clearValidationCache();
        console.log('✅ License service cache cleared');
      }
      
      // Clear VPS service cache
      if (vpsLicenseService.validationCache) {
        vpsLicenseService.validationCache.result = null;
        vpsLicenseService.validationCache.timestamp = null;
        vpsLicenseService.validationCache.licenseKey = null;
        console.log('✅ VPS service cache cleared');
      }
      
      // Clear database license cache (remove old license records)
      const { getDb } = require('../database/init');
      const db = getDb();
      if (db) {
        await new Promise((resolve) => {
          db.run(`DELETE FROM license_config WHERE id = 'current-license'`, function(err) {
            if (!err && this.changes > 0) {
              console.log(`✅ Removed ${this.changes} old license record(s) from database`);
            }
            resolve();
          });
        });
      }
      
      console.log('✅ License cache auto-cleared for fresh validation');
    } catch (cacheError) {
      console.warn('⚠️ Cache clearing failed:', cacheError.message);
      // Don't fail upload if cache clearing fails
    }
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    // Validate the license
    const validation = await licenseService.validateLicense(licenseContent);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
        details: 'Please check your license file and try again'
      });
    }
    
    // Check for license sharing - block immediately regardless of grace period
    if (validation.licenseSharing || (validation.error && (
        validation.error.includes('License already in use') ||
        validation.error.includes('already active on another device') ||
        validation.error.includes('License sharing detected')
    ))) {
      console.log('🚨 License sharing detected - blocking upload');
      return res.status(403).json({
        success: false,
        error: 'License sharing detected',
        message: '🚨 This license is already active on another device. Each license can only be used on one device at a time.',
        details: 'If you need to move your license to this device, please deactivate it on the previous device first.',
        errorType: 'license_sharing'
      });
    }

    // VPS License Activation
    let vpsActivationResult = null;
    if (process.env.ENABLE_VPS_LICENSE_CHECK === 'true') {
      console.log('🌐 Activating license on VPS server...');
      const vpsLicenseService = require('../services/vpsLicenseService');
      
      try {
        const vpsActivation = await vpsLicenseService.activateLicense(licenseContent, {
          clientName: validation.client_name,
          subscriptionTier: validation.subscription_tier,
          activationSource: 'file_upload',
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip
        });
        
        vpsActivationResult = vpsActivation;
        
        // Check for license sharing - return specific error
        if (!vpsActivation.success && vpsActivation.error === 'License already in use') {
          console.log('🚨 License sharing detected:', vpsActivation.error);
          return res.status(403).json({
            success: false,
            error: 'License sharing detected',
            message: '🚨 This license is already active on another device. Each license can only be used on one device at a time.',
            details: 'If you need to move your license to this device, please deactivate it on the previous device first.',
            vpsError: true,
            errorType: 'license_sharing'
          });
        }
        
        if (!vpsActivation.success && !vpsActivation.fallbackMode) {
          console.log('❌ VPS license activation failed:', vpsActivation.error);
          return res.status(400).json({
            success: false,
            error: 'License activation failed on server',
            details: vpsActivation.details || vpsActivation.error,
            vpsError: true
          });
        }
        
        if (vpsActivation.success) {
          console.log('✅ License successfully activated on VPS server');
        } else {
          console.log('⚠️ VPS activation failed, continuing in fallback mode');
        }
        
      } catch (vpsError) {
        console.log('⚠️ VPS activation error, continuing with local activation:', vpsError.message);
        // Continue with local activation as fallback
        vpsActivationResult = { success: false, fallbackMode: true, error: vpsError.message };
      }
    }
    
    // License is already stored by validation process - don't overwrite
    // The validateLicense() method calls activateLicense() which properly saves:
    // - installation_id, client_name, license_key, status
    // We don't need to save again here as it would overwrite activation data
    console.log('✅ License already stored during validation process with activation data');

    // Also save to file for redundancy
    try {
      await licenseService.saveLicense(licenseContent);
      console.log('✅ License saved to both database and file system');
    } catch (fileError) {
      console.warn('⚠️ License saved to database but file backup failed:', fileError.message);
      // Don't fail the upload if file save fails, database is primary
    }
    
    console.log(`✅ License activated for ${validation.client_name} (${validation.subscription_tier})`);
    
    // Determine appropriate success message based on VPS validation status
    let successMessage = 'License activated successfully!';
    let warningMessage = null;
    
    if (vpsActivationResult) {
      if (vpsActivationResult.success) {
        successMessage = '🛡️ License activated and validated with secure server!';
      } else if (vpsActivationResult.fallbackMode) {
        successMessage = 'License activated in offline mode';
        warningMessage = '⚠️ Could not connect to license validation server. License is valid for 7 days offline.';
      }
    }
    
    const response = {
      success: true,
      message: successMessage,
      license: {
        client_name: validation.client_name,
        subscription_tier: validation.subscription_tier,
        features: validation.features,
        max_employees: validation.max_employees,
        expires_at: validation.expiration_date,
        features_count: validation.features.length
      }
    };
    
    if (warningMessage) {
      response.warning = warningMessage;
      response.gracePeriodActive = true;
    }
    
    res.json(response);
    
  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('License upload error:', error);
    res.status(500).json({
      success: false,
      error: 'License activation failed',
      message: error.message
    });
  }
});

// Activate license by text input
router.post('/activate', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({
        success: false,
        error: 'License key is required'
      });
    }
    
    // Validate the license
    const validation = await licenseService.validateLicense(licenseKey.trim());
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
        details: 'Please check your license key and try again'
      });
    }
    
    // License is already stored by validation process - don't overwrite
    // The validateLicense() method calls activateLicense() which properly saves:
    // - installation_id, client_name, license_key, status  
    // We don't need to save again here as it would overwrite activation data
    console.log('✅ License already stored during validation process with activation data');
    
    console.log(`✅ License activated for ${validation.client_name} (${validation.subscription_tier})`);
    
    res.json({
      success: true,
      message: 'License activated successfully!',
      license: {
        client_name: validation.client_name,
        subscription_tier: validation.subscription_tier,
        features: validation.features,
        max_employees: validation.max_employees,
        expires_at: validation.expiration_date,
        features_count: validation.features.length
      }
    });
    
  } catch (error) {
    console.error('License activation error:', error);
    res.status(500).json({
      success: false,
      error: 'License activation failed',
      message: error.message
    });
  }
});

// Get current license status
router.get('/status', async (req, res) => {
  try {
    const status = await licenseService.getLicenseStatus();
    
    res.json({
      success: true,
      license: status
    });
    
  } catch (error) {
    console.error('License status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get license status'
    });
  }
});

// Deactivate current license
router.post('/deactivate', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE license_config 
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE id = 'current-license'
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log('📄 License deactivated');
    
    res.json({
      success: true,
      message: 'License deactivated successfully'
    });
    
  } catch (error) {
    console.error('License deactivation error:', error);
    res.status(500).json({
      success: false,
      error: 'License deactivation failed'
    });
  }
});

module.exports = router;