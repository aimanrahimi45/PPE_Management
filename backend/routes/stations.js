const express = require('express');
const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const { checkFeatureAccess } = require('../middleware/featureFlag');

const router = express.Router();

// Get all stations (Basic PPE management feature)
router.get('/', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  
  try {
    const stations = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          s.*,
          COUNT(si.id) as inventory_count,
          SUM(si.current_stock) as total_stock
        FROM stations s
        LEFT JOIN station_inventory si ON s.id = si.station_id
        GROUP BY s.id
        ORDER BY s.name
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({ stations });
    
  } catch (error) {
    console.error('Get stations error:', error);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

// Get station by ID with inventory
// Get specific station (Basic PPE management feature)
router.get('/:id', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  
  try {
    const station = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!station) {
      return res.status(404).json({ error: 'Station not found' });
    }
    
    const inventory = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          si.*,
          pi.name as item_name,
          pi.type,
          pi.min_threshold
        FROM station_inventory si
        JOIN ppe_items pi ON si.ppe_item_id = pi.id
        WHERE si.station_id = ?
        ORDER BY pi.name
      `, [id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      ...station,
      inventory
    });
    
  } catch (error) {
    console.error('Get station error:', error);
    res.status(500).json({ error: 'Failed to fetch station' });
  }
});

// Create new station
// Create new station (Multi-location required - Pro+ only)
router.post('/', async (req, res) => {
  const db = getDb();
  const { name, location, description } = req.body;
  
  try {
    // Check license and station limits
    const licenseService = require('../services/licenseService');
    const licenseStatus = await licenseService.getLicenseStatus();
    
    // Check if user has basic station management OR multi-location
    const hasBasicStations = await licenseService.isFeatureEnabled('basic_station_management');
    const hasMultiLocation = await licenseService.isFeatureEnabled('multi_location');
    
    if (!hasBasicStations && !hasMultiLocation) {
      return res.status(403).json({
        error: 'Feature not available in your current license',
        feature: 'station_management',
        message: 'Station management is not available in your current subscription plan. Please upgrade your license.',
        upgrade_required: true
      });
    }
    
    // Check station count limit for basic users
    if (hasBasicStations && !hasMultiLocation) {
      const stationCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM stations WHERE active = 1', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });
      
      if (stationCount >= 1) {
        return res.status(403).json({
          error: 'Station limit reached',
          message: 'Basic plan allows only 1 station. Upgrade to Pro for unlimited stations.',
          current_stations: stationCount,
          max_stations: 1,
          upgrade_required: true
        });
      }
    }
    
    const stationId = uuidv4();
    const qrCode = `STATION_${stationId.slice(0, 8).toUpperCase()}`;
    
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO stations (id, name, location, qr_code, description)
        VALUES (?, ?, ?, ?, ?)
      `, [stationId, name, location, qrCode, description], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ 
      success: true, 
      stationId, 
      qrCode,
      message: 'Station created successfully' 
    });
    
  } catch (error) {
    console.error('Create station error:', error);
    res.status(500).json({ error: 'Failed to create station' });
  }
});

