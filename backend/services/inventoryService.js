const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const notificationHelper = require('./notificationHelper');

// Check for low stock items and generate alerts
async function checkLowStock(io) {
  const db = getDb();
  
  try {
    console.log('Running low stock check...');
    
    // Get items below threshold
    const lowStockItems = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          si.id,
          si.station_id,
          si.ppe_item_id,
          si.current_stock,
          pi.name as item_name,
          pi.min_threshold,
          s.name as station_name,
          s.location
        FROM station_inventory si
        JOIN ppe_items pi ON si.ppe_item_id = pi.id
        JOIN stations s ON si.station_id = s.id
        WHERE si.current_stock <= pi.min_threshold
        AND s.active = 1
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    for (const item of lowStockItems) {
      // Check if alert already exists for this item
      const existingAlert = await new Promise((resolve, reject) => {
        db.get(`
          SELECT id FROM alerts 
          WHERE type = 'LOW_STOCK' 
          AND station_id = ? 
          AND message LIKE ?
          AND resolved = 0
        `, [item.station_id, `%${item.item_name}%`], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (!existingAlert) {
        // Create new alert
        const alertId = uuidv4();
        const severity = item.current_stock === 0 ? 'CRITICAL' : 'HIGH';
        const title = item.current_stock === 0 ? 'Out of Stock Alert' : 'Low Stock Alert';
        const message = `${item.item_name} at ${item.station_name} is ${item.current_stock === 0 ? 'out of stock' : 'running low'} (${item.current_stock} remaining)`;
        
        await new Promise((resolve, reject) => {
          db.run(`
            INSERT INTO alerts (id, type, title, message, severity, station_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [alertId, 'LOW_STOCK', title, message, severity, item.station_id], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        console.log(`Created ${severity} alert for ${item.item_name} at ${item.station_name}`);
        
        // Broadcast alert to admin dashboard
        if (io) {
          io.to('admin_room').emit('low_stock_alert', {
            alertId,
            stationId: item.station_id,
            stationName: item.station_name,
            itemName: item.item_name,
            currentStock: item.current_stock,
            severity
          });
        }
        
        // Send push notification based on preferences
        try {
          const notificationType = severity === 'CRITICAL' ? 'stock_critical' : 'stock_low';
          await notificationHelper.sendNotificationIfEnabled(notificationType, {
            stationName: item.station_name,
            itemName: item.item_name,
            currentStock: item.current_stock,
            threshold: item.min_threshold
          });
        } catch (notificationError) {
          console.error('Failed to send low stock push notification:', notificationError);
        }
      }
    }
    
    console.log(`Low stock check completed. Found ${lowStockItems.length} items below threshold.`);
    
  } catch (error) {
    console.error('Low stock check error:', error);
  }
}

// Update inventory levels after PPE request
async function updateInventoryAfterRequest(stationId, items, io) {
  const db = getDb();
  
  try {
    for (const item of items) {
      // Update stock level
      await new Promise((resolve, reject) => {
        db.run(`
          UPDATE station_inventory 
          SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
          WHERE station_id = ? AND ppe_item_id = ?
        `, [item.quantity, stationId, item.ppeItemId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Check if item is now below threshold
      const stockInfo = await new Promise((resolve, reject) => {
        db.get(`
          SELECT 
            si.current_stock,
            pi.min_threshold,
            pi.name as item_name,
            s.name as station_name
          FROM station_inventory si
          JOIN ppe_items pi ON si.ppe_item_id = pi.id
          JOIN stations s ON si.station_id = s.id
          WHERE si.station_id = ? AND si.ppe_item_id = ?
        `, [stationId, item.ppeItemId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (stockInfo && stockInfo.current_stock <= stockInfo.min_threshold) {
        // Trigger immediate low stock check for this item
        await checkLowStock(io);
      }
    }
    
    // Broadcast inventory update
    if (io) {
      io.to('admin_room').emit('inventory_updated', {
        stationId,
        items: items.map(item => ({
          ppeItemId: item.ppeItemId,
          quantityIssued: item.quantity
        }))
      });
    }
    
  } catch (error) {
    console.error('Update inventory error:', error);
    throw error;
  }
}

// Get inventory statistics
async function getInventoryStats() {
  const db = getDb();
  
  try {
    const stats = await Promise.all([
      // Total stock across all stations
      new Promise((resolve, reject) => {
        db.get('SELECT SUM(current_stock) as total FROM station_inventory', (err, row) => {
          if (err) reject(err);
          else resolve(row.total || 0);
        });
      }),
      
      // Low stock items count
      new Promise((resolve, reject) => {
        db.get(`
          SELECT COUNT(*) as count 
          FROM station_inventory si
          JOIN ppe_items pi ON si.ppe_item_id = pi.id
          WHERE si.current_stock <= pi.min_threshold
        `, (err, row) => {
          if (err) reject(err);
          else resolve(row.count || 0);
        });
      }),
      
      // Out of stock items
      new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM station_inventory WHERE current_stock = 0', (err, row) => {
          if (err) reject(err);
          else resolve(row.count || 0);
        });
      })
    ]);
    
    return {
      totalStock: stats[0],
      lowStockItems: stats[1],
      outOfStockItems: stats[2]
    };
    
  } catch (error) {
    console.error('Get inventory stats error:', error);
    throw error;
  }
}

// Restock inventory item
async function restockItem(stationId, ppeItemId, quantity, io) {
  const db = getDb();
  
  try {
    await new Promise((resolve, reject) => {
      db.run(`
        UPDATE station_inventory 
        SET current_stock = current_stock + ?, last_restocked = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE station_id = ? AND ppe_item_id = ?
      `, [quantity, stationId, ppeItemId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Broadcast restock update
    if (io) {
      io.to('admin_room').emit('inventory_restocked', {
        stationId,
        ppeItemId,
        quantity
      });
    }
    
    console.log(`Restocked ${quantity} items for station ${stationId}`);
    
  } catch (error) {
    console.error('Restock error:', error);
    throw error;
  }
}

module.exports = {
  checkLowStock,
  updateInventoryAfterRequest,
  getInventoryStats,
  restockItem
};