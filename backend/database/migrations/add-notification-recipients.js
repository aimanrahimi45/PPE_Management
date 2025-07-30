const { getDb } = require('../init');

/**
 * Migration to add notification recipient fields to email_config table
 */
async function addNotificationRecipients() {
    const db = getDb();
    
    console.log('🔄 Adding notification recipient fields to email_config table...');
    
    try {
        // Add new columns for notification recipients
        await new Promise((resolve, reject) => {
            db.run(`
                ALTER TABLE email_config 
                ADD COLUMN safety_officer_email TEXT DEFAULT 'safety@company.com'
            `, [], function(err) {
                if (err && !err.message.includes('duplicate column name')) {
                    reject(err);
                } else {
                    console.log('✅ Added safety_officer_email column');
                    resolve();
                }
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                ALTER TABLE email_config 
                ADD COLUMN store_personnel_email TEXT DEFAULT 'store@company.com'
            `, [], function(err) {
                if (err && !err.message.includes('duplicate column name')) {
                    reject(err);
                } else {
                    console.log('✅ Added store_personnel_email column');
                    resolve();
                }
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                ALTER TABLE email_config 
                ADD COLUMN admin_email TEXT DEFAULT 'admin@company.com'
            `, [], function(err) {
                if (err && !err.message.includes('duplicate column name')) {
                    reject(err);
                } else {
                    console.log('✅ Added admin_email column');
                    resolve();
                }
            });
        });

        // Update existing records with default values if they're null
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE email_config 
                SET 
                    safety_officer_email = COALESCE(safety_officer_email, 'safety@company.com'),
                    store_personnel_email = COALESCE(store_personnel_email, 'store@company.com'),
                    admin_email = COALESCE(admin_email, 'admin@company.com')
                WHERE id = 1
            `, [], function(err) {
                if (err) reject(err);
                else {
                    console.log('✅ Updated existing email configuration with default recipient emails');
                    resolve();
                }
            });
        });

        console.log('✅ Notification recipients migration completed successfully');
        
    } catch (error) {
        console.error('❌ Error in notification recipients migration:', error);
        throw error;
    }
}

module.exports = { addNotificationRecipients };