// Update station
// Enhanced Update station (Basic PPE management - all tiers can edit existing stations)
// Dynamic, schema-aware, and reset-proof implementation
router.put('/:id', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  
  try {
    console.log(`🔧 Station edit request for ${id}: ${JSON.stringify(req.body)}`);
    
    // First check if station exists
    const existingStation = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!existingStation) {
      console.log(`❌ Station not found: ${id}`);
      return res.status(404).json({ 
        error: 'Station not found',
        stationId: id 
      });
    }
    
    // Core editable fields that should exist in any station table
    const coreFields = ['name', 'location', 'description', 'active', 'qr_code'];
    const updateFields = [];
    const updateValues = [];
    
    // Build update query dynamically, only including provided fields
    coreFields.forEach(field => {
      if (req.body.hasOwnProperty(field) && req.body[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(req.body[field]);
      }
    });
    
    // Validation
    if (updateFields.length === 0) {
      console.log(`⚠️ No valid fields provided for station ${id}`);
      return res.status(400).json({ 
        error: 'No valid fields provided for update',
        allowedFields: coreFields,
        providedFields: Object.keys(req.body)
      });
    }
    
    // Validate name if provided
    if (req.body.hasOwnProperty('name')) {
      if (!req.body.name || req.body.name.toString().trim().length === 0) {
        return res.status(400).json({ error: 'Station name cannot be empty' });
      }
      
      // Check for duplicate name
      if (req.body.name.toString().trim() !== existingStation.name) {
        const duplicateCheck = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM stations WHERE name = ? AND id != ?', [req.body.name.toString().trim(), id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (duplicateCheck) {
          return res.status(400).json({ 
            error: 'Station with this name already exists',
            existingStationId: duplicateCheck.id 
          });
        }
      }
    }
    
    // Validate location if provided
    if (req.body.hasOwnProperty('location') && (!req.body.location || req.body.location.toString().trim().length === 0)) {
      return res.status(400).json({ error: 'Station location cannot be empty' });
    }
    
    // Add updated_at and prepare final query
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id); // For WHERE clause
    
    const query = `UPDATE stations SET ${updateFields.join(', ')} WHERE id = ?`;
    console.log(`📝 Executing query: ${query}`);
    console.log(`📝 With values: ${JSON.stringify(updateValues)}`);
    
    // Perform the update
    const result = await new Promise((resolve, reject) => {
      db.run(query, updateValues, function(err) {
        if (err) {
          console.error(`❌ Database error during station update:`, err);
          reject(err);
        } else {
          console.log(`✅ Update result: ${this.changes} rows changed`);
          resolve(this);
        }
      });
    });
    
    if (result.changes === 0) {
      return res.status(404).json({ 
        error: 'Station not found or no changes made',
        stationId: id 
      });
    }
    
    // Get the updated station data
    const updatedStation = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    const updatedFieldNames = coreFields.filter(field => req.body.hasOwnProperty(field));
    console.log(`✅ Station updated successfully: ${updatedStation.name} (${id})`);
    console.log(`✅ Updated fields: ${updatedFieldNames.join(', ')}`);
    
    res.json({ 
      success: true, 
      message: 'Station updated successfully',
      station: updatedStation,
      updatedFields: updatedFieldNames
    });
    
  } catch (error) {
    console.error('❌ Update station error:', error);
    res.status(500).json({ 
      error: 'Failed to update station',
      message: error.message,
      stationId: id
    });
  }
});

// Delete station
// Delete station (Multi-location required - Pro+ only)  
router.delete('/:id', checkFeatureAccess('multi_location'), async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { force, transferTo } = req.query; // Support force delete and inventory transfer
  
  try {
    // Check if station exists
    const station = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!station) {
      return res.status(404).json({ error: 'Station not found' });
    }
    
    // Check for dependencies
    const dependencies = await checkStationDependencies(db, id);
    
    if (dependencies.hasInventory && !force && !transferTo) {
      return res.status(400).json({ 
        error: 'Cannot delete station with existing inventory',
        details: {
          inventoryCount: dependencies.inventoryCount,
          totalStock: dependencies.totalStock,
          inventoryItems: dependencies.inventoryItems,
          options: {
            transfer: 'Transfer inventory to another station',
            force: 'Force delete (will lose all inventory data)'
          }
        }
      });
    }
    
    if (dependencies.hasPendingRequests && !force) {
      return res.status(400).json({
        error: 'Cannot delete station with pending PPE requests',
        details: {
          pendingRequests: dependencies.pendingRequests,
          options: {
            force: 'Force delete (will cancel pending requests)'
          }
        }
      });
    }
    
    // Handle inventory transfer if specified
    if (transferTo && dependencies.hasInventory) {
      await transferStationInventory(db, id, transferTo);
    }
    
    // Handle force delete - clean up all related data
    if (force) {
      await forceDeleteStation(db, id);
    } else {
      // Regular delete (only if no dependencies)
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM stations WHERE id = ?', [id], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    const action = force ? 'Force deleted' : transferTo ? 'Deleted (inventory transferred)' : 'Deleted';
    res.json({ 
      success: true, 
      message: `Station ${action} successfully`,
      details: transferTo ? { inventoryTransferredTo: transferTo } : null
    });
    
  } catch (error) {
    console.error('Delete station error:', error);
    res.status(500).json({ error: 'Failed to delete station' });
  }
});

