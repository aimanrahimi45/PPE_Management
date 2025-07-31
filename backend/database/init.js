const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'ppe_management.db');

let db = null; // Database connection created later

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    // Create database connection when initializing
    if (!db) {
      db = new sqlite3.Database(DB_PATH);
    }
    
    db.serialize(() => {
      // Users table (base structure with all authentication columns including timezone)
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'STAFF',
        department TEXT,
        active BOOLEAN DEFAULT 1,
        first_login_completed BOOLEAN DEFAULT 0,
        setup_completed_at DATETIME,
        recovery_key TEXT,
        recovery_key_used BOOLEAN DEFAULT 0,
        password_reset_token TEXT,
        password_reset_expires DATETIME,
        security_question TEXT,
        security_answer TEXT,
        business_timezone TEXT DEFAULT NULL,
        timezone_auto_detected BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Stations table
      db.run(`CREATE TABLE IF NOT EXISTS stations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        qr_code TEXT UNIQUE NOT NULL,
        active BOOLEAN DEFAULT 1,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // PPE Items table
      db.run(`CREATE TABLE IF NOT EXISTS ppe_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        symbol TEXT DEFAULT '🛡️',
        min_threshold INTEGER DEFAULT 10,
        unit_cost DECIMAL(10,2) DEFAULT 0.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      
      // Add unit_cost column if it doesn't exist (for existing databases)
      db.run(`ALTER TABLE ppe_items ADD COLUMN unit_cost DECIMAL(10,2) DEFAULT 0.00`, (err) => {
        // Ignore error if column already exists
      });

      // Staff Directory table for verification
      db.run(`CREATE TABLE IF NOT EXISTS staff_directory (
        id TEXT PRIMARY KEY,
        staff_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        department TEXT,
        position TEXT,
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Station Inventory table
      db.run(`CREATE TABLE IF NOT EXISTS station_inventory (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        ppe_item_id TEXT NOT NULL,
        current_stock INTEGER DEFAULT 0,
        max_capacity INTEGER DEFAULT 100,
        min_threshold INTEGER DEFAULT 10,
        critical_threshold INTEGER DEFAULT 5,
        last_restocked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (station_id) REFERENCES stations (id),
        FOREIGN KEY (ppe_item_id) REFERENCES ppe_items (id),
        UNIQUE(station_id, ppe_item_id)
      )`);

      // PPE Requests table - minimal schema, extended dynamically by route
      db.run(`CREATE TABLE IF NOT EXISTS ppe_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        staff_id TEXT,
        station_id TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (station_id) REFERENCES stations (id)
      )`);

      // PPE Request Items table
      db.run(`CREATE TABLE IF NOT EXISTS ppe_request_items (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        ppe_item_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        issued BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES ppe_requests (id),
        FOREIGN KEY (ppe_item_id) REFERENCES ppe_items (id)
      )`);

      // Alerts table
      db.run(`CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'MEDIUM',
        station_id TEXT,
        resolved BOOLEAN DEFAULT 0,
        resolved_by TEXT,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (station_id) REFERENCES stations (id)
      )`);

      // QR Tokens table
      db.run(`CREATE TABLE IF NOT EXISTS qr_tokens (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        station_id TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Audit Trail table
      db.run(`CREATE TABLE IF NOT EXISTS audit_trail (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        old_values TEXT,
        new_values TEXT,
        ip_address TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`);

      // Staff PPE Assignments table
      db.run(`CREATE TABLE IF NOT EXISTS staff_ppe_assignments (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        department TEXT,
        ppe_item_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        issued_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        expected_return_date DATETIME,
        actual_return_date DATETIME,
        status TEXT DEFAULT 'ISSUED',
        notes TEXT,
        issued_by TEXT,
        returned_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ppe_item_id) REFERENCES ppe_items (id),
        FOREIGN KEY (issued_by) REFERENCES users (id),
        FOREIGN KEY (returned_by) REFERENCES users (id)
      )`);

      // Equipment Lifecycle table
      db.run(`CREATE TABLE IF NOT EXISTS equipment_lifecycle (
        id TEXT PRIMARY KEY,
        equipment_serial TEXT,
        ppe_item_id TEXT NOT NULL,
        purchase_date DATETIME,
        warranty_expiry DATETIME,
        last_inspection DATETIME,
        next_inspection DATETIME,
        condition_status TEXT DEFAULT 'GOOD',
        location TEXT,
        assigned_to TEXT,
        total_cost DECIMAL(10,2),
        disposal_date DATETIME,
        disposal_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ppe_item_id) REFERENCES ppe_items (id)
      )`);

      // Approval Records table
      db.run(`CREATE TABLE IF NOT EXISTS approval_records (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approval_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        action TEXT NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES ppe_requests (id),
        FOREIGN KEY (approved_by) REFERENCES users (id)
      )`);

      // Inventory Alerts table
      db.run(`CREATE TABLE IF NOT EXISTS inventory_alerts (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        ppe_item_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        threshold_value INTEGER NOT NULL,
        current_stock INTEGER NOT NULL,
        severity TEXT DEFAULT 'LOW',
        status TEXT DEFAULT 'ACTIVE',
        alert_sent BOOLEAN DEFAULT FALSE,
        acknowledged_by TEXT,
        acknowledged_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (station_id) REFERENCES stations (id),
        FOREIGN KEY (ppe_item_id) REFERENCES ppe_items (id),
        FOREIGN KEY (acknowledged_by) REFERENCES users (id)
      )`);

      // Email Configuration table
      db.run(`CREATE TABLE IF NOT EXISTS email_config (
        id TEXT PRIMARY KEY DEFAULT '1',
        smtp_host TEXT NOT NULL DEFAULT '',
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure BOOLEAN NOT NULL DEFAULT 0,
        smtp_user TEXT NOT NULL DEFAULT '',
        smtp_pass TEXT NOT NULL DEFAULT '',
        smtp_from TEXT NOT NULL DEFAULT '',
        company_name TEXT DEFAULT 'PPE Management System',
        enabled BOOLEAN DEFAULT 0,
        test_email TEXT DEFAULT '',
        safety_officer_email TEXT DEFAULT '',
        store_personnel_email TEXT DEFAULT '',
        admin_email TEXT DEFAULT 'admin@ppe.local',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Push Subscriptions table for notifications
      db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh_key TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        active INTEGER DEFAULT 1
      )`);

      // Notification Preferences table
      db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_email TEXT NOT NULL,
        notification_type TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        frequency TEXT DEFAULT 'immediate',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(admin_email, notification_type)
      )`);

      // Notifications table
      db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        data TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME,
        action_taken DATETIME,
        request_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Condition Reports table - minimal schema, extended dynamically by route
      db.run(`CREATE TABLE IF NOT EXISTS condition_reports (
        id TEXT PRIMARY KEY,
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT,
        severity TEXT DEFAULT 'medium',
        photo_path TEXT,
        status TEXT DEFAULT 'reported',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Scheduled Reports table
      db.run(`CREATE TABLE IF NOT EXISTS scheduled_reports (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        frequency TEXT NOT NULL,
        parameters TEXT,
        enabled BOOLEAN DEFAULT 1,
        last_run DATETIME,
        next_run DATETIME,
        email_recipients TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Super Admins table for license management
      db.run(`CREATE TABLE IF NOT EXISTS super_admins (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // License Configuration table
      db.run(`CREATE TABLE IF NOT EXISTS license_config (
        id TEXT PRIMARY KEY,
        license_key TEXT UNIQUE,
        client_name TEXT,
        company_name TEXT,
        max_users INTEGER DEFAULT 100,
        features TEXT,
        expires_at DATETIME,
        status TEXT DEFAULT 'active',
        system_fingerprint TEXT,
        installation_id TEXT,
        tier TEXT,
        subscription_tier TEXT,
        max_employees INTEGER DEFAULT -1,
        enabled_features TEXT,
        last_validation_time DATETIME,
        validation_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Departments table for dynamic department management
      db.run(`CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Time Verification Grace Period table (7-day offline protection)
      db.run(`CREATE TABLE IF NOT EXISTS time_verification_grace (
        id TEXT PRIMARY KEY,
        first_offline_date DATETIME,
        last_successful_verification DATETIME,
        consecutive_failure_days INTEGER DEFAULT 0,
        suspended BOOLEAN DEFAULT 0,
        last_attempt DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database tables created successfully');
          
          // Initialize default departments if table is empty
          try {
            db.get("SELECT COUNT(*) as count FROM departments", (err, row) => {
              if (!err && row && row.count === 0) {
                console.log('Initializing default departments...');
                const defaultDepartments = [
                  { id: 'maintenance', name: 'Maintenance', description: 'Equipment maintenance and repairs' },
                  { id: 'production', name: 'Production', description: 'Manufacturing and production operations' },
                  { id: 'quality', name: 'Quality Control', description: 'Quality assurance and testing' },
                  { id: 'assembly', name: 'Assembly', description: 'Product assembly operations' },
                  { id: 'warehouse', name: 'Warehouse', description: 'Storage and logistics operations' },
                  { id: 'safety', name: 'Safety', description: 'Workplace safety and compliance' },
                  { id: 'other', name: 'Other', description: 'Other departments' }
                ];

                const insertDepartment = db.prepare(`
                  INSERT OR IGNORE INTO departments (id, name, description, active) 
                  VALUES (?, ?, ?, 1)
                `);

                defaultDepartments.forEach(dept => {
                  insertDepartment.run(dept.id, dept.name, dept.description);
                });

                insertDepartment.finalize();
                console.log('✅ Default departments initialized');
              }
            });
          } catch (err) {
            console.log('Info: Could not initialize default departments (non-fatal):', err.message);
          }
          
          // Auto-fix missing columns for backward compatibility
          try {
            console.log('Checking for missing database columns...');
            
            // Check if smtp_secure column exists in email_config
            try {
              const emailConfigColumns = db.prepare("PRAGMA table_info(email_config)").all();
              const hasSmtpSecure = emailConfigColumns.some(col => col.name === 'smtp_secure');
            
              if (!hasSmtpSecure) {
                console.log('Adding missing smtp_secure column...');
                db.prepare("ALTER TABLE email_config ADD COLUMN smtp_secure BOOLEAN NOT NULL DEFAULT 0").run();
                console.log('✅ smtp_secure column added');
              }
            } catch (err) {
              console.log('Info: email_config table may not exist yet');
            }
            
            // Check if notification_preferences table exists and has frequency column
            try {
              const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_preferences'").all();
              if (tables.length === 0) {
                console.log('Creating missing notification_preferences table...');
                db.run(`CREATE TABLE IF NOT EXISTS notification_preferences (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  admin_email TEXT NOT NULL,
                  notification_type TEXT NOT NULL,
                  enabled INTEGER DEFAULT 1,
                  frequency TEXT DEFAULT 'immediate',
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(admin_email, notification_type)
                )`);
                console.log('✅ notification_preferences table created');
              } else {
                // Check if frequency column exists
                const notificationColumns = db.prepare("PRAGMA table_info(notification_preferences)").all();
                const hasFrequency = notificationColumns.some(col => col.name === 'frequency');
                
                if (!hasFrequency) {
                  console.log('Adding missing frequency column to notification_preferences...');
                  db.prepare("ALTER TABLE notification_preferences ADD COLUMN frequency TEXT DEFAULT 'immediate'").run();
                  console.log('✅ frequency column added to notification_preferences');
                }
              }
            } catch (err) {
              console.log('Info: notification_preferences table migration check failed, may not exist yet');
            }
            
            console.log('Database compatibility checks completed');
          } catch (migrationError) {
            console.error('Migration warning (non-fatal):', migrationError.message);
          }
          
          // Add authentication columns migration with proper column existence checking
          try {
            console.log('Checking authentication columns in users table...');
            
            // Get existing columns by testing each one individually
            const checkColumnExists = (columnName) => {
              try {
                db.prepare(`SELECT ${columnName} FROM users LIMIT 1`).all();
                return true;
              } catch (err) {
                return false;
              }
            };
            
            // Add authentication columns if they don't exist
            const authColumns = [
              { name: 'first_login_completed', def: 'BOOLEAN DEFAULT 0' },
              { name: 'setup_completed_at', def: 'DATETIME' },
              { name: 'recovery_key', def: 'TEXT' },
              { name: 'recovery_key_used', def: 'BOOLEAN DEFAULT 0' },
              { name: 'password_reset_token', def: 'TEXT' },
              { name: 'password_reset_expires', def: 'DATETIME' },
              { name: 'security_question', def: 'TEXT' },
              { name: 'security_answer', def: 'TEXT' },
              { name: 'business_timezone', def: 'TEXT DEFAULT NULL' },
              { name: 'timezone_auto_detected', def: 'BOOLEAN DEFAULT 0' }
            ];
            
            for (const column of authColumns) {
              try {
                // Check if column already exists
                if (checkColumnExists(column.name)) {
                  console.log(`ℹ️  Authentication column '${column.name}' already exists`);
                  continue;
                }
                
                // Add column if it doesn't exist
                db.prepare(`ALTER TABLE users ADD COLUMN ${column.name} ${column.def}`).run();
                console.log(`✅ Added authentication column: ${column.name}`);
              } catch (err) {
                // Handle duplicate column errors gracefully (safety net)
                if (err.message.includes('duplicate column name')) {
                  console.log(`ℹ️  Authentication column '${column.name}' already exists (detected during add)`);
                } else {
                  console.log(`ℹ️  Column '${column.name}' migration: ${err.message}`);
                }
              }
            }
            
            // Skip condition_reports migration - handled dynamically by the route
            console.log('ℹ️  condition_reports table will be handled dynamically by the route');
            
            // Skip ppe_requests migration - handled dynamically by the route  
            console.log('ℹ️  ppe_requests table will be handled dynamically by the route');
            
            console.log('✅ Authentication columns check completed');
          } catch (authMigrationError) {
            console.error('Authentication migration error (non-fatal):', authMigrationError.message);
          }
          
          // License configuration table migration
          try {
            console.log('Checking license_config table columns...');
            
            // Check if client_name column exists in license_config table
            const checkLicenseColumnExists = (columnName) => {
              try {
                db.prepare(`SELECT ${columnName} FROM license_config LIMIT 1`).all();
                return true;
              } catch (err) {
                return false;
              }
            };
            
            // Add client_name column if it doesn't exist
            if (!checkLicenseColumnExists('client_name')) {
              try {
                db.prepare(`ALTER TABLE license_config ADD COLUMN client_name TEXT`).run();
                console.log('✅ Added client_name column to license_config table');
              } catch (err) {
                if (err.message.includes('duplicate column name')) {
                  console.log('ℹ️  client_name column already exists in license_config');
                } else {
                  console.log(`ℹ️  license_config client_name migration: ${err.message}`);
                }
              }
            } else {
              console.log('ℹ️  client_name column already exists in license_config');
            }

            // Add subscription_tier column if it doesn't exist
            if (!checkLicenseColumnExists('subscription_tier')) {
              try {
                db.prepare(`ALTER TABLE license_config ADD COLUMN subscription_tier TEXT`).run();
                console.log('✅ Added subscription_tier column to license_config table');
              } catch (err) {
                if (err.message.includes('duplicate column name')) {
                  console.log('ℹ️  subscription_tier column already exists in license_config');
                } else {
                  console.log(`ℹ️  license_config subscription_tier migration: ${err.message}`);
                }
              }
            } else {
              console.log('ℹ️  subscription_tier column already exists in license_config');
            }

            // Add max_employees column if it doesn't exist
            if (!checkLicenseColumnExists('max_employees')) {
              try {
                db.prepare(`ALTER TABLE license_config ADD COLUMN max_employees INTEGER DEFAULT -1`).run();
                console.log('✅ Added max_employees column to license_config table');
              } catch (err) {
                if (err.message.includes('duplicate column name')) {
                  console.log('ℹ️  max_employees column already exists in license_config');
                } else {
                  console.log(`ℹ️  license_config max_employees migration: ${err.message}`);
                }
              }
            } else {
              console.log('ℹ️  max_employees column already exists in license_config');
            }

            // Add enabled_features column if it doesn't exist
            if (!checkLicenseColumnExists('enabled_features')) {
              try {
                db.prepare(`ALTER TABLE license_config ADD COLUMN enabled_features TEXT`).run();
                console.log('✅ Added enabled_features column to license_config table');
              } catch (err) {
                if (err.message.includes('duplicate column name')) {
                  console.log('ℹ️  enabled_features column already exists in license_config');
                } else {
                  console.log(`ℹ️  license_config enabled_features migration: ${err.message}`);
                }
              }
            } else {
              console.log('ℹ️  enabled_features column already exists in license_config');
            }

            // Add system_fingerprint column if it doesn't exist (for license sharing prevention)
            if (!checkLicenseColumnExists('system_fingerprint')) {
              try {
                db.prepare(`ALTER TABLE license_config ADD COLUMN system_fingerprint TEXT`).run();
                console.log('✅ Added system_fingerprint column to license_config table');
              } catch (err) {
                if (err.message.includes('duplicate column name')) {
                  console.log('ℹ️  system_fingerprint column already exists in license_config');
                } else {
                  console.log(`ℹ️  license_config system_fingerprint migration: ${err.message}`);
                }
              }
            } else {
              console.log('ℹ️  system_fingerprint column already exists in license_config');
            }
            
            console.log('✅ License configuration columns check completed');
          } catch (licenseConfigError) {
            console.error('License config migration error (non-fatal):', licenseConfigError.message);
          }
          
          resolve();
        }
      });
    });
  });
};


// Run database migrations for existing databases
const runMigrations = () => {
  console.log('Running database migrations...');
  
  try {
    // Simple migration - just ensure default email config exists
    try {
      db.run("INSERT OR IGNORE INTO email_config (id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, company_name, enabled, admin_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ['1', '', 587, 0, '', '', '', 'PPE Management System', 0, 'admin@ppe.local'], (err) => {
        if (err) {
          // Table might not exist yet, ignore
        } else {
          console.log('✅ Default email config ensured');
        }
      });
    } catch (error) {
      // Table might not exist yet, ignore
    }
    
    // Migration for notifications table - add missing columns
    // Check if columns exist before adding them
    try {
      db.all("PRAGMA table_info(notifications)", (err, tableInfo) => {
        if (err) {
          console.log('Info: notifications table may not exist yet for migration:', err.message);
          return;
        }
        
        if (tableInfo && tableInfo.length > 0) {
          // Filter out null values and extract column names safely
          const existingColumns = tableInfo
            .filter(col => col && col.name) // Remove null/undefined entries
            .map(col => col.name);
          
          // Only proceed if we have valid table info
          if (existingColumns.length > 0) {
            if (!existingColumns.includes('action_taken')) {
              db.run("ALTER TABLE notifications ADD COLUMN action_taken DATETIME", (alterErr) => {
                if (alterErr) {
                  console.log('Info: notifications action_taken migration error (non-fatal):', alterErr.message);
                } else {
                  console.log('✅ Added action_taken column to notifications table');
                }
              });
            }
            
            if (!existingColumns.includes('request_id')) {
              db.run("ALTER TABLE notifications ADD COLUMN request_id TEXT", (alterErr) => {
                if (alterErr) {
                  console.log('Info: notifications request_id migration error (non-fatal):', alterErr.message);
                } else {
                  console.log('✅ Added request_id column to notifications table');
                }
              });
            }
          } else {
            console.log('Info: notifications table may not exist yet or has no columns');
          }
        }
      });
    } catch (error) {
      console.log('Info: notification_preferences table migration check failed, may not exist yet');
    }
    
    // License configuration table migration - add client_name column
    try {
      console.log('Checking license_config table for client_name column...');
      
      // Check if license_config table exists and has client_name column (using regular sqlite3 syntax)
      db.all("PRAGMA table_info(license_config)", (err, licenseTableInfo) => {
        if (err) {
          console.log('Info: license_config table may not exist yet for migration:', err.message);
          return;
        }
        
        if (licenseTableInfo && licenseTableInfo.length > 0) {
          const hasClientName = licenseTableInfo.some(column => column.name === 'client_name');
          
          if (!hasClientName) {
            console.log('Adding client_name column to license_config table...');
            db.run("ALTER TABLE license_config ADD COLUMN client_name TEXT", (alterErr) => {
              if (alterErr) {
                if (alterErr.message.includes('duplicate column name')) {
                  console.log('ℹ️  client_name column already exists in license_config table');
                } else {
                  console.log('Info: license_config migration error (non-fatal):', alterErr.message);
                }
              } else {
                console.log('✅ client_name column added to license_config table');
              }
            });
          } else {
            console.log('ℹ️  client_name column already exists in license_config table');
          }
        } else {
          console.log('Info: license_config table has no columns or does not exist yet');
        }
      });
    } catch (licenseConfigError) {
      console.log('Info: license_config table migration check failed, may not exist yet:', licenseConfigError.message);
    }
    
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Migration error (non-fatal):', error.message);
  }
};

const getDb = () => db;

module.exports = { initDatabase, getDb, runMigrations };