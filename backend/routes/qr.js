const express = require('express');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');

const router = express.Router();

// Get QR data when scanned
router.get('/scan/:token', async (req, res) => {
  const db = getDb();
  const { token } = req.params;
  
  try {
    // Validate token
    const tokenData = await new Promise((resolve, reject) => {
      db.get(`
        SELECT qt.*, s.name as station_name, s.location, s.active
        FROM qr_tokens qt
        JOIN stations s ON qt.station_id = s.id
        WHERE qt.token = ? AND qt.used = 0 AND qt.expires_at > CURRENT_TIMESTAMP
      `, [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!tokenData) {
      return res.status(400).json({ error: 'Invalid or expired QR code' });
    }
    
    if (!tokenData.active) {
      return res.status(400).json({ error: 'Station is currently offline' });
    }
    
    // Get available PPE items for this station
    const availableItems = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pi.id,
          pi.name,
          pi.type,
          si.current_stock,
          CASE WHEN si.current_stock > 0 THEN 1 ELSE 0 END as available
        FROM ppe_items pi
        JOIN station_inventory si ON pi.id = si.ppe_item_id
        WHERE si.station_id = ?
        ORDER BY pi.name
      `, [tokenData.station_id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      stationId: tokenData.station_id,
      stationName: tokenData.station_name,
      location: tokenData.location,
      availableItems: availableItems,
      token: token,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('QR scan error:', error);
    res.status(500).json({ error: 'Failed to process QR scan' });
  }
});

// Generate QR code for station
router.post('/generate', async (req, res) => {
  const db = getDb();
  const { stationId, expiryHours = 24 } = req.body;
  
  try {
    // Verify station exists
    const station = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ?', [stationId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!station) {
      return res.status(404).json({ error: 'Station not found' });
    }
    
    // Generate new token
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);
    
    // Save token to database
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO qr_tokens (id, token, station_id, expires_at)
        VALUES (?, ?, ?, ?)
      `, [uuidv4(), token, stationId, expiresAt.toISOString()], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Generate QR code
    const qrData = {
      type: 'ppe_station',
      token: token,
      stationId: stationId,
      url: `${req.protocol}://${req.get('host')}/api/qr/scan/${token}`
    };
    
    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    res.json({
      qrCode: qrCodeDataURL,
      token: token,
      stationName: station.name,
      expiresAt: expiresAt.toISOString(),
      scanUrl: qrData.url
    });
    
  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Validate QR token (for frontend)
router.post('/validate', async (req, res) => {
  const db = getDb();
  const { token } = req.body;
  
  try {
    const tokenData = await new Promise((resolve, reject) => {
      db.get(`
        SELECT qt.*, s.name as station_name, s.active
        FROM qr_tokens qt
        JOIN stations s ON qt.station_id = s.id
        WHERE qt.token = ? AND qt.expires_at > CURRENT_TIMESTAMP
      `, [token], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!tokenData) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }
    
    if (!tokenData.active) {
      return res.status(400).json({ valid: false, error: 'Station is offline' });
    }
    
    res.json({
      valid: true,
      stationId: tokenData.station_id,
      stationName: tokenData.station_name
    });
    
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ valid: false, error: 'Validation failed' });
  }
});

module.exports = router;