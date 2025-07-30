const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { authenticateToken } = require('../middleware/auth');
const { validatePPERequest } = require('../middleware/validation');
const auditService = require('../services/auditService');
const staffPPEService = require('../services/staffPPEService');
const emailService = require('../services/emailService');
const staffVerificationService = require('../services/staffVerificationService');

const router = express.Router();

// Handle HTML form submission (for backup interface)
router.post('/request-form', async (req, res) => {
  const { stationId, items = [], gloves_qty = 0 } = req.body;
  
  try {
    const selectedItems = [];
    
    // Add checkbox items
    if (Array.isArray(items)) {
      items.forEach(item => {
        selectedItems.push({ ppeItemId: item, quantity: 1 });
      });
    } else if (items) {
      selectedItems.push({ ppeItemId: items, quantity: 1 });
    }
    
    // Add gloves if quantity > 0
    const glovesQty = parseInt(gloves_qty) || 0;
    if (glovesQty > 0) {
      selectedItems.push({ ppeItemId: 'gloves', quantity: glovesQty });
    }
    
    if (selectedItems.length === 0) {
      return res.send(`
        <html><body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>❌ No PPE Items Selected</h2>
          <p>Please go back and select at least one PPE item.</p>
          <button onclick="history.back()">← Go Back</button>
        </body></html>
      `);
    }
    
    // Process the request (simplified version)
    res.send(`
      <html><body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>✅ PPE Request Submitted Successfully!</h2>
        <p>Station: ${stationId}</p>
        <p>Items requested: ${selectedItems.map(item => `${item.ppeItemId} (${item.quantity})`).join(', ')}</p>
        <p>Your request has been processed.</p>
        <a href="/no-js.html">← Submit Another Request</a>
      </body></html>
    `);
    
  } catch (error) {
    console.error('Form submission error:', error);
    res.status(500).send(`
      <html><body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>❌ Error Processing Request</h2>
        <p>Please try again or contact support.</p>
        <button onclick="history.back()">← Go Back</button>
      </body></html>
    `);
  }
});

