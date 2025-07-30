const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const notificationService = require('../services/notificationService');
const { checkFeatureAccess } = require('../middleware/featureFlag');

const router = express.Router();
// Database connection created lazily to avoid initialization issues

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'uploads', 'condition-reports');
    require('fs').mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'));
    }
  }
});

// Dynamic table initialization with auto-column addition
async function initializeConditionReportsTable() {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    // Handle case where database is not yet initialized
    if (!db) {
      console.log('⚠️ Database not ready for condition reports table initialization');
      resolve();
      return;
    }
    
    // First create the table with ONLY essential columns
    getDb().run(`
      CREATE TABLE IF NOT EXISTS condition_reports (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_path TEXT,
        location TEXT,
        severity TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'reported',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Failed to create condition_reports table:', err);
        reject(err);
        return;
      }
      
      // Get actual table structure dynamically
      getDb().all(`PRAGMA table_info(condition_reports)`, (err, columns) => {
        if (err) {
          console.error('Failed to verify condition_reports table structure:', err);
          reject(err);
          return;
        }
        
        const columnNames = columns.filter(col => col && col.name).map(col => col.name);
        console.log('📋 Condition reports table columns:', columnNames);
        
        // Define optional columns we might want to add
        const desiredOptionalColumns = [
          { name: 'ppe_item_id', type: 'TEXT', description: 'Links to specific PPE items' },
          { name: 'station_id', type: 'TEXT', description: 'Links to workstation locations' },
          { name: 'resolved_at', type: 'DATETIME', description: 'When issue was resolved' },
          { name: 'resolved_by', type: 'TEXT', description: 'Who resolved the issue' },
          { name: 'resolution_notes', type: 'TEXT', description: 'Resolution details' }
        ];
        
        // Dynamically add missing optional columns
        addMissingColumns(columnNames, desiredOptionalColumns)
          .then((updatedColumns) => {
            // Store available columns globally for dynamic queries
            global.conditionReportsColumns = updatedColumns;
            
            // Check if all required columns exist
            const requiredColumns = ['id', 'staff_id', 'staff_name', 'description', 'created_at', 'status', 'severity'];
            const missingColumns = requiredColumns.filter(col => !updatedColumns.includes(col));
            
            if (missingColumns.length > 0) {
              console.error('❌ Missing required columns in condition_reports:', missingColumns);
              reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
              return;
            }
            
            console.log('✅ Condition reports table initialized dynamically');
            console.log('📋 Available optional columns:', updatedColumns.filter(col => !requiredColumns.includes(col)));
            resolve();
          })
          .catch(reject);
      });
    });
  });
}

// Dynamic column addition function
async function addMissingColumns(existingColumns, desiredColumns) {
  return new Promise((resolve, reject) => {
    const missingColumns = desiredColumns.filter(col => !existingColumns.includes(col.name));
    
    if (missingColumns.length === 0) {
      console.log('ℹ️  All optional columns already exist');
      resolve(existingColumns);
      return;
    }
    
    console.log(`🔧 Adding ${missingColumns.length} missing optional columns...`);
    
    // Add columns sequentially to avoid conflicts
    const addNextColumn = async (index) => {
      if (index >= missingColumns.length) {
        // All columns added, get updated column list
        getDb().all(`PRAGMA table_info(condition_reports)`, (err, columns) => {
          if (err) {
            reject(err);
            return;
          }
          const updatedColumnNames = columns.filter(col => col && col.name).map(col => col.name);
          console.log('✅ All optional columns added successfully');
          resolve(updatedColumnNames);
        });
        return;
      }
      
      const column = missingColumns[index];
      
      try {
        getDb().run(`ALTER TABLE condition_reports ADD COLUMN ${column.name} ${column.type}`, (err) => {
          if (err) {
            if (err.message.includes('duplicate column name')) {
              console.log(`ℹ️  Column '${column.name}' already exists, skipping`);
            } else {
              console.log(`⚠️  Could not add column '${column.name}': ${err.message}`);
            }
          } else {
            console.log(`✅ Added column: ${column.name} (${column.description})`);
          }
          
          // Continue with next column
          addNextColumn(index + 1);
        });
      } catch (err) {
        console.log(`⚠️  Error adding column '${column.name}': ${err.message}`);
        addNextColumn(index + 1);
      }
    };
    
    addNextColumn(0);
  });
}

// Initialize table on module load - with delay to ensure DB is ready
setTimeout(() => {
  initializeConditionReportsTable().catch(console.error);
}, 1000);

// Middleware to ensure table exists before any operation
async function ensureTableExists(req, res, next) {
  try {
    await initializeConditionReportsTable();
    next();
  } catch (error) {
    console.error('Failed to initialize condition_reports table:', error);
    res.status(500).json({
      error: 'Database initialization failed',
      details: error.message
    });
  }
}

// Submit condition report
router.post('/submit', checkFeatureAccess('condition_reporting'), ensureTableExists, upload.single('photo'), async (req, res) => {
  try {
    console.log('=== CONDITION REPORT SUBMIT ===');
    console.log('Request body:', req.body);
    console.log('File info:', req.file ? { filename: req.file.filename, size: req.file.size } : 'No file');
    
    const {
      staffId,
      staffName,
      description,
      location,
      severity = 'medium',
      ppeItemId,
      stationId
    } = req.body;

    if (!staffId || !staffName || !description) {
      return res.status(400).json({
        error: 'Staff ID, name, and description are required'
      });
    }

    const reportId = uuidv4();
    const photoPath = req.file ? req.file.filename : null;

    // Insert condition report into database using dynamic column detection
    await new Promise((resolve, reject) => {
      // Get available columns (fallback if global not set)
      let availableColumns = global.conditionReportsColumns;
      if (!availableColumns) {
        // Fallback: get columns directly
        getDb().all(`PRAGMA table_info(condition_reports)`, (err, columns) => {
          if (err) {
            reject(err);
            return;
          }
          availableColumns = columns.filter(col => col && col.name).map(col => col.name);
          proceedWithInsert();
        });
        return;
      }
      
      proceedWithInsert();
      
      function proceedWithInsert() {
        // Build dynamic query based on available columns
        const dataToInsert = {
          id: reportId,
          staff_id: staffId,
          staff_name: staffName,
          description: description,
          photo_path: photoPath,
          location: location,
          severity: severity
        };
        
        // Add optional columns only if they exist in the table
        if (availableColumns.includes('ppe_item_id')) {
          dataToInsert.ppe_item_id = ppeItemId;
        }
        if (availableColumns.includes('station_id')) {
          dataToInsert.station_id = stationId;
        }
        
        // Build dynamic INSERT query
        const columnsList = Object.keys(dataToInsert).join(', ');
        const placeholders = Object.keys(dataToInsert).map(() => '?').join(', ');
        const values = Object.values(dataToInsert);
        
        const query = `INSERT INTO condition_reports (${columnsList}) VALUES (${placeholders})`;
        
        console.log('📝 Dynamic insert query:', query);
        console.log('📝 Values:', values);
        
        getDb().run(query, values, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });

    // Send notification to safety officers/admins
    try {
      // Dynamic admin discovery - get all admin users from database
      const adminUsers = await new Promise((resolve, reject) => {
        getDb().all(`
          SELECT staff_id, name FROM staff 
          WHERE department IN ('admin', 'safety', 'management') 
          OR staff_id LIKE 'admin%' 
          OR staff_id LIKE 'safety%'
          OR role = 'admin'
        `, (err, rows) => {
          if (err) {
            console.log('Could not fetch admin users, using defaults');
            resolve([{ staff_id: 'admin', name: 'System Admin' }]);
          } else {
            resolve(rows && rows.length > 0 ? rows : [{ staff_id: 'admin', name: 'System Admin' }]);
          }
        });
      });
      
      console.log(`📧 Sending condition report notification to ${adminUsers.length} admin(s)`);
      
      for (const admin of adminUsers) {
        await notificationService.sendPushNotification(admin.staff_id, {
          title: '🔧 PPE Condition Report',
          body: `${staffName} reported: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`,
          type: 'condition_report',
          data: {
            reportId: reportId,
            staffId: staffId,
            staffName: staffName,
            severity: severity,
            hasPhoto: !!photoPath,
            location: location,
            photoUrl: photoPath ? `/uploads/condition-reports/${photoPath}` : null
          },
          url: '/admin.html?tab=condition-reports'
        });
      }
    } catch (notificationError) {
      console.error('Failed to send condition report notification:', notificationError);
      // Continue - don't fail the report if notification fails
    }

    res.json({
      success: true,
      message: 'Condition report submitted successfully',
      reportId: reportId,
      hasPhoto: !!photoPath
    });

  } catch (error) {
    console.error('=== CONDITION REPORT SUBMIT ERROR ===');
    console.error('Error details:', error);
    console.error('Request body:', req.body);
    console.error('File info:', req.file);
    console.error('=====================================');
    res.status(500).json({
      error: 'Failed to submit condition report',
      details: error.message
    });
  }
});

// Get condition reports for staff member
router.get('/staff/:staffId', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    const { staffId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const reports = await new Promise((resolve, reject) => {
      getDb().all(`
        SELECT * FROM condition_reports 
        WHERE staff_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [staffId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    res.json({
      success: true,
      reports,
      count: reports.length
    });

  } catch (error) {
    console.error('Get staff condition reports error:', error);
    res.status(500).json({
      error: 'Failed to retrieve condition reports'
    });
  }
});

