const express = require('express');
const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Get all alerts
router.get('/', async (req, res) => {
  const db = getDb();
  const { active = 'true', limit = 50 } = req.query;
  
  try {
    let query = `
      SELECT 
        a.*,
        s.name as station_name,
        s.location
      FROM alerts a
      LEFT JOIN stations s ON a.station_id = s.id
    `;
    
    const params = [];
    
    if (active === 'true') {
      query += ' WHERE a.resolved = 0';
    }
    
    query += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const alerts = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(alerts);
    
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Create new alert
router.post('/', async (req, res) => {
  const db = getDb();
  const { type, title, message, severity = 'MEDIUM', station_id } = req.body;
  
  try {
    const alertId = uuidv4();
    
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO alerts (id, type, title, message, severity, station_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [alertId, type, title, message, severity, station_id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Broadcast to admin dashboard
    const io = req.app.get('io');
    io.to('admin_room').emit('new_alert', {
      id: alertId,
      type,
      title,
      message,
      severity,
      station_id
    });
    
    res.json({ success: true, alertId, message: 'Alert created successfully' });
    
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// Dismiss/resolve alert
router.put('/:id/dismiss', async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { resolved_by = 'admin' } = req.body;
  
  try {
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE alerts 
        SET resolved = 1, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [resolved_by, id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Broadcast update
    const io = req.app.get('io');
    io.to('admin_room').emit('alert_dismissed', { alertId: id });
    
    res.json({ success: true, message: 'Alert dismissed successfully' });
    
  } catch (error) {
    console.error('Dismiss alert error:', error);
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

// Get alert statistics
router.get('/stats', async (req, res) => {
  const db = getDb();
  
  try {
    const stats = await Promise.all([
      // Total active alerts
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM alerts WHERE resolved = 0', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      }),
      
      // Critical alerts
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM alerts WHERE resolved = 0 AND severity = "CRITICAL"', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      }),
      
      // Alerts by type
      new Promise((resolve, reject) => {
        db.all(`
          SELECT type, COUNT(*) as count 
          FROM alerts 
          WHERE resolved = 0 
          GROUP BY type
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      })
    ]);
    
    res.json({
      totalActive: stats[0],
      critical: stats[1],
      byType: stats[2]
    });
    
  } catch (error) {
    console.error('Alert stats error:', error);
    res.status(500).json({ error: 'Failed to fetch alert statistics' });
  }
});

module.exports = router;