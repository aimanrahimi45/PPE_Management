const express = require('express');
const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const licenseService = require('../services/licenseService');
const emailService = require('../services/emailService');
const notificationHelper = require('../services/notificationHelper');
const { checkFeatureAccess } = require('../middleware/featureFlag');

const router = express.Router();

// Submit new PPE request (Basic PPE management feature)
router.post('/', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  try {
    // Enforce license before processing PPE requests
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.status === 'expired') {
      return res.status(403).json({
        error: 'License Required',
        message: 'A valid license is required to submit PPE requests. Please contact your administrator.',
        code: 'LICENSE_REQUIRED'
      });
    }
    
    const db = getDb();
    const { staffId, staffName, department, stationId, items, notes } = req.body;
    
    console.log('=== PPE REQUEST DEBUG (ppe-requests.js) ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('staffId:', staffId, 'type:', typeof staffId);
    console.log('staffName:', staffName, 'type:', typeof staffName);
    console.log('department:', department, 'type:', typeof department);
    
    if (!staffId || !staffName || !department || !items || items.length === 0) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get staff directory record ID for proper database linking
    let staffDirectoryId = null;
    if (staffId) {
      try {
        const staffRecord = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM staff_directory WHERE staff_id = ? AND active = 1', [staffId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (staffRecord) {
          staffDirectoryId = staffRecord.id;
          console.log(`✅ Found staff directory ID: ${staffDirectoryId} for staff_id: ${staffId}`);
        } else {
          console.warn(`⚠️ No staff directory record found for staff_id: ${staffId}`);
        }
      } catch (error) {
        console.error('Error getting staff directory ID:', error);
      }
    }

    // Validate items structure
    for (const item of items) {
      if (!item.ppeItemId || !item.quantity) {
        console.error('Invalid item structure:', item);
        return res.status(400).json({ 
          error: 'Invalid item data - each item must have ppeItemId and quantity',
          receivedItem: item 
        });
      }
    }

    console.log('✅ PPE Request received:', { staffId, staffName, department, stationId, items: items.length });
    
    const requestId = uuidv4();
    
    // Validate station exists or use a default
    let validStationId = stationId;
    if (!validStationId) {
      // Find first available station as fallback
      const firstStation = await new Promise((resolve, reject) => {
        db.get(`SELECT id FROM stations LIMIT 1`, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      validStationId = firstStation ? firstStation.id : 'DEFAULT_STATION';
    }
    
    // Create PPE request with proper user_id linking
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO ppe_requests (id, user_id, staff_id, station_id, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [requestId, staffDirectoryId, staffId, validStationId, 'PENDING', notes || `Request from ${staffName} (${department})`], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Add request items
    for (const item of items) {
      const itemId = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO ppe_request_items (id, request_id, ppe_item_id, quantity, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [itemId, requestId, item.ppeItemId, item.quantity], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    // Get station information for email
    let stationName = 'Unknown Station';
    try {
      const station = await new Promise((resolve, reject) => {
        db.get(`SELECT name FROM stations WHERE id = ?`, [validStationId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      stationName = station ? station.name : 'Unknown Station';
    } catch (error) {
      console.error('Failed to get station name:', error);
    }
    
    // Send email notification to Safety Officer
    try {
      // Get readable PPE item names for email
      const ppeItemsWithNames = await Promise.all(
        items.map(async (item) => {
          try {
            const ppeItem = await new Promise((resolve, reject) => {
              db.get('SELECT name FROM ppe_items WHERE id = ?', [item.ppeItemId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
              });
            });
            const itemName = ppeItem ? ppeItem.name : item.ppeItemId;
            return `${itemName} (${item.quantity})`;
          } catch (err) {
            console.error('Error getting PPE item name:', err);
            return `${item.ppeItemId} (${item.quantity})`;
          }
        })
      );

      console.log('📧 Sending safety officer notification for request:', requestId);
      await notificationHelper.sendNotificationIfEnabled('ppe_request_new', {
        requestId,
        staffName: staffName || 'Unknown',
        staffId: staffId || 'N/A',
        department: department || 'N/A',
        itemCount: items.length,
        items: ppeItemsWithNames.join(', '),
        stationName: stationName
      });
    } catch (notificationError) {
      console.error('❌ Failed to send PPE request notification:', notificationError);
      // Don't fail the request if notification fails
    }
    
    // Broadcast to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('new_ppe_request', {
        id: requestId,
        worker: staffName,
        department: department,
        staffId: staffId,
        notes: notes,
        items: items.map(i => `${i.ppeItemId} (${i.quantity})`).join(', '),
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      requestId,
      message: 'PPE request submitted successfully and sent for approval',
      status: 'PENDING'
    });
    
  } catch (error) {
    console.error('PPE request error:', error);
    res.status(500).json({ error: 'Failed to submit PPE request' });
  }
});

// Get user's request history (Basic PPE management feature)
router.get('/user/:userId', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  
  try {
    const requests = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pr.id,
          pr.status,
          pr.notes,
          pr.created_at,
          GROUP_CONCAT(pri.ppe_item_id || ' (' || pri.quantity || ')') as items
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        WHERE pr.user_id = ?
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
        LIMIT 10
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(requests);
    
  } catch (error) {
    console.error('Get user requests error:', error);
    res.status(500).json({ error: 'Failed to get request history' });
  }
});

// Get all pending requests (for admin) (Basic PPE management feature)
router.get('/pending', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  
  try {
    const requests = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pr.id,
          pr.user_id,
          pr.status,
          pr.notes,
          pr.created_at,
          sd.name as staff_name,
          sd.staff_id as staff_id,
          sd.department,
          GROUP_CONCAT(pri.ppe_item_id || ' (' || pri.quantity || ')') as items
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        LEFT JOIN staff_directory sd ON pr.user_id = sd.id
        WHERE pr.status = 'PENDING'
        GROUP BY pr.id, pr.user_id, pr.status, pr.notes, pr.created_at, sd.name, sd.staff_id, sd.department
        ORDER BY pr.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(requests);
    
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

// Approve/Deny request (Basic PPE management feature)
router.put('/:id/status', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { status, notes } = req.body;
  
  try {
    if (!['APPROVED', 'DENIED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE ppe_requests 
        SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, notes || '', id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Broadcast to relevant parties
    const io = req.app.get('io');
    if (io) {
      io.emit('request_status_updated', {
        requestId: id,
        status,
        notes
      });
    }
    
    res.json({
      success: true,
      message: `Request ${status.toLowerCase()} successfully`
    });
    
  } catch (error) {
    console.error('Update request status error:', error);
    res.status(500).json({ error: 'Failed to update request status' });
  }
});

// Get staff request statistics (Basic PPE management feature)
router.get('/staff/:staffId/stats', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  try {
    // Enforce license for stats access
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.status === 'expired') {
      return res.status(403).json({
        error: 'License Required',
        message: 'A valid license is required to access staff statistics.',
        code: 'LICENSE_REQUIRED'
      });
    }
    
    const db = getDb();
    const { staffId } = req.params;
    
    // Get the staff directory ID for proper linking
    const staffRecord = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM staff_directory WHERE staff_id = ? AND active = 1', [staffId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    let stats;
    
    if (staffRecord) {
      // Query using user_id (staff directory database ID)
      stats = await new Promise((resolve, reject) => {
        db.get(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
            COUNT(CASE WHEN status = 'APPROVED' AND DATE(created_at) >= DATE('now', '-30 days') THEN 1 END) as approved_this_month
          FROM ppe_requests 
          WHERE user_id = ?
        `, [staffRecord.id], (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        });
      });
    } else {
      // Fallback: query by staff_id directly
      stats = await new Promise((resolve, reject) => {
        db.get(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
            COUNT(CASE WHEN status = 'APPROVED' AND DATE(created_at) >= DATE('now', '-30 days') THEN 1 END) as approved_this_month
          FROM ppe_requests 
          WHERE staff_id = ?
        `, [staffId], (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        });
      });
    }
    
    console.log(`✅ Retrieved stats for staff_id: ${staffId} - Total: ${stats.total}, Pending: ${stats.pending}, Approved this month: ${stats.approved_this_month}`);
    
    res.json({
      success: true,
      stats: {
        total: stats.total || 0,
        approved: stats.approved_this_month || 0,
        pending: stats.pending || 0,
        rejected: stats.rejected || 0,
        all_time_approved: stats.approved || 0
      }
    });
    
  } catch (error) {
    console.error('Get staff stats error:', error);
    res.status(500).json({ error: 'Failed to get staff statistics' });
  }
});

// Get staff request history with detailed info (Basic PPE management feature)
router.get('/staff/:staffId/history', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  const { staffId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  
  try {
    // First get the staff directory ID for the staff_id
    const staffRecord = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM staff_directory WHERE staff_id = ? AND active = 1', [staffId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!staffRecord) {
      // Fallback: also search by staff_id directly in case of missing staff directory
      const requestsByStaffId = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            pr.id,
            pr.status,
            pr.notes,
            pr.created_at,
            pr.updated_at,
            GROUP_CONCAT(
              (SELECT symbol || ' ' || name FROM ppe_items WHERE id = pri.ppe_item_id) 
              || ' (' || pri.quantity || ')'
            ) as items
          FROM ppe_requests pr
          LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
          WHERE pr.staff_id = ?
          GROUP BY pr.id, pr.status, pr.notes, pr.created_at, pr.updated_at
          ORDER BY pr.created_at DESC
          LIMIT ?
        `, [staffId, limit], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      
      return res.json({
        success: true,
        requests: requestsByStaffId,
        count: requestsByStaffId.length
      });
    }
    
    // Query using the staff directory ID (user_id)
    const requests = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pr.id,
          pr.status,
          pr.notes,
          pr.created_at,
          pr.updated_at,
          GROUP_CONCAT(
            (SELECT symbol || ' ' || name FROM ppe_items WHERE id = pri.ppe_item_id) 
            || ' (' || pri.quantity || ')'
          ) as items
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        WHERE pr.user_id = ?
        GROUP BY pr.id, pr.status, pr.notes, pr.created_at, pr.updated_at
        ORDER BY pr.created_at DESC
        LIMIT ?
      `, [staffRecord.id, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    console.log(`✅ Retrieved ${requests.length} history records for staff_id: ${staffId} (user_id: ${staffRecord.id})`);
    
    res.json({
      success: true,
      requests,
      count: requests.length
    });
    
  } catch (error) {
    console.error('Get staff history error:', error);
    res.status(500).json({ error: 'Failed to get staff request history' });
  }
});

module.exports = router;