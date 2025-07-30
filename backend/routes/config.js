const express = require('express');
const { getDb } = require('../database/init');

const router = express.Router();

// Get system configuration for worker interface
router.get('/worker-config', async (req, res) => {
  try {
    const db = getDb();
    
    // Get the default station (preferably store-1, fallback to first active station)
    const defaultStation = await new Promise((resolve, reject) => {
      db.get(`
        SELECT id, name, location 
        FROM stations 
        WHERE active = 1 
        ORDER BY 
          CASE WHEN id = 'store-1' THEN 0 ELSE 1 END,
          name ASC 
        LIMIT 1
      `, [], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!defaultStation) {
      return res.status(404).json({ 
        error: 'No active stations found',
        message: 'Please contact your administrator to set up PPE stations.' 
      });
    }

    // Get company/system name from email config
    const systemConfig = await new Promise((resolve, reject) => {
      db.get('SELECT company_name FROM email_config WHERE id = ? LIMIT 1', ['1'], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    res.json({
      success: true,
      defaultStation: {
        id: defaultStation.id,
        name: defaultStation.name,
        location: defaultStation.location
      },
      systemName: systemConfig?.company_name || 'PPE Management System',
      version: '1.0.0'
    });

  } catch (error) {
    console.error('Get worker config error:', error);
    res.status(500).json({ 
      error: 'Failed to load worker configuration',
      message: 'Please try again or contact support.' 
    });
  }
});

// Get available stations (for future station selection feature)
router.get('/stations', async (req, res) => {
  try {
    const db = getDb();
    
    const stations = await new Promise((resolve, reject) => {
      db.all(`
        SELECT id, name, location, qr_code, description
        FROM stations 
        WHERE active = 1 
        ORDER BY 
          CASE WHEN id = 'store-1' THEN 0 ELSE 1 END,
          name ASC
      `, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({
      success: true,
      stations,
      count: stations.length
    });

  } catch (error) {
    console.error('Get stations config error:', error);
    res.status(500).json({ 
      error: 'Failed to load stations',
      message: 'Please try again or contact support.' 
    });
  }
});

module.exports = router;