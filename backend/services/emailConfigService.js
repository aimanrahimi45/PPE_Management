/**
 * Email Configuration Service
 * Manages database-driven email configuration instead of hardcoded .env values
 */

const { getDb } = require('../database/init');
const nodemailer = require('nodemailer');

class EmailConfigService {
    constructor() {
        this.currentConfig = null;
        this.transporter = null;
    }
    
    /**
     * Get current email configuration from database
     */
    async getEmailConfig() {
        const db = getDb();
        
        // Handle case where database is not yet initialized
        if (!db) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM email_config ORDER BY updated_at DESC LIMIT 1',
                [],
                (err, row) => {
                    if (err) {
                        // Handle case where table doesn't exist yet (database reset scenario)
                        if (err.message.includes('no such table: email_config')) {
                            console.log('📧 Email config table not found - database may be initializing');
                            resolve(null);
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve(row);
                    }
                }
            );
        });
    }
    
    /**
     * Update email configuration
     */
    async updateEmailConfig(config) {
        const db = getDb();
        let {
            smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, 
            smtp_from, company_name, enabled, test_email,
            safety_officer_email, store_personnel_email, admin_email
        } = config;
        
        // If password is the masked value, keep existing password
        if (smtp_pass === '••••••••') {
            const currentConfig = await this.getEmailConfig();
            smtp_pass = currentConfig.smtp_pass;
        }
        
        
        return new Promise((resolve, reject) => {
            db.run(`
                INSERT OR REPLACE INTO email_config (
                    id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, 
                    smtp_from, company_name, enabled, test_email, 
                    safety_officer_email, store_personnel_email, admin_email, 
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                '1', smtp_host, smtp_port, smtp_secure ? 1 : 0, smtp_user,
                smtp_pass, smtp_from, company_name, enabled ? 1 : 0, test_email,
                safety_officer_email, store_personnel_email, admin_email
            ], (err) => {
                if (err) reject(err);
                else {
                    // Clear cached config to force reload
                    this.currentConfig = null;
                    this.transporter = null;
                    resolve({ success: true, changes: 1 });
                }
            });
        });
    }
    
    /**
     * Get email transporter with current configuration
     */
    async getTransporter() {
        try {
            const config = await this.getEmailConfig();
            
            if (!config) {
                throw new Error('No email configuration found');
            }
            
            if (!config.enabled) {
                throw new Error('Email notifications are disabled');
            }
            
            // Check if SMTP host is configured
            if (!config.smtp_host || config.smtp_host.trim() === '') {
                throw new Error('SMTP host not configured');
            }
            
            // Create new transporter if config changed
            if (!this.transporter || JSON.stringify(this.currentConfig) !== JSON.stringify(config)) {
                this.currentConfig = config;
                
                // Gmail-specific configuration
                const transportConfig = {
                    host: config.smtp_host,
                    port: config.smtp_port,
                    auth: {
                        user: config.smtp_user,
                        pass: config.smtp_pass
                    }
                };

                // Configure TLS/SSL based on port and host
                if (config.smtp_host.includes('gmail') && config.smtp_port === 587) {
                    // Gmail with port 587 requires STARTTLS
                    transportConfig.secure = false;
                    transportConfig.requireTLS = true;
                    transportConfig.tls = {
                        ciphers: 'SSLv3'
                    };
                } else if (config.smtp_port === 465) {
                    // Port 465 uses secure SSL
                    transportConfig.secure = true;
                } else {
                    // Default configuration
                    transportConfig.secure = config.smtp_secure === 1;
                    transportConfig.tls = {
                        rejectUnauthorized: false
                    };
                }

                this.transporter = nodemailer.createTransport(transportConfig);
                
                console.log(`📧 Email transporter created with host: ${config.smtp_host}`);
            }
            
            return this.transporter;
        } catch (error) {
            console.error('Failed to get email transporter:', error);
            throw error;
        }
    }
    
    /**
     * Test email configuration
     */
    async testEmailConfig(testEmail = null) {
        try {
            const config = await this.getEmailConfig();
            const transporter = await this.getTransporter();
            
            const recipient = testEmail || config.test_email || config.smtp_user;
            
            const mailOptions = {
                from: config.smtp_from,
                to: recipient,
                subject: 'PPE Management System - Email Configuration Test',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #27AE60;">📧 Email Configuration Test</h2>
                        <p>This is a test email from the <strong>${config.company_name}</strong>.</p>
                        
                        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 16px 0;">
                            <h3>Configuration Details:</h3>
                            <ul>
                                <li><strong>SMTP Host:</strong> ${config.smtp_host}</li>
                                <li><strong>SMTP Port:</strong> ${config.smtp_port}</li>
                                <li><strong>Security:</strong> ${config.smtp_secure ? 'TLS/SSL' : 'None'}</li>
                                <li><strong>From Address:</strong> ${config.smtp_from}</li>
                            </ul>
                        </div>
                        
                        <p>If you receive this email, your email configuration is working correctly! ✅</p>
                        
                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
                        <p style="color: #6b7280; font-size: 12px;">
                            Sent at: ${new Date().toLocaleString()}<br>
                            From: ${config.company_name} PPE Management System
                        </p>
                    </div>
                `
            };
            
            const result = await transporter.sendMail(mailOptions);
            console.log(`✅ Test email sent successfully: ${result.messageId}`);
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: recipient,
                message: 'Test email sent successfully'
            };
            
        } catch (error) {
            console.error('❌ Failed to send test email:', error);
            return {
                success: false,
                error: error.message,
                message: 'Failed to send test email'
            };
        }
    }
    
    /**
     * Get recipient email addresses from configuration
     */
    async getRecipientEmails() {
        try {
            const config = await this.getEmailConfig();
            if (!config) {
                console.log('⚠️  No email configuration found, using fallback emails');
                return {
                    safety_officer: 'safety@company.com',
                    store_personnel: 'store@company.com',
                    admin: 'admin@company.com'
                };
            }
            return {
                safety_officer: config.safety_officer_email || 'safety@company.com',
                store_personnel: config.store_personnel_email || 'store@company.com',
                admin: config.admin_email || 'admin@company.com'
            };
        } catch (error) {
            console.error('❌ Failed to get recipient emails:', error);
            // Return fallback emails
            return {
                safety_officer: process.env.SAFETY_OFFICER_EMAIL || 'safety@company.com',
                store_personnel: process.env.STORE_PERSONNEL_EMAIL || 'store@company.com',
                admin: process.env.ADMIN_EMAIL || 'admin@company.com'
            };
        }
    }
    
    /**
     * Get notification preferences for admin
     */
    async getNotificationPreferences(adminEmail) {
        const db = getDb();
        
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM notification_preferences WHERE admin_email = ? ORDER BY notification_type',
                [adminEmail],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    
    /**
     * Update notification preferences for admin
     */
    async updateNotificationPreferences(adminEmail, preferences) {
        const db = getDb();
        
        try {
            for (const pref of preferences) {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT OR REPLACE INTO notification_preferences 
                        (admin_email, notification_type, enabled, frequency, updated_at) 
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    `, [
                        adminEmail, 
                        pref.notification_type, 
                        pref.enabled ? 1 : 0, 
                        pref.frequency || 'immediate'
                    ], function(err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
            
            return { success: true, message: 'Notification preferences updated' };
        } catch (error) {
            console.error('Failed to update notification preferences:', error);
            throw error;
        }
    }
    
    /**
     * Get email template
     */
    async getEmailTemplate(templateType) {
        const db = getDb();
        
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM email_templates WHERE template_type = ? AND enabled = 1',
                [templateType],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
    
    /**
     * Replace template variables
     */
    replaceTemplateVariables(template, variables) {
        let subject = template.subject;
        let htmlContent = template.html_content;
        
        Object.keys(variables).forEach(key => {
            const placeholder = `{{${key}}}`;
            const value = variables[key] || '';
            
            subject = subject.replace(new RegExp(placeholder, 'g'), value);
            htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), value);
        });
        
        return { subject, htmlContent };
    }
    
    /**
     * Check if notifications are enabled for admin and type
     */
    async isNotificationEnabled(adminEmail, notificationType) {
        const db = getDb();
        
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT enabled FROM notification_preferences 
                WHERE admin_email = ? AND notification_type = ?
            `, [adminEmail, notificationType], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.enabled === 1 : true); // Default to enabled if no preference
            });
        });
    }
}

module.exports = new EmailConfigService();