const express = require('express');
const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const { enforceLicenseCompliance } = require('../middleware/licenseEnforcement');
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess } = require('../middleware/featureFlag');

const router = express.Router();

// Get all inventory with search and pagination (Enterprise API access required)
router.get('/', authenticateToken, enforceLicenseCompliance, checkFeatureAccess('api_access'), async (req, res) => {
  const db = getDb();
  const { search = '', page = 1, limit = 50, sort = 'name' } = req.query;
  
  try {
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        si.id,
        pi.name as item_name,
        pi.type,
        s.name as station_name,
        s.location,
        si.current_stock,
        si.max_capacity,
        pi.min_threshold,
        CASE 
          WHEN si.current_stock <= pi.min_threshold THEN 'LOW'
          WHEN si.current_stock = 0 THEN 'OUT'
          ELSE 'GOOD'
        END as status
      FROM station_inventory si
      JOIN ppe_items pi ON si.ppe_item_id = pi.id
      JOIN stations s ON si.station_id = s.id
      WHERE pi.name LIKE ? OR s.name LIKE ?
    `;
    
    const searchParam = `%${search}%`;
    const params = [searchParam, searchParam];
    
    // Add sorting
    if (sort === 'name') {
      query += ' ORDER BY pi.name ASC';
    } else if (sort === 'stock') {
      query += ' ORDER BY si.current_stock DESC';
    } else if (sort === 'status') {
      query += ' ORDER BY status DESC';
    }
    
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    
    const inventory = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Get total count for pagination
    const totalCount = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM station_inventory si
        JOIN ppe_items pi ON si.ppe_item_id = pi.id
        JOIN stations s ON si.station_id = s.id
        WHERE pi.name LIKE ? OR s.name LIKE ?
      `, [searchParam, searchParam], (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    res.json({
      inventory,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
    
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Update inventory stock
router.put('/:id', async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { current_stock, max_capacity } = req.body;
  
  try {
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE station_inventory 
        SET current_stock = ?, max_capacity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [current_stock, max_capacity, id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Broadcast update to admin dashboard
    const io = req.app.get('io');
    io.to('admin_room').emit('inventory_updated', { inventoryId: id });
    
    res.json({ success: true, message: 'Inventory updated successfully' });
    
  } catch (error) {
    console.error('Update inventory error:', error);
    res.status(500).json({ error: 'Failed to update inventory' });
  }
});

// Add new inventory item to station
router.post('/', async (req, res) => {
  const db = getDb();
  const { station_id, ppe_item_id, current_stock = 0, max_capacity = 100 } = req.body;
  
  try {
    const inventoryId = uuidv4();
    
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO station_inventory (id, station_id, ppe_item_id, current_stock, max_capacity)
        VALUES (?, ?, ?, ?, ?)
      `, [inventoryId, station_id, ppe_item_id, current_stock, max_capacity], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ success: true, inventoryId, message: 'Inventory item added successfully' });
    
  } catch (error) {
    console.error('Add inventory error:', error);
    res.status(500).json({ error: 'Failed to add inventory item' });
  }
});

// Get low stock items
router.get('/low-stock', async (req, res) => {
  const db = getDb();
  
  try {
    const lowStockItems = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          si.id,
          pi.name as item_name,
          s.name as station_name,
          s.location,
          si.current_stock,
          pi.min_threshold,
          CASE 
            WHEN si.current_stock = 0 THEN 'CRITICAL'
            WHEN si.current_stock <= pi.min_threshold THEN 'LOW'
          END as severity
        FROM station_inventory si
        JOIN ppe_items pi ON si.ppe_item_id = pi.id
        JOIN stations s ON si.station_id = s.id
        WHERE si.current_stock <= pi.min_threshold
        ORDER BY si.current_stock ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(lowStockItems);
    
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({ error: 'Failed to fetch low stock items' });
  }
});

module.exports = router;