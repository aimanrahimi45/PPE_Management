const { getDb } = require('../init');

/**
 * Add VPS validation tracking columns to license_config table
 */
async function addVPSValidationColumns() {
  const db = getDb();
  
  if (!db) {
    console.error('❌ Database not initialized');
    return false;
  }

  console.log('🔄 Adding VPS validation tracking columns...');

  return new Promise((resolve) => {
    db.serialize(() => {
      // Add VPS validation tracking columns
      const columns = [
        {
          name: 'last_vps_validation',
          type: 'DATETIME',
          description: 'Timestamp of last VPS validation attempt'
        },
        {
          name: 'last_successful_vps_validation',
          type: 'DATETIME',
          description: 'Timestamp of last successful VPS validation'
        },
        {
          name: 'vps_validation_failures',
          type: 'INTEGER DEFAULT 0',
          description: 'Count of consecutive VPS validation failures'
        },
        {
          name: 'vps_grace_period_start',
          type: 'DATETIME',
          description: 'Start of VPS validation grace period'
        },
        {
          name: 'last_vps_error',
          type: 'TEXT',
          description: 'Last VPS validation error message'
        }
      ];

      let completedColumns = 0;
      const totalColumns = columns.length;

      columns.forEach(column => {
        // Check if column exists
        db.get(`PRAGMA table_info(license_config)`, [], (err, result) => {
          if (err) {
            console.error(`❌ Error checking ${column.name} column:`, err);
            completedColumns++;
            if (completedColumns === totalColumns) resolve(false);
            return;
          }

          // Get all columns
          db.all(`PRAGMA table_info(license_config)`, [], (err, columns_info) => {
            if (err) {
              console.error(`❌ Error getting table info:`, err);
              completedColumns++;
              if (completedColumns === totalColumns) resolve(false);
              return;
            }

            const columnExists = columns_info.some(col => col.name === column.name);

            if (!columnExists) {
              // Add the column
              db.run(`ALTER TABLE license_config ADD COLUMN ${column.name} ${column.type}`, [], (err) => {
                if (err) {
                  console.error(`❌ Error adding ${column.name} column:`, err);
                } else {
                  console.log(`✅ Added ${column.name} column: ${column.description}`);
                }
                completedColumns++;
                if (completedColumns === totalColumns) resolve(true);
              });
            } else {
              console.log(`ℹ️  ${column.name} column already exists`);
              completedColumns++;
              if (completedColumns === totalColumns) resolve(true);
            }
          });
        });
      });
    });
  });
}

// Run migration if called directly
if (require.main === module) {
  (async () => {
    try {
      const result = await addVPSValidationColumns();
      console.log(result ? '✅ VPS validation columns migration completed' : '❌ Migration failed');
      process.exit(result ? 0 : 1);
    } catch (error) {
      console.error('❌ Migration error:', error);
      process.exit(1);
    }
  })();
}

module.exports = { addVPSValidationColumns };