// Submit PPE request
router.post('/request', validatePPERequest, async (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  
  try {
    const { userId = 'anonymous', stationId, items, notes, staffId, staffName, department } = req.body;
    const requestId = uuidv4();
    
    
    // Get client info for audit trail
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    // Verify staff ID and get staff directory record ID
    let staffDirectoryId = null;
    if (staffId) {
      const staffVerification = await staffVerificationService.verifyStaffId(staffId);
      
      if (!staffVerification.valid) {
        return res.status(400).json({ 
          error: 'Staff verification failed',
          message: staffVerification.message,
          code: 'INVALID_STAFF_ID'
        });
      }
      
      // Get the staff directory record ID for this staff_id
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
      
      // Use verified staff information
      const verifiedStaff = staffVerification.staff;
      req.body.staffName = verifiedStaff.name;
      req.body.department = verifiedStaff.department;
      
      console.log(`✅ Staff verified: ${verifiedStaff.name} (${staffId}) from ${verifiedStaff.department}`);
    }
    
    // Debug the incoming request
    console.log('=== PPE REQUEST DEBUG ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Station ID:', stationId);
    console.log('Station ID type:', typeof stationId);
    console.log('Station ID length:', stationId ? stationId.length : 'null/undefined');
    console.log('Items:', JSON.stringify(items, null, 2));
    
    // Validate station exists and is active
    const station = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM stations WHERE id = ? AND active = 1', [stationId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    console.log('Station query result:', station);
    
    if (!station) {
      return res.status(400).json({ error: 'Invalid or inactive station' });
    }
    
    // Check stock availability
    const stockCheck = await checkStockAvailability(stationId, items);
    if (!stockCheck.available) {
      return res.status(400).json({ 
        error: 'Insufficient stock', 
        unavailableItems: stockCheck.unavailableItems 
      });
    }
    
    // Begin transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Dynamic PPE request creation with auto-column addition
      const ensurePPERequestSchema = () => {
        return new Promise((resolve, reject) => {
          // Get current table structure
          db.all(`PRAGMA table_info(ppe_requests)`, (err, columns) => {
            if (err) {
              reject(err);
              return;
            }
            
            const columnNames = columns.map(col => col.name);
            console.log('PPE requests table columns:', columnNames);
            
            // Define optional columns we might need
            const desiredColumns = [
              { name: 'staff_name', type: 'TEXT' },
              { name: 'staff_department', type: 'TEXT' }
            ];
            
            const missingColumns = desiredColumns.filter(col => !columnNames.includes(col.name));
            
            if (missingColumns.length === 0) {
              console.log('ℹ️  All PPE request columns exist');
              resolve(columnNames);
              return;
            }
            
            console.log(`🔧 Adding ${missingColumns.length} missing PPE request columns...`);
            
            // Add columns sequentially
            const addNextColumn = (index) => {
              if (index >= missingColumns.length) {
                // All columns added, get updated list
                db.all(`PRAGMA table_info(ppe_requests)`, (err, newColumns) => {
                  if (err) {
                    reject(err);
                    return;
                  }
                  const updatedColumnNames = newColumns.map(col => col.name);
                  console.log('✅ PPE request columns updated');
                  resolve(updatedColumnNames);
                });
                return;
              }
              
              const column = missingColumns[index];
              
              db.run(`ALTER TABLE ppe_requests ADD COLUMN ${column.name} ${column.type}`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                  console.log(`⚠️  Could not add column '${column.name}': ${err.message}`);
                } else {
                  console.log(`✅ Added PPE request column: ${column.name}`);
                }
                addNextColumn(index + 1);
              });
            };
            
            addNextColumn(0);
          });
        });
      };
      
      // Ensure schema then create request
      ensurePPERequestSchema()
        .then((columnNames) => {
          // Build dynamic INSERT based on available columns
          const baseData = {
            id: requestId,
            user_id: staffDirectoryId || userId,  // Use staff directory ID if available
            station_id: stationId,
            status: 'PENDING',
            notes: notes
          };
          
          // Add optional columns if they exist
          if (columnNames.includes('staff_id')) {
            baseData.staff_id = staffId;
          }
          if (columnNames.includes('staff_name')) {
            baseData.staff_name = staffName;
          }
          if (columnNames.includes('staff_department')) {
            baseData.staff_department = department;
          }
          
          const insertColumns = Object.keys(baseData).join(', ');
          const placeholders = Object.keys(baseData).map(() => '?').join(', ');
          const values = Object.values(baseData);
          
          const query = `INSERT INTO ppe_requests (${insertColumns}) VALUES (${placeholders})`;
          console.log('Dynamic PPE request insert:', query, values);
          
          db.run(query, values, function(err) {
            if (err) {
              console.error('PPE request insert error:', err);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to create request' });
            }
          
          
          // Add request items and update inventory
          let itemsProcessed = 0;
          let hasError = false;
          
          items.forEach(item => {
            if (hasError) return;
            
            const itemId = uuidv4();
            
            // Insert request item
            db.run(
              'INSERT INTO ppe_request_items (id, request_id, ppe_item_id, quantity, issued) VALUES (?, ?, ?, ?, ?)',
              [itemId, requestId, item.ppeItemId, item.quantity, 1],
              function(err) {
                if (err) {
                  hasError = true;
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Failed to add request items' });
                }
                
                // Don't update inventory yet - wait for approval
                itemsProcessed++;
                
                if (itemsProcessed === items.length && !hasError) {
                  db.run('COMMIT', async (err) => {
                    if (err) {
                      return res.status(500).json({ error: 'Failed to commit transaction' });
                    }
                    
                    // Log audit trail for PPE request
                    await auditService.logAction({
                      userId: userId,
                      action: 'CREATE_PPE_REQUEST',
                      resourceType: 'PPE_REQUEST',
                      resourceId: requestId,
                      newValues: {
                        requestId,
                        stationId,
                        items,
                        notes,
                        staffId,
                        staffName,
                        department
                      },
                      ipAddress: clientIP,
                      userAgent: userAgent
                    });
                    
                    // Create staff PPE assignments for tracking (but not issued yet)
                    if (staffId && staffName) {
                      for (const item of items) {
                        try {
                          await staffPPEService.assignPPE({
                            staffId,
                            staffName,
                            department,
                            ppeItemId: item.ppeItemId,
                            quantity: item.quantity,
                            notes: `Pending approval - Request ${requestId}`,
                            issuedBy: userId,
                            ipAddress: clientIP,
                            userAgent: userAgent
                          });
                        } catch (assignErr) {
                          console.error('Failed to create staff assignment:', assignErr);
                        }
                      }
                    }
                    
                    // Notify Safety Officer about new request
                    io.to('admin_room').emit('new_ppe_request', {
                      requestId,
                      staffName,
                      staffId,
                      department,
                      items: items.map(item => ({
                        ppeItemId: item.ppeItemId,
                        quantity: item.quantity
                      })),
                      status: 'PENDING',
                      timestamp: new Date().toISOString()
                    });
                    
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

                      const emailData = {
                        requestId,
                        staffName: staffName || 'Unknown',
                        staffId: staffId || 'N/A',
                        department: department || 'N/A',
                        items: ppeItemsWithNames.join(', '),
                        stationName: station.name,
                        createdAt: new Date().toISOString() // Let timezoneUtils.formatForEmail() handle Malaysia timezone
                      };
                      
                      await emailService.notifyNewPPERequest(emailData);
                    } catch (emailError) {
                      console.error('Failed to send Safety Officer notification email:', emailError);
                    }
                    
                    res.json({
                      success: true,
                      requestId,
                      message: 'PPE request submitted successfully and sent for approval',
                      status: 'PENDING',
                      issuedItems: items
                    });
                  });
                }
              }
            );
          });
        }
      );
        })
        .catch((err) => {
          console.error('PPE request schema error:', err);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Database schema error' });
        });
    });
    
  } catch (error) {
    console.error('PPE request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get available PPE items for a station
router.get('/station/:stationId/available', async (req, res) => {
  const db = getDb();
  const { stationId } = req.params;
  
  try {
    const availableItems = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pi.id,
          pi.name,
          pi.type,
          pi.description,
          si.current_stock,
          si.max_capacity,
          CASE WHEN si.current_stock > 0 THEN 1 ELSE 0 END as available
        FROM ppe_items pi
        JOIN station_inventory si ON pi.id = si.ppe_item_id
        WHERE si.station_id = ?
        ORDER BY pi.name
      `, [stationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json(availableItems);
  } catch (error) {
    console.error('Get available items error:', error);
    res.status(500).json({ error: 'Failed to fetch available items' });
  }
});

// Helper function to check stock availability
async function checkStockAvailability(stationId, items) {
  const db = getDb();
  
  const unavailableItems = [];
  
  for (const item of items) {
    const stock = await new Promise((resolve, reject) => {
      db.get(
        'SELECT current_stock FROM station_inventory WHERE station_id = ? AND ppe_item_id = ?',
        [stationId, item.ppeItemId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    if (!stock || stock.current_stock < item.quantity) {
      unavailableItems.push({
        ppeItemId: item.ppeItemId,
        requested: item.quantity,
        available: stock ? stock.current_stock : 0
      });
    }
  }
  
  return {
    available: unavailableItems.length === 0,
    unavailableItems
  };
}

// Helper function to check low stock after request
async function checkLowStockAfterRequest(stationId, items, io) {
  const db = getDb();
  
  for (const item of items) {
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
      // Create low stock alert
      const alertId = uuidv4();
      
      db.run(`
        INSERT INTO alerts (id, type, title, message, severity, station_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        alertId,
        'LOW_STOCK',
        'Low Stock Alert',
        `${stockInfo.item_name} stock at ${stockInfo.station_name} is running low (${stockInfo.current_stock} remaining)`,
        stockInfo.current_stock === 0 ? 'CRITICAL' : 'HIGH',
        stationId
      ]);
      
      // Broadcast alert to admin dashboard
      io.to('admin_room').emit('low_stock_alert', {
        alertId,
        stationId,
        stationName: stockInfo.station_name,
        itemName: stockInfo.item_name,
        currentStock: stockInfo.current_stock,
        severity: stockInfo.current_stock === 0 ? 'CRITICAL' : 'HIGH'
      });
    }
  }
}

module.exports = router;