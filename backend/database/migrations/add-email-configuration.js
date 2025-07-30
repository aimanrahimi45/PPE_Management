/**
 * Database migration: Add email configuration table
 * This allows admins to configure SMTP settings through the UI instead of hardcoded .env
 */

const { getDb } = require('../init');

async function addEmailConfigurationTable() {
    console.log('📧 Adding email configuration table...');
    
    const db = getDb();
    
    try {
        // Create email_config table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS email_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    smtp_host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
                    smtp_port INTEGER NOT NULL DEFAULT 587,
                    smtp_secure BOOLEAN NOT NULL DEFAULT 0,
                    smtp_user TEXT NOT NULL,
                    smtp_pass TEXT NOT NULL,
                    smtp_from TEXT NOT NULL,
                    company_name TEXT DEFAULT 'PPE Management System',
                    enabled BOOLEAN NOT NULL DEFAULT 1,
                    test_email TEXT,
                    safety_officer_email TEXT DEFAULT 'safety@company.com',
                    store_personnel_email TEXT DEFAULT 'store@company.com',
                    admin_email TEXT DEFAULT 'admin@company.com',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, [], function(err) {
                if (err) reject(err);
                else {
                    console.log('✅ Email configuration table created');
                    resolve();
                }
            });
        });
        
        // Create notification_preferences table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS notification_preferences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_email TEXT NOT NULL,
                    notification_type TEXT NOT NULL,
                    enabled BOOLEAN NOT NULL DEFAULT 1,
                    frequency TEXT DEFAULT 'immediate',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(admin_email, notification_type)
                )
            `, [], function(err) {
                if (err) reject(err);
                else {
                    console.log('✅ Notification preferences table created');
                    resolve();
                }
            });
        });
        
        // Create email_templates table
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS email_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    template_type TEXT NOT NULL UNIQUE,
                    subject TEXT NOT NULL,
                    html_content TEXT NOT NULL,
                    text_content TEXT,
                    variables TEXT, -- JSON string of available variables
                    enabled BOOLEAN NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, [], function(err) {
                if (err) reject(err);
                else {
                    console.log('✅ Email templates table created');
                    resolve();
                }
            });
        });
        
        // Insert default email configuration if none exists
        await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM email_config', [], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (row.count === 0) {
                    // Insert default configuration from environment variables
                    db.run(`
                        INSERT INTO email_config (
                            smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, 
                            company_name, enabled, test_email, safety_officer_email, store_personnel_email, admin_email
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        process.env.SMTP_HOST || 'smtp.gmail.com',
                        parseInt(process.env.SMTP_PORT) || 587,
                        false,
                        process.env.SMTP_USER || 'your-email@gmail.com',
                        process.env.SMTP_PASS || 'your-app-password',
                        process.env.SMTP_FROM || 'PPE Management System <noreply@ppemanagement.com>',
                        'PPE Management System',
                        true,
                        process.env.SMTP_USER || 'admin@company.com',
                        process.env.SAFETY_OFFICER_EMAIL || 'safety@company.com',
                        process.env.STORE_PERSONNEL_EMAIL || 'store@company.com',
                        process.env.ADMIN_EMAIL || 'admin@company.com'
                    ], function(err) {
                        if (err) reject(err);
                        else {
                            console.log('✅ Default email configuration inserted');
                            resolve();
                        }
                    });
                } else {
                    console.log('ℹ️ Email configuration already exists, skipping default insert');
                    resolve();
                }
            });
        });
        
        // Insert default notification preferences
        await new Promise((resolve, reject) => {
            const defaultNotifications = [
                { type: 'ppe_request_new', name: 'New PPE Requests' },
                { type: 'ppe_request_approved', name: 'PPE Request Approved' },
                { type: 'ppe_request_rejected', name: 'PPE Request Rejected' },
                { type: 'stock_low', name: 'Low Stock Alerts' },
                { type: 'stock_critical', name: 'Critical Stock Alerts' },
                { type: 'license_expiring', name: 'License Expiration Warnings' },
                { type: 'weekly_summary', name: 'Weekly Summary Reports' },
                { type: 'monthly_summary', name: 'Monthly Summary Reports' }
            ];
            
            let insertCount = 0;
            const adminEmail = process.env.SMTP_USER || 'admin@company.com';
            
            defaultNotifications.forEach(notification => {
                db.run(`
                    INSERT OR IGNORE INTO notification_preferences 
                    (admin_email, notification_type, enabled, frequency) 
                    VALUES (?, ?, ?, ?)
                `, [adminEmail, notification.type, true, 'immediate'], function(err) {
                    if (err) {
                        console.error(`Failed to insert ${notification.type}:`, err);
                    } else if (this.changes > 0) {
                        insertCount++;
                    }
                    
                    if (insertCount > 0 && insertCount === defaultNotifications.length) {
                        console.log(`✅ ${insertCount} default notification preferences inserted`);
                    }
                });
            });
            
            resolve();
        });
        
        // Insert default email templates
        const defaultTemplates = [
            {
                type: 'ppe_request_new',
                subject: 'New PPE Request - {{requestId}}',
                html: `
                    <h2>New PPE Request Submitted</h2>
                    <p><strong>Request ID:</strong> {{requestId}}</p>
                    <p><strong>Staff:</strong> {{staffName}} ({{department}})</p>
                    <p><strong>Station:</strong> {{stationId}}</p>
                    <p><strong>Items Requested:</strong></p>
                    <ul>{{itemsList}}</ul>
                    <p><strong>Notes:</strong> {{notes}}</p>
                    <p>Please review and approve this request in the admin panel.</p>
                `,
                variables: JSON.stringify(['requestId', 'staffName', 'department', 'stationId', 'itemsList', 'notes'])
            },
            {
                type: 'stock_low',
                subject: 'Low Stock Alert - {{itemName}}',
                html: `
                    <h2>⚠️ Low Stock Alert</h2>
                    <p><strong>Item:</strong> {{itemName}}</p>
                    <p><strong>Current Stock:</strong> {{currentStock}}</p>
                    <p><strong>Minimum Threshold:</strong> {{minThreshold}}</p>
                    <p><strong>Station:</strong> {{stationId}}</p>
                    <p>Please restock this item to ensure adequate PPE availability.</p>
                `,
                variables: JSON.stringify(['itemName', 'currentStock', 'minThreshold', 'stationId'])
            },
            {
                type: 'license_expiring',
                subject: 'License Expiration Warning - {{daysRemaining}} days left',
                html: `
                    <h2>🚨 License Expiration Warning</h2>
                    <p><strong>Client:</strong> {{clientName}}</p>
                    <p><strong>Subscription Tier:</strong> {{subscriptionTier}}</p>
                    <p><strong>Expiration Date:</strong> {{expirationDate}}</p>
                    <p><strong>Days Remaining:</strong> {{daysRemaining}}</p>
                    <p>Please renew your license to continue using the PPE Management System.</p>
                `,
                variables: JSON.stringify(['clientName', 'subscriptionTier', 'expirationDate', 'daysRemaining'])
            }
        ];
        
        for (const template of defaultTemplates) {
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT OR IGNORE INTO email_templates 
                    (template_type, subject, html_content, variables, enabled) 
                    VALUES (?, ?, ?, ?, ?)
                `, [template.type, template.subject, template.html, template.variables, true], function(err) {
                    if (err) reject(err);
                    else {
                        if (this.changes > 0) {
                            console.log(`✅ Email template '${template.type}' inserted`);
                        }
                        resolve();
                    }
                });
            });
        }
        
        console.log('\n🎉 Email configuration migration completed successfully!');
        console.log('📧 Email system is now ready for professional configuration through admin panel.');
        
    } catch (error) {
        console.error('❌ Email configuration migration failed:', error);
        throw error;
    }
}

if (require.main === module) {
    addEmailConfigurationTable()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
} else {
    module.exports = { addEmailConfigurationTable };
}