// Helper function to check station dependencies
async function checkStationDependencies(db, stationId) {
  // Check inventory
  const inventoryData = await new Promise((resolve, reject) => {
    db.all(`
      SELECT si.*, pi.name as ppe_name 
      FROM station_inventory si 
      JOIN ppe_items pi ON si.ppe_item_id = pi.id 
      WHERE si.station_id = ?
    `, [stationId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  
  // Check pending requests
  const pendingRequests = await new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM ppe_requests 
      WHERE station_id = ? AND status IN ('PENDING', 'APPROVED')
    `, [stationId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  
  return {
    hasInventory: inventoryData.length > 0,
    inventoryCount: inventoryData.length,
    totalStock: inventoryData.reduce((sum, item) => sum + (item.current_stock || 0), 0),
    inventoryItems: inventoryData.map(item => ({
      name: item.ppe_name,
      stock: item.current_stock
    })),
    hasPendingRequests: pendingRequests.length > 0,
    pendingRequests: pendingRequests.length
  };
}

// Helper function to transfer inventory to another station
async function transferStationInventory(db, fromStationId, toStationId) {
  // Verify target station exists
  const targetStation = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM stations WHERE id = ?', [toStationId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
  
  if (!targetStation) {
    throw new Error(`Target station ${toStationId} not found`);
  }
  
  // Get all inventory from source station
  const inventory = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM station_inventory WHERE station_id = ?', [fromStationId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
  
  // Transfer each inventory item
  for (const item of inventory) {
    // Check if target station already has this PPE type
    const existingInventory = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM station_inventory WHERE station_id = ? AND ppe_item_id = ?', 
        [toStationId, item.ppe_item_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (existingInventory) {
      // Add to existing inventory
      await new Promise((resolve, reject) => {
        db.run(`
          UPDATE station_inventory 
          SET current_stock = current_stock + ?, 
              updated_at = CURRENT_TIMESTAMP
          WHERE station_id = ? AND ppe_item_id = ?
        `, [item.current_stock, toStationId, item.ppe_item_id], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      // Create new inventory record
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO station_inventory 
          (id, station_id, ppe_item_id, current_stock, max_capacity, min_threshold, critical_threshold, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [uuidv4(), toStationId, item.ppe_item_id, item.current_stock, 
            item.max_capacity, item.min_threshold, item.critical_threshold], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
  
  // Delete original inventory records
  await new Promise((resolve, reject) => {
    db.run('DELETE FROM station_inventory WHERE station_id = ?', [fromStationId], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Helper function to force delete station and clean up all related data
async function forceDeleteStation(db, stationId) {
  // Delete all related data in correct order (to avoid foreign key issues)
  const cleanup = [
    'DELETE FROM station_inventory WHERE station_id = ?',
    'UPDATE ppe_requests SET status = \'CANCELLED\', notes = \'Station deleted\' WHERE station_id = ? AND status IN (\'PENDING\', \'APPROVED\')',
    'DELETE FROM inventory_alerts WHERE station_id = ?',
    'DELETE FROM qr_tokens WHERE station_id = ?',
    'DELETE FROM alerts WHERE station_id = ?',
    'DELETE FROM stations WHERE id = ?'
  ];
  
  for (const query of cleanup) {
    await new Promise((resolve, reject) => {
      db.run(query, [stationId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = router;