// Get all condition reports (admin)
router.get('/admin/all', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    console.log('=== ADMIN GET ALL CONDITION REPORTS ===');
    const status = req.query.status || 'all';
    const limit = parseInt(req.query.limit) || 100;
    console.log('Status filter:', status, 'Limit:', limit);
    
    let query = 'SELECT * FROM condition_reports';
    let params = [];
    
    if (status !== 'all') {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    console.log('SQL Query:', query);
    console.log('SQL Params:', params);

    const reports = await new Promise((resolve, reject) => {
      getDb().all(query, params, (err, rows) => {
        if (err) {
          console.error('SQL Error:', err);
          reject(err);
        } else {
          console.log(`Found ${rows ? rows.length : 0} condition reports`);
          resolve(rows);
        }
      });
    });

    res.json({
      success: true,
      reports,
      count: reports.length
    });

  } catch (error) {
    console.error('Get all condition reports error:', error);
    res.status(500).json({
      error: 'Failed to retrieve condition reports'
    });
  }
});

// Get condition report photo
router.get('/photo/:filename', checkFeatureAccess('condition_reporting'), (req, res) => {
  try {
    const { filename } = req.params;
    const photoPath = path.join(__dirname, '..', 'uploads', 'condition-reports', filename);
    
    // Check if file exists
    if (require('fs').existsSync(photoPath)) {
      res.sendFile(photoPath);
    } else {
      res.status(404).json({ error: 'Photo not found' });
    }
    
  } catch (error) {
    console.error('Get photo error:', error);
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
});

// Update condition report status
router.put('/:reportId/status', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, resolvedBy, resolutionNotes } = req.body;

    if (!['reported', 'in_progress', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be: reported, in_progress, resolved, or dismissed'
      });
    }

    // Dynamic update based on available columns
    const availableColumns = global.conditionReportsColumns || [];
    const updateData = { status };
    let query = 'UPDATE condition_reports SET status = ?';
    let params = [status];

    if (status === 'resolved' || status === 'dismissed') {
      // Only add resolution fields if columns exist
      if (availableColumns.includes('resolved_at')) {
        updateData.resolved_at = new Date().toISOString();
        query += ', resolved_at = ?';
        params.push(updateData.resolved_at);
      }
      if (availableColumns.includes('resolved_by') && resolvedBy) {
        updateData.resolved_by = resolvedBy;
        query += ', resolved_by = ?';
        params.push(resolvedBy);
      }
      if (availableColumns.includes('resolution_notes') && resolutionNotes) {
        updateData.resolution_notes = resolutionNotes;
        query += ', resolution_notes = ?';
        params.push(resolutionNotes);
      }
    }

    query += ' WHERE id = ?';
    params.push(reportId);
    
    console.log('📝 Dynamic update query:', query);

    await new Promise((resolve, reject) => {
      getDb().run(query, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Send notification to staff member about resolution
    if (status === 'resolved' || status === 'dismissed') {
      try {
        // Get report details
        const report = await new Promise((resolve, reject) => {
          getDb().get('SELECT * FROM condition_reports WHERE id = ?', [reportId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (report) {
          await notificationService.sendPushNotification(report.staff_id, {
            title: status === 'resolved' ? '✅ Condition Report Resolved' : '📝 Condition Report Updated',
            body: resolutionNotes || `Your condition report has been marked as ${status}`,
            type: 'condition_report_update',
            data: {
              reportId: reportId,
              status: status,
              resolutionNotes: resolutionNotes
            },
            url: '/worker-mobile.html?tab=notifications'
          });
        }
      } catch (notificationError) {
        console.error('Failed to send resolution notification:', notificationError);
      }
    }

    res.json({
      success: true,
      message: `Condition report marked as ${status}`,
      reportId: reportId
    });

  } catch (error) {
    console.error('Update condition report status error:', error);
    res.status(500).json({
      error: 'Failed to update condition report status'
    });
  }
});

// Get condition report statistics
router.get('/stats', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      getDb().all(`
        SELECT 
          status,
          severity,
          COUNT(*) as count,
          DATE(created_at) as date
        FROM condition_reports 
        GROUP BY status, severity, DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `, [], (err, rows) => {
        if (err) reject(err);
        else {
          // Process stats
          const summary = {
            total: 0,
            open: 0,
            resolved: 0,
            by_severity: { low: 0, medium: 0, high: 0, critical: 0 }
          };
          
          rows.forEach(row => {
            summary.total += row.count;
            summary[row.status] = (summary[row.status] || 0) + row.count;
            summary.by_severity[row.severity] = (summary.by_severity[row.severity] || 0) + row.count;
          });
          
          resolve({ summary, details: rows });
        }
      });
    });

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get condition report stats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve condition report statistics'
    });
  }
});

// Admin endpoint to enhance table schema dynamically
router.post('/admin/enhance-schema', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    console.log('=== ENHANCE CONDITION REPORTS SCHEMA ===');
    
    // Force re-initialization to add missing columns
    await initializeConditionReportsTable();
    
    res.json({
      success: true,
      message: 'Schema enhanced successfully',
      availableColumns: global.conditionReportsColumns
    });
    
  } catch (error) {
    console.error('Schema enhancement error:', error);
    res.status(500).json({
      error: 'Failed to enhance schema',
      details: error.message
    });
  }
});

// Get current table schema info
router.get('/admin/schema', checkFeatureAccess('condition_reporting'), ensureTableExists, async (req, res) => {
  try {
    const columns = await new Promise((resolve, reject) => {
      getDb().all(`PRAGMA table_info(condition_reports)`, (err, cols) => {
        if (err) reject(err);
        else resolve(cols);
      });
    });
    
    const requiredColumns = ['id', 'staff_id', 'staff_name', 'description', 'created_at', 'status', 'severity'];
    const allDesiredColumns = [
      'ppe_item_id', 'station_id', 'resolved_at', 'resolved_by', 'resolution_notes'
    ];
    
    const columnNames = columns.map(col => col.name);
    const missingOptional = allDesiredColumns.filter(col => !columnNames.includes(col));
    
    res.json({
      success: true,
      schema: {
        currentColumns: columns,
        columnNames: columnNames,
        requiredColumns: requiredColumns,
        missingOptionalColumns: missingOptional,
        hasAllRequiredColumns: requiredColumns.every(col => columnNames.includes(col)),
        enhancementAvailable: missingOptional.length > 0
      }
    });
    
  } catch (error) {
    console.error('Schema info error:', error);
    res.status(500).json({
      error: 'Failed to get schema info'
    });
  }
});

module.exports = router;