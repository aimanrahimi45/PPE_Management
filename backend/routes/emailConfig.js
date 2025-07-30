/**
 * Email Configuration API Routes
 * Provides endpoints for managing email settings through admin interface
 */

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess } = require('../middleware/featureFlag');
const emailConfigService = require('../services/emailConfigService');
const emailService = require('../services/emailService');

const router = express.Router();

// Get current email configuration
router.get('/config', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const config = await emailConfigService.getEmailConfig();
        
        if (!config) {
            return res.status(404).json({ 
                success: false, 
                error: 'No email configuration found' 
            });
        }
        
        // Don't expose sensitive password in response
        const safeConfig = {
            ...config,
            smtp_pass: config.smtp_pass ? '••••••••' : ''
        };
        
        res.json({
            success: true,
            config: safeConfig
        });
        
    } catch (error) {
        console.error('Get email config error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get email configuration' 
        });
    }
});

// Update email configuration
router.put('/config', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const {
            smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
            smtp_from, company_name, enabled, test_email,
            safety_officer_email, store_personnel_email, admin_email
        } = req.body;
        
        // Validate required fields
        if (!smtp_host || !smtp_port || !smtp_user || !smtp_from) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: smtp_host, smtp_port, smtp_user, smtp_from'
            });
        }
        
        const result = await emailConfigService.updateEmailConfig({
            smtp_host,
            smtp_port: parseInt(smtp_port),
            smtp_secure: smtp_secure === true || smtp_secure === 'true',
            smtp_user,
            smtp_pass,
            smtp_from,
            company_name: company_name || 'PPE Management System',
            enabled: enabled !== false && enabled !== 'false',
            test_email,
            safety_officer_email,
            store_personnel_email,
            admin_email
        });

        // Clear email service cache to reload configuration
        emailService.clearCache();
        
        res.json({
            success: true,
            message: 'Email configuration updated successfully',
            changes: result.changes
        });
        
    } catch (error) {
        console.error('Update email config error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update email configuration' 
        });
    }
});

// Test email configuration
router.post('/test', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const { test_email } = req.body;
        
        const result = await emailConfigService.testEmailConfig(test_email);
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                messageId: result.messageId,
                recipient: result.recipient
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                message: result.message
            });
        }
        
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to send test email' 
        });
    }
});

// Get notification preferences for current admin
router.get('/preferences', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        // Get admin email from database configuration (primary) or fallback to user email
        const config = await emailConfigService.getEmailConfig();
        const adminEmail = (config && config.admin_email) 
            ? config.admin_email 
            : (req.user.email || 'admin@company.com');
            
        const preferences = await emailConfigService.getNotificationPreferences(adminEmail);
        
        res.json({
            success: true,
            preferences,
            admin_email: adminEmail,
            source: config && config.admin_email ? 'database' : 'fallback'
        });
        
    } catch (error) {
        console.error('Get notification preferences error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get notification preferences' 
        });
    }
});

// Update notification preferences for current admin
router.put('/preferences', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        // Get admin email from database configuration (primary) or fallback to user email
        const config = await emailConfigService.getEmailConfig();
        const adminEmail = (config && config.admin_email) 
            ? config.admin_email 
            : (req.user.email || 'admin@company.com');
            
        const { preferences } = req.body;
        
        if (!Array.isArray(preferences)) {
            return res.status(400).json({
                success: false,
                error: 'Preferences must be an array'
            });
        }
        
        const result = await emailConfigService.updateNotificationPreferences(adminEmail, preferences);
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('Update notification preferences error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update notification preferences' 
        });
    }
});

// Get available notification types
router.get('/notification-types', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const notificationTypes = [
            {
                type: 'ppe_request_new',
                name: 'New PPE Requests',
                description: 'Notification when workers submit new PPE requests'
            },
            {
                type: 'ppe_request_approved',
                name: 'PPE Request Approved',
                description: 'Notification when PPE requests are approved'
            },
            {
                type: 'ppe_request_rejected',
                name: 'PPE Request Rejected',
                description: 'Notification when PPE requests are rejected'
            },
            {
                type: 'stock_low',
                name: 'Low Stock Alerts',
                description: 'Alert when PPE stock levels are low'
            },
            {
                type: 'stock_critical',
                name: 'Critical Stock Alerts',
                description: 'Alert when PPE stock levels are critically low'
            },
            {
                type: 'license_expiring',
                name: 'License Expiration Warnings',
                description: 'Warning when system license is about to expire'
            },
            {
                type: 'weekly_summary',
                name: 'Weekly Summary Reports',
                description: 'Weekly summary of PPE usage and statistics'
            },
            {
                type: 'monthly_summary',
                name: 'Monthly Summary Reports',
                description: 'Monthly summary of PPE usage and statistics'
            }
        ];
        
        res.json({
            success: true,
            notification_types: notificationTypes
        });
        
    } catch (error) {
        console.error('Get notification types error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get notification types' 
        });
    }
});

// Get email templates
router.get('/templates', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const { getDb } = require('../database/init');
        const db = getDb();
        
        const templates = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM email_templates ORDER BY template_type', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        res.json({
            success: true,
            templates
        });
        
    } catch (error) {
        console.error('Get email templates error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get email templates' 
        });
    }
});

// Update email template
router.put('/templates/:templateType', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const { templateType } = req.params;
        const { subject, html_content, enabled } = req.body;
        
        if (!subject || !html_content) {
            return res.status(400).json({
                success: false,
                error: 'Subject and HTML content are required'
            });
        }
        
        const { getDb } = require('../database/init');
        const db = getDb();
        
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE email_templates 
                SET subject = ?, html_content = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
                WHERE template_type = ?
            `, [subject, html_content, enabled !== false, templateType], function(err) {
                if (err) reject(err);
                else if (this.changes === 0) reject(new Error('Template not found'));
                else resolve();
            });
        });
        
        res.json({
            success: true,
            message: 'Email template updated successfully'
        });
        
    } catch (error) {
        console.error('Update email template error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to update email template' 
        });
    }
});

// Get real password for visibility toggle (admin only)
router.get('/real-password', authenticateToken, checkFeatureAccess('email_notifications'), async (req, res) => {
    try {
        const config = await emailConfigService.getEmailConfig();
        
        if (!config) {
            return res.status(404).json({
                success: false,
                error: 'Email configuration not found'
            });
        }
        
        res.json({
            success: true,
            password: config.smtp_pass || ''
        });
        
    } catch (error) {
        console.error('Error getting real password:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;