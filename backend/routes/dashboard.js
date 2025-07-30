const express = require('express');
const { getDb } = require('../database/init');
const { enforceLicenseCompliance } = require('../middleware/licenseEnforcement');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get dashboard statistics - No auth required for customer onboarding
router.get('/stats', async (req, res) => {
  // Check license status first
  try {
    const licenseService = require('../services/licenseService');
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid') {
      return res.json({
        success: true,
        license_required: true,
        message: 'License activation required',
        stats: {
          total_stock: 0,
          low_stock_items: 0,
          daily_issued: 0,
          pending_requests: 0,
          active_staff: 0,
          total_stations: 0
        }
      });
    }
  } catch (error) {
    // If license check fails, assume no license
    return res.json({
      success: true,
      license_required: true,
      message: 'License activation required',
      stats: {
        total_stock: 0,
        low_stock_items: 0,
        daily_issued: 0,
        pending_requests: 0,
        active_staff: 0,
        total_stations: 0
      }
    });
  }
  const db = getDb();
  
  try {
    const stats = await Promise.all([
      // Total stock across all stations (handle empty gracefully)
      new Promise((resolve, reject) => {
        db.get('SELECT SUM(current_stock) as total FROM station_inventory', (err, row) => {
          if (err) {
            // If table doesn't exist or is empty, return 0
            resolve(0);
          } else {
            resolve(row.total || 0);
          }
        });
      }),
      
      // Low stock items count (handle empty gracefully)
      new Promise((resolve, reject) => {
        db.get(`
          SELECT COUNT(*) as count 
          FROM station_inventory si
          JOIN ppe_items pi ON si.ppe_item_id = pi.id
          WHERE si.current_stock <= pi.min_threshold
        `, (err, row) => {
          if (err) {
            // If no data, return 0
            resolve(0);
          } else {
            resolve(row.count || 0);
          }
        });
      }),
      
      // Daily PPE issued (today) - Fixed query
      new Promise((resolve, reject) => {
        db.get(`
          SELECT COALESCE(SUM(pri.quantity), 0) as total
          FROM ppe_request_items pri
          JOIN ppe_requests pr ON pri.request_id = pr.id
          WHERE DATE(pr.created_at) = DATE('now') 
            AND pr.status = 'APPROVED'
            AND pri.issued = 1
        `, (err, row) => {
          if (err) {
            resolve(0);
          } else {
            resolve(row.total || 0);
          }
        });
      }),
      
      // Active stations count
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM stations WHERE active = 1', (err, row) => {
          if (err) {
            resolve(0);
          } else {
            resolve(row.count || 0);
          }
        });
      })
    ]);
    
    res.json({
      totalStock: stats[0],
      lowStockItems: stats[1],
      dailyIssued: stats[2],
      activeStations: stats[3]
    });
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// Get recent activity
router.get('/activity', authenticateToken, enforceLicenseCompliance, async (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 10;
  
  try {
    const activities = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pr.id,
          u.name as user_name,
          s.name as station_name,
          pr.created_at,
          GROUP_CONCAT(pi.name || ' (' || pri.quantity || ')') as items
        FROM ppe_requests pr
        LEFT JOIN users u ON pr.user_id = u.id
        JOIN stations s ON pr.station_id = s.id
        JOIN ppe_request_items pri ON pr.id = pri.request_id
        JOIN ppe_items pi ON pri.ppe_item_id = pi.id
        WHERE pr.status = 'APPROVED'
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(activities);
    
  } catch (error) {
    console.error('Recent activity error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// Get usage trends data
router.get('/trends', authenticateToken, enforceLicenseCompliance, async (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 7;
  
  try {
    const trends = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          DATE(pr.created_at) as date,
          COUNT(*) as requests,
          SUM(pri.quantity) as total_items
        FROM ppe_requests pr
        JOIN ppe_request_items pri ON pr.id = pri.request_id
        WHERE pr.created_at >= DATE('now', '-${days} days')
        AND pr.status = 'APPROVED'
        GROUP BY DATE(pr.created_at)
        ORDER BY date ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(trends);
    
  } catch (error) {
    console.error('Usage trends error:', error);
    res.status(500).json({ error: 'Failed to fetch usage trends' });
  }
});

module.exports = router;