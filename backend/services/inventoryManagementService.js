const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const auditService = require('./auditService');
const emailService = require('./emailService');

class InventoryManagementService {
  constructor() {
    // Don't store db connection in constructor - get it dynamically
  }

  /**
   * Get database connection dynamically to handle initialization timing
   */
  getDatabaseConnection() {
    const db = getDb();
    if (!db) {
      throw new Error('Database not initialized. Please wait for system startup to complete.');
    }
    return db;
  }

  /**
   * Async wrapper with retry logic for database operations
   */
  async withDatabaseRetry(operation, maxRetries = 3, retryDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const db = this.getDatabaseConnection();
        return await operation(db);
      } catch (error) {
        if (error.message.includes('Database not initialized') && attempt < maxRetries) {
          console.log(`⚠️ Database not ready, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Update stock levels and check thresholds
   */
  async updateStock(stationId, ppeItemId, quantityChange, operation, userId = 'system') {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          // Get current inventory
          db.get(
            'SELECT * FROM station_inventory WHERE station_id = ? AND ppe_item_id = ?',
            [stationId, ppeItemId],
            (err, inventory) => {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }
              
              if (!inventory) {
                db.run('ROLLBACK');
                return reject(new Error('Inventory record not found'));
              }
              
              const newStock = operation === 'ADD' 
                ? inventory.current_stock + quantityChange
                : inventory.current_stock - quantityChange;
              
              if (newStock < 0) {
                db.run('ROLLBACK');
                return reject(new Error('Insufficient stock'));
              }
              
              // Update inventory
              db.run(
                'UPDATE station_inventory SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE station_id = ? AND ppe_item_id = ?',
                [newStock, stationId, ppeItemId],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                  }
                  
                  // Check thresholds and create alerts
                  this.checkStockThresholds(stationId, ppeItemId, newStock, inventory, userId)
                    .then(() => {
                      db.run('COMMIT', (err) => {
                        if (err) {
                          return reject(err);
                        }
                        
                        // Log audit trail
                        auditService.logAction({
                          userId,
                          action: 'UPDATE_STOCK',
                          resourceType: 'INVENTORY',
                          resourceId: `${stationId}:${ppeItemId}`,
                          oldValues: { stock: inventory.current_stock },
                          newValues: { stock: newStock, operation, quantityChange }
                        });
                        
                        resolve({
                          success: true,
                          previousStock: inventory.current_stock,
                          newStock,
                          operation,
                          quantityChange
                        });
                      });
                    })
                    .catch(reject);
                }
              );
            }
          );
        });
      });
    } catch (error) {
      console.error('Update stock error:', error);
      throw error;
    }
  }

  /**
   * Check stock thresholds and create alerts
   */
  async checkStockThresholds(stationId, ppeItemId, currentStock, inventory, userId = 'system') {
    try {
      const { min_threshold, critical_threshold } = inventory;
      
      // Determine alert type and severity
      let alertType = null;
      let severity = 'LOW';
      
      if (currentStock <= critical_threshold) {
        alertType = 'CRITICAL_LOW';
        severity = 'CRITICAL';
      } else if (currentStock <= min_threshold) {
        alertType = 'LOW_STOCK';
        severity = 'WARNING';
      }
      
      if (alertType) {
        // Check if alert already exists
        const existingAlert = await this.getActiveAlert(stationId, ppeItemId, alertType);
        
        if (!existingAlert) {
          await this.createAlert(stationId, ppeItemId, alertType, currentStock, severity, userId);
        }
      } else {
        // Stock is above threshold, resolve any existing alerts
        await this.resolveStockAlerts(stationId, ppeItemId, userId);
      }
      
      return true;
    } catch (error) {
      console.error('Check thresholds error:', error);
      throw error;
    }
  }

  /**
   * Create inventory alert
   */
  async createAlert(stationId, ppeItemId, alertType, currentStock, severity, userId = 'system') {
    try {
      const alertId = uuidv4();
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        // Get threshold value based on alert type
        db.get(
          'SELECT min_threshold, critical_threshold FROM station_inventory WHERE station_id = ? AND ppe_item_id = ?',
          [stationId, ppeItemId],
          (err, inventory) => {
            if (err) return reject(err);
            
            const thresholdValue = alertType === 'CRITICAL_LOW' 
              ? inventory.critical_threshold 
              : inventory.min_threshold;
            
            db.run(
              `INSERT INTO inventory_alerts (id, station_id, ppe_item_id, alert_type, threshold_value, current_stock, severity, status, created_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
              [alertId, stationId, ppeItemId, alertType, thresholdValue, currentStock, severity],
              (err) => {
                if (err) return reject(err);
                
                // Send email alert
                this.sendStockAlert(stationId, ppeItemId, alertType, currentStock, thresholdValue, severity)
                  .then(() => {
                    // Mark alert as sent
                    db.run(
                      'UPDATE inventory_alerts SET alert_sent = TRUE WHERE id = ?',
                      [alertId],
                      (err) => {
                        if (err) console.error('Failed to mark alert as sent:', err);
                      }
                    );
                  })
                  .catch(error => {
                    console.error('Failed to send stock alert email:', error);
                  });
                
                resolve({ success: true, alertId });
              }
            );
          }
        );
      });
    } catch (error) {
      console.error('Create alert error:', error);
      throw error;
    }
  }

  /**
   * Get active alert for station and item
   */
  async getActiveAlert(stationId, ppeItemId, alertType) {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM inventory_alerts WHERE station_id = ? AND ppe_item_id = ? AND alert_type = ? AND status = "ACTIVE"',
          [stationId, ppeItemId, alertType],
          (err, alert) => {
            if (err) return reject(err);
            resolve(alert);
          }
        );
      });
    } catch (error) {
      console.error('Get active alert error:', error);
      throw error;
    }
  }

  /**
   * Resolve stock alerts when stock is replenished
   */
  async resolveStockAlerts(stationId, ppeItemId, userId = 'system') {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.run(
          'UPDATE inventory_alerts SET status = "RESOLVED", acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP WHERE station_id = ? AND ppe_item_id = ? AND status = "ACTIVE"',
          [userId, stationId, ppeItemId],
          (err) => {
            if (err) return reject(err);
            resolve({ success: true });
          }
        );
      });
    } catch (error) {
      console.error('Resolve alerts error:', error);
      throw error;
    }
  }

  /**
   * Send stock alert email
   */
  async sendStockAlert(stationId, ppeItemId, alertType, currentStock, thresholdValue, severity) {
    try {
      const db = this.getDatabaseConnection();
      
      // Get station and item details
      const stationInfo = await new Promise((resolve, reject) => {
        db.get(
          `SELECT s.name as station_name, s.location, pi.name as item_name, pi.type as category 
           FROM stations s, ppe_items pi 
           WHERE s.id = ? AND pi.id = ?`,
          [stationId, ppeItemId],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      });
      
      const subject = `🚨 ${severity === 'CRITICAL' ? 'CRITICAL' : 'LOW'} Stock Alert - ${stationInfo.item_name}`;
      
      const emailData = {
        stationName: stationInfo.station_name,
        stationLocation: stationInfo.location,
        itemName: stationInfo.item_name,
        itemCategory: stationInfo.category,
        currentStock,
        thresholdValue,
        severity,
        alertType
      };
      
      await emailService.sendStockAlert(emailData);
      
      return { success: true };
    } catch (error) {
      console.error('Send stock alert error:', error);
      throw error;
    }
  }

  /**
   * Update inventory thresholds
   */
  async updateThresholds(stationId, ppeItemId, minThreshold, criticalThreshold, userId) {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        // Validate thresholds
        if (criticalThreshold >= minThreshold) {
          return reject(new Error('Critical threshold must be less than minimum threshold'));
        }
        
        db.run(
          'UPDATE station_inventory SET min_threshold = ?, critical_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE station_id = ? AND ppe_item_id = ?',
          [minThreshold, criticalThreshold, stationId, ppeItemId],
          (err) => {
            if (err) return reject(err);
            
            // Log audit trail
            auditService.logAction({
              userId,
              action: 'UPDATE_THRESHOLDS',
              resourceType: 'INVENTORY',
              resourceId: `${stationId}:${ppeItemId}`,
              newValues: { minThreshold, criticalThreshold }
            });
            
            resolve({ success: true });
          }
        );
      });
    } catch (error) {
      console.error('Update thresholds error:', error);
      throw error;
    }
  }

  /**
   * Get inventory with alert status
   */
  async getInventoryWithAlerts(stationId = null) {
    return await this.withDatabaseRetry(async (db) => {
      return new Promise((resolve, reject) => {
        const query = stationId 
          ? `SELECT si.*, s.name as station_name, s.location, pi.name as item_name, pi.type as category,
                    COUNT(ia.id) as active_alerts,
                    MAX(ia.severity) as highest_severity
             FROM station_inventory si
             JOIN stations s ON si.station_id = s.id
             JOIN ppe_items pi ON si.ppe_item_id = pi.id
             LEFT JOIN inventory_alerts ia ON si.station_id = ia.station_id AND si.ppe_item_id = ia.ppe_item_id AND ia.status = 'ACTIVE'
             WHERE si.station_id = ?
             GROUP BY si.id
             ORDER BY si.current_stock ASC`
          : `SELECT si.*, s.name as station_name, s.location, pi.name as item_name, pi.type as category,
                    COUNT(ia.id) as active_alerts,
                    MAX(ia.severity) as highest_severity
             FROM station_inventory si
             JOIN stations s ON si.station_id = s.id
             JOIN ppe_items pi ON si.ppe_item_id = pi.id
             LEFT JOIN inventory_alerts ia ON si.station_id = ia.station_id AND si.ppe_item_id = ia.ppe_item_id AND ia.status = 'ACTIVE'
             GROUP BY si.id
             ORDER BY si.current_stock ASC`;
        
        const params = stationId ? [stationId] : [];
        
        db.all(query, params, (err, rows) => {
          if (err) return reject(err);
          
          // Add stock status
          const inventory = rows.map(item => ({
            ...item,
            stock_status: this.getStockStatus(item.current_stock, item.min_threshold, item.critical_threshold),
            alert_level: item.active_alerts > 0 ? item.highest_severity : 'NONE'
          }));
          
          resolve(inventory);
        });
      });
    });
  }

  /**
   * Get stock status
   */
  getStockStatus(currentStock, minThreshold, criticalThreshold) {
    if (currentStock <= criticalThreshold) {
      return 'CRITICAL';
    } else if (currentStock <= minThreshold) {
      return 'LOW';
    } else {
      return 'GOOD';
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(limit = 50) {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT ia.*, s.name as station_name, s.location, pi.name as item_name, pi.type as category
           FROM inventory_alerts ia
           JOIN stations s ON ia.station_id = s.id
           JOIN ppe_items pi ON ia.ppe_item_id = pi.id
           WHERE ia.status = 'ACTIVE'
           ORDER BY ia.severity DESC, ia.created_at DESC
           LIMIT ?`,
          [limit],
          (err, alerts) => {
            if (err) return reject(err);
            resolve(alerts);
          }
        );
      });
    } catch (error) {
      console.error('Get active alerts error:', error);
      throw error;
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId, userId) {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.run(
          'UPDATE inventory_alerts SET status = "ACKNOWLEDGED", acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?',
          [userId, alertId],
          (err) => {
            if (err) return reject(err);
            
            // Log audit trail
            auditService.logAction({
              userId,
              action: 'ACKNOWLEDGE_ALERT',
              resourceType: 'INVENTORY_ALERT',
              resourceId: alertId
            });
            
            resolve({ success: true });
          }
        );
      });
    } catch (error) {
      console.error('Acknowledge alert error:', error);
      throw error;
    }
  }

  /**
   * Bulk restock all items in a station to a specific quantity
   * Auto-initializes inventory if station has no inventory items
   */
  async bulkRestock(stationId, quantity, userId = 'system') {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          // Get all inventory items for the station
          db.all(
            'SELECT * FROM station_inventory WHERE station_id = ?',
            [stationId],
            async (err, inventoryItems) => {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }
              
              // If no inventory items exist, auto-initialize them
              if (inventoryItems.length === 0) {
                console.log(`No inventory found for station ${stationId}. Auto-initializing...`);
                
                try {
                  await this.autoInitializeStationInventory(stationId, db);
                  
                  // Re-fetch inventory items after initialization
                  db.all(
                    'SELECT * FROM station_inventory WHERE station_id = ?',
                    [stationId],
                    (refetchErr, refetchedItems) => {
                      if (refetchErr) {
                        db.run('ROLLBACK');
                        return reject(refetchErr);
                      }
                      
                      if (refetchedItems.length === 0) {
                        db.run('ROLLBACK');
                        return reject(new Error('Failed to initialize inventory for station'));
                      }
                      
                      this.processBulkRestock(refetchedItems, quantity, userId, db, resolve, reject);
                    }
                  );
                } catch (initError) {
                  db.run('ROLLBACK');
                  return reject(initError);
                }
              } else {
                this.processBulkRestock(inventoryItems, quantity, userId, db, resolve, reject);
              }
            }
          );
        });
      });
    } catch (error) {
      console.error('Bulk restock error:', error);
      throw error;
    }
  }

  /**
   * Auto-initialize inventory for a station with all available PPE items
   */
  async autoInitializeStationInventory(stationId, db) {
    return new Promise((resolve, reject) => {
      // Get all PPE items
      db.all('SELECT * FROM ppe_items', [], (err, ppeItems) => {
        if (err) {
          return reject(err);
        }
        
        if (ppeItems.length === 0) {
          return reject(new Error('No PPE items found in system'));
        }
        
        console.log(`Initializing ${ppeItems.length} PPE items for station ${stationId}`);
        
        let itemsInitialized = 0;
        
        ppeItems.forEach(ppeItem => {
          const { v4: uuidv4 } = require('uuid');
          const inventoryId = uuidv4();
          
          db.run(
            `INSERT INTO station_inventory 
             (id, station_id, ppe_item_id, current_stock, max_capacity, min_threshold, critical_threshold, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              inventoryId,
              stationId,
              ppeItem.id,
              0, // Start with 0 stock
              100, // Default max capacity
              ppeItem.min_threshold || 5, // Use PPE item's threshold or default
              Math.floor((ppeItem.min_threshold || 5) / 2) // Critical is half of min
            ],
            function(insertErr) {
              if (insertErr) {
                console.error(`Failed to initialize inventory for PPE item ${ppeItem.name}:`, insertErr);
                // Don't reject here, continue with other items
              } else {
                console.log(`✅ Initialized inventory for ${ppeItem.name}`);
              }
              
              itemsInitialized++;
              
              if (itemsInitialized === ppeItems.length) {
                resolve();
              }
            }
          );
        });
      });
    });
  }

  /**
   * Process bulk restock for inventory items
   */
  processBulkRestock(inventoryItems, quantity, userId, db, resolve, reject) {
    const auditService = require('./auditService');
    let itemsProcessed = 0;
    const updatedItems = [];
    
    inventoryItems.forEach(item => {
      const oldStock = item.current_stock;
      
      // Update stock to the specified quantity
      db.run(
        'UPDATE station_inventory SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantity, item.id],
        function(updateErr) {
          if (updateErr) {
            db.run('ROLLBACK');
            return reject(updateErr);
          }
          
          updatedItems.push({
            ppe_item_id: item.ppe_item_id,
            old_stock: oldStock,
            new_stock: quantity,
            difference: quantity - oldStock
          });
          
          // Log audit trail for each item
          auditService.logAction({
            userId,
            action: 'BULK_RESTOCK',
            resourceType: 'STATION_INVENTORY',
            resourceId: item.id,
            oldValues: { current_stock: oldStock },
            newValues: { current_stock: quantity },
            metadata: {
              station_id: item.station_id,
              ppe_item_id: item.ppe_item_id,
              difference: quantity - oldStock
            }
          });
          
          itemsProcessed++;
          
          if (itemsProcessed === inventoryItems.length) {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                return reject(commitErr);
              }
              
              resolve({
                success: true,
                updated_items: updatedItems.length,
                items: updatedItems,
                message: `Successfully restocked ${updatedItems.length} items to ${quantity} units each`
              });
            });
          }
        }
      );
    });
  }

  /**
   * Bulk restock all stations at once (more efficient)
   */
  async bulkRestockAllStations(quantity, userId = 'system') {
    try {
      const db = this.getDatabaseConnection();
      
      return new Promise((resolve, reject) => {
        // First get all stations
        db.all('SELECT id, name FROM stations', [], async (err, stations) => {
          if (err) {
            return reject(err);
          }
          
          if (stations.length === 0) {
            return reject(new Error('No stations found'));
          }
          
          console.log(`Bulk restocking ${stations.length} stations to ${quantity} units each`);
          
          let successCount = 0;
          let failCount = 0;
          let totalItemsRestocked = 0;
          const results = [];
          
          // Process each station
          for (const station of stations) {
            try {
              const result = await this.bulkRestock(station.id, quantity, userId);
              
              if (result.success) {
                successCount++;
                totalItemsRestocked += result.updated_items || 0;
                results.push({
                  stationId: station.id,
                  stationName: station.name,
                  success: true,
                  itemsRestocked: result.updated_items || 0,
                  message: result.message
                });
                console.log(`✅ Restocked ${station.name}: ${result.updated_items} items`);
              } else {
                failCount++;
                results.push({
                  stationId: station.id,
                  stationName: station.name,
                  success: false,
                  error: result.error || 'Unknown error'
                });
                console.error(`❌ Failed to restock ${station.name}`);
              }
            } catch (stationError) {
              failCount++;
              results.push({
                stationId: station.id,
                stationName: station.name,
                success: false,
                error: stationError.message
              });
              console.error(`❌ Error restocking ${station.name}:`, stationError.message);
            }
          }
          
          resolve({
            success: successCount > 0,
            message: `Bulk restock completed: ${successCount} successful, ${failCount} failed`,
            totalStations: stations.length,
            successfulStations: successCount,
            failedStations: failCount,
            totalItemsRestocked,
            details: results
          });
        });
      });
    } catch (error) {
      console.error('Bulk restock all stations error:', error);
      throw error;
    }
  }
}

module.exports = new InventoryManagementService();