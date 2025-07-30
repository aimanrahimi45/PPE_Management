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
    
    // Store license in database (primary storage)
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO license_config 
        (id, license_key, company_name, max_users, features, expires_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        'current-license',
        licenseContent,
        validation.client_name,
        validation.max_employees,
        JSON.stringify(validation.features),
        validation.expiration_date,
        'active'
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Also save to file for redundancy
    try {
      await licenseService.saveLicense(licenseContent);
      console.log('✅ License saved to both database and file system');
    } catch (fileError) {
      console.warn('⚠️ License saved to database but file backup failed:', fileError.message);
      // Don't fail the upload if file save fails, database is primary
    }
    
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
    
    // Store license in database
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO license_config 
        (id, license_key, company_name, max_users, features, expires_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        'current-license',
        licenseKey.trim(),
        validation.client_name,
        validation.max_employees,
        JSON.stringify(validation.features),
        validation.expiration_date,
        'active'
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
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