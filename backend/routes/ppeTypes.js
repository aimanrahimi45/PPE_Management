const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all PPE types
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    
    db.all('SELECT * FROM ppe_items ORDER BY name ASC', [], (err, rows) => {
      if (err) {
        console.error('Get PPE types error:', err);
        return res.status(500).json({ error: 'Failed to fetch PPE types' });
      }
      res.json(rows || []);
    });
  } catch (error) {
    console.error('Get PPE types error:', error);
    res.status(500).json({ error: 'Failed to fetch PPE types' });
  }
});

// Get single PPE type by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    
    db.get('SELECT * FROM ppe_items WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('Get PPE type by ID error:', err);
        return res.status(500).json({ error: 'Failed to fetch PPE type' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'PPE type not found' });
      }
      
      res.json(row);
    });
  } catch (error) {
    console.error('Get PPE type by ID error:', error);
    res.status(500).json({ error: 'Failed to fetch PPE type' });
  }
});

// Add new PPE type (admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, type, description, symbol, unitCost, minThreshold, initialStock, selectedStations } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    
    const db = getDb();
    
    // CRITICAL: Check if any active stations exist before allowing PPE creation
    const activeStations = await new Promise((resolve, reject) => {
      db.all('SELECT id FROM stations WHERE active = 1', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    if (activeStations.length === 0) {
      return res.status(400).json({ 
        error: 'Cannot create PPE items without active stations',
        details: 'Please configure and activate at least one station before adding PPE items',
        requiresAction: 'Configure stations first'
      });
    }
    
    const id = uuidv4();
    
    // Start transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Insert PPE type
      db.run(
        `INSERT INTO ppe_items (id, name, type, description, symbol, unit_cost, min_threshold) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, type.toUpperCase(), description, symbol, unitCost || 0, minThreshold || 10],
        function(err) {
          if (err) {
            console.error('Add PPE type error:', err);
            db.run('ROLLBACK');
            if (err.code === 'SQLITE_CONSTRAINT') {
              return res.status(409).json({ error: 'PPE type already exists' });
            }
            return res.status(500).json({ error: 'Failed to add PPE type' });
          }
          
          // Use selected stations or fallback to all active stations for backward compatibility
          let stationsToUse;
          
          if (selectedStations && selectedStations.length > 0) {
            // Validate that selected stations are active
            stationsToUse = activeStations.filter(station => selectedStations.includes(station.id));
            
            if (stationsToUse.length === 0) {
              db.run('ROLLBACK');
              return res.status(400).json({ 
                error: 'None of the selected stations are active',
                details: 'Please select active stations only'
              });
            }
          } else {
            // Fallback to all active stations (backward compatibility)
            stationsToUse = activeStations;
          }
          
          const stations = stationsToUse;
            
          // Create inventory records for each station
            const inventoryPromises = stations.map(station => {
              return new Promise((resolve, reject) => {
                const inventoryId = uuidv4();
                // Use initial stock for main store, 0 for others
                const stockAmount = (station.id === 'store-1' && initialStock !== undefined) ? initialStock : 0;
                
                db.run(
                  `INSERT INTO station_inventory (id, station_id, ppe_item_id, current_stock, min_threshold, critical_threshold, max_capacity) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [inventoryId, station.id, id, stockAmount, minThreshold || 10, Math.floor((minThreshold || 10) / 2), 100],
                  function(inventoryErr) {
                    if (inventoryErr) {
                      console.error('Create inventory record error:', inventoryErr);
                      reject(inventoryErr);
                    } else {
                      resolve();
                    }
                  }
                );
              });
            });
            
            // Wait for all inventory records to be created
            Promise.all(inventoryPromises)
              .then(() => {
                db.run('COMMIT');
                res.status(201).json({
                  success: true,
                  id,
                  message: `PPE type "${name}" added successfully with inventory records`
                });
              })
              .catch((inventoryError) => {
                console.error('Inventory creation error:', inventoryError);
                db.run('ROLLBACK');
                res.status(500).json({ error: 'Failed to create inventory records' });
              });
        }
      );
    });
    
  } catch (error) {
    console.error('Add PPE type error:', error);
    res.status(500).json({ error: 'Failed to add PPE type' });
  }
});

// Update PPE type (admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, description, symbol, unitCost, minThreshold } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    
    const db = getDb();
    
    db.run(
      `UPDATE ppe_items 
       SET name = ?, type = ?, description = ?, symbol = ?, unit_cost = ?, min_threshold = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, type.toUpperCase(), description, symbol, unitCost || 0, minThreshold || 10, id],
      function(err) {
        if (err) {
          console.error('Update PPE type error:', err);
          return res.status(500).json({ error: 'Failed to update PPE type' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'PPE type not found' });
        }
        
        res.json({
          success: true,
          message: `PPE type "${name}" updated successfully`
        });
      }
    );
    
  } catch (error) {
    console.error('Update PPE type error:', error);
    res.status(500).json({ error: 'Failed to update PPE type' });
  }
});

// Delete PPE type (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    
    // Check if PPE type is in use
    db.get('SELECT COUNT(*) as count FROM ppe_request_items WHERE ppe_item_id = ?', [id], (err, result) => {
      if (err) {
        console.error('Check PPE usage error:', err);
        return res.status(500).json({ error: 'Failed to check PPE usage' });
      }
      
      if (result.count > 0) {
        return res.status(409).json({ 
          error: 'Cannot delete PPE type. It is currently in use in requests.' 
        });
      }
      
      // Delete PPE type
      db.run('DELETE FROM ppe_items WHERE id = ?', [id], function(err) {
        if (err) {
          console.error('Delete PPE type error:', err);
          return res.status(500).json({ error: 'Failed to delete PPE type' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'PPE type not found' });
        }
        
        res.json({
          success: true,
          message: 'PPE type deleted successfully'
        });
      });
    });
    
  } catch (error) {
    console.error('Delete PPE type error:', error);
    res.status(500).json({ error: 'Failed to delete PPE type' });
  }
});

// Get PPE type statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    
    db.all(`
      SELECT 
        pi.id,
        pi.name,
        pi.type,
        pi.symbol,
        COUNT(pri.id) as request_count,
        SUM(pri.quantity) as total_quantity_requested
      FROM ppe_items pi
      LEFT JOIN ppe_request_items pri ON pi.id = pri.ppe_item_id
      GROUP BY pi.id, pi.name, pi.type, pi.symbol
      ORDER BY request_count DESC
    `, [], (err, rows) => {
      if (err) {
        console.error('Get PPE stats error:', err);
        return res.status(500).json({ error: 'Failed to fetch PPE statistics' });
      }
      res.json(rows || []);
    });
    
  } catch (error) {
    console.error('Get PPE stats error:', error);
    res.status(500).json({ error: 'Failed to fetch PPE statistics' });
  }
});

module.exports = router;