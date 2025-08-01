const nodemailer = require('nodemailer');
const emailConfigService = require('./emailConfigService');
const timezoneUtils = require('../utils/timezone-utils');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.initializationPromise = null;
    console.log('📧 Email service created - will initialize lazily when first used');
  }

  async initializeTransporter() {
    // Prevent multiple simultaneous initialization attempts
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._doInitialization();
    return this.initializationPromise;
  }

  async _doInitialization() {
    try {
      // Use database-driven email configuration
      this.transporter = await emailConfigService.getTransporter();
      this.initialized = true;
      console.log('📧 Email service initialized with database configuration!');
      return this.transporter;
    } catch (error) {
      console.log('📧 Email service configuration error:', error.message);
      console.log('   ⚠️ Email service will run without configuration - admin can configure in Email Settings');
      
      // Allow system to continue without email configuration
      this.transporter = null;
      this.initialized = false;
      return null;
    }
  }

  async getTransporter() {
    try {
      // Always try to get fresh configuration from database
      return await emailConfigService.getTransporter();
    } catch (error) {
      console.log('⚠️ Database email config failed:', error.message);
      
      // If no cached transporter, try to initialize
      if (!this.initialized && !this.initializationPromise) {
        console.log('📧 Attempting lazy initialization...');
        await this.initializeTransporter();
      }
      
      return this.transporter;
    }
  }

  /**
   * Clear cached configuration (call when email settings change)
   */
  clearCache() {
    console.log('🗑️ Clearing email service cache');
    this.transporter = null;
    this.initialized = false;
    this.initializationPromise = null;
  }

  /**
   * Send email notification to Safety Officer about new PPE request
   */
  async notifyNewPPERequest(requestData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping PPE request notification');
        return { success: true, message: 'Email notifications are disabled' };
      }

      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping PPE request notification');
        return { success: true, message: 'Email transporter not available' };
      }

      const recipients = await emailConfigService.getRecipientEmails();
      const { requestId, staffName, staffId, department, items, stationName, createdAt } = requestData;
      
      const subject = `🚨 New PPE Request Pending Approval - ${staffName}`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #27AE60; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0;">🛡️ New PPE Request</h2>
            <p style="margin: 8px 0 0 0;">A new PPE request requires your approval</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Request ID:</td>
                <td style="padding: 8px 0;">${requestId.substring(0, 8)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff Name:</td>
                <td style="padding: 8px 0;">${staffName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff ID:</td>
                <td style="padding: 8px 0;">${staffId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Department:</td>
                <td style="padding: 8px 0;">${department}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Station:</td>
                <td style="padding: 8px 0;">${stationName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Requested Items:</td>
                <td style="padding: 8px 0;">${items}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Request Time:</td>
                <td style="padding: 8px 0;">${timezoneUtils.formatForEmail(createdAt)}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="http://localhost:3000/admin.html" 
               style="background: #27AE60; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              🔍 Review Request
            </a>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: #856404;">
              ⚠️ <strong>Action Required:</strong> Please review and approve/reject this PPE request as soon as possible to ensure worker safety compliance.
            </p>
          </div>
        </div>
      `;

      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: recipients.safety_officer,
        subject,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Safety Officer notification sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send Safety Officer notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email notification to Store Personnel about approved PPE request
   */
  async notifyApprovedPPERequest(requestData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping notification');
        return { success: true, message: 'Email notifications are disabled' };
      }
      
      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping approved PPE request notification');
        return { success: true, message: 'Email transporter not available' };
      }
      const recipients = await emailConfigService.getRecipientEmails();
      const { requestId, staffName, staffId, department, items, stationName, approvedBy, approvalNotes } = requestData;
      
      const subject = `✅ PPE Request Approved - Prepare Items for ${staffName}`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #28a745; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0;">✅ PPE Request Approved</h2>
            <p style="margin: 8px 0 0 0;">Prepare PPE items for staff collection</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Request ID:</td>
                <td style="padding: 8px 0;">${requestId.substring(0, 8)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff Name:</td>
                <td style="padding: 8px 0;">${staffName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff ID:</td>
                <td style="padding: 8px 0;">${staffId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Department:</td>
                <td style="padding: 8px 0;">${department}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Station:</td>
                <td style="padding: 8px 0;">${stationName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Approved Items:</td>
                <td style="padding: 8px 0;">${items}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Approved By:</td>
                <td style="padding: 8px 0;">${approvedBy}</td>
              </tr>
              ${approvalNotes ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Notes:</td>
                <td style="padding: 8px 0;">${approvalNotes}</td>
              </tr>
              ` : ''}
            </table>
          </div>
          
          <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: #155724;">
              📦 <strong>Action Required:</strong> Please prepare the approved PPE items and notify the staff member for collection.
            </p>
          </div>
        </div>
      `;

      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: recipients.store_personnel,
        subject,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Store Personnel notification sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send Store Personnel notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email notification to staff about rejected PPE request
   */
  async notifyRejectedPPERequest(requestData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping rejection notification');
        return { success: true, message: 'Email notifications are disabled' };
      }

      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping rejected PPE request notification');
        return { success: true, message: 'Email transporter not available' };
      }
      const { requestId, staffName, staffEmail, items, rejectedBy, rejectionReason } = requestData;
      
      const subject = `❌ PPE Request Rejected - ${staffName} (${requestId.substring(0, 8)})`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #dc3545; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0;">❌ PPE Request Rejected</h2>
            <p style="margin: 8px 0 0 0;">A PPE request has been rejected by Safety Officer</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Request ID:</td>
                <td style="padding: 8px 0;">${requestId.substring(0, 8)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Requested Items:</td>
                <td style="padding: 8px 0;">${items}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Rejected By:</td>
                <td style="padding: 8px 0;">${rejectedBy}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Reason:</td>
                <td style="padding: 8px 0;">${rejectionReason}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: #721c24;">
              📋 <strong>Action:</strong> No PPE items need to be prepared for this request. The staff member has been notified of the rejection.
            </p>
          </div>
        </div>
      `;

      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: staffEmail,
        subject,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Staff rejection notification sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send staff rejection notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send rejection notification to Store Personnel
   */
  async notifyStorePersonnelRejection(requestData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping store personnel rejection notification');
        return { success: true, message: 'Email notifications are disabled' };
      }
      
      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping store personnel rejection notification');
        return { success: true, message: 'Email transporter not available' };
      }
      
      const recipients = await emailConfigService.getRecipientEmails();
      const { requestId, staffName, staffId, department, items, rejectedBy, rejectionReason } = requestData;
      
      const subject = `❌ PPE Request Rejected - ${staffName} (${requestId.substring(0, 8)})`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #dc3545; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0;">❌ PPE Request Rejected</h2>
            <p style="margin: 8px 0 0 0;">A PPE request has been rejected by Safety Officer</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Request ID:</td>
                <td style="padding: 8px 0;">${requestId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff Member:</td>
                <td style="padding: 8px 0;">${staffName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Staff ID:</td>
                <td style="padding: 8px 0;">${staffId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Department:</td>
                <td style="padding: 8px 0;">${department}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Items Requested:</td>
                <td style="padding: 8px 0;">${items}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Rejected By:</td>
                <td style="padding: 8px 0;">${rejectedBy}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Reason:</td>
                <td style="padding: 8px 0;">${rejectionReason}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: #721c24;">
              📋 <strong>Action:</strong> No PPE items need to be prepared for this request. The staff member has been notified of the rejection.
            </p>
          </div>
        </div>
      `;

      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: recipients.store_personnel,
        subject,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Store Personnel rejection notification sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send Store Personnel rejection notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send stock alert email to store personnel
   */
  async sendStockAlert(alertData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping stock alert');
        return { success: true, message: 'Email notifications are disabled' };
      }
      
      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping stock alert');
        return { success: true, message: 'Email transporter not available' };
      }

      const recipients = await emailConfigService.getRecipientEmails();
      const { stationName, stationLocation, itemName, itemCategory, currentStock, thresholdValue, severity, alertType } = alertData;
      
      const subject = `🚨 ${severity === 'CRITICAL' ? 'CRITICAL' : 'LOW'} Stock Alert - ${itemName}`;
      
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: ${severity === 'CRITICAL' ? '#dc3545' : '#f59e0b'}; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="margin: 0;">🚨 ${severity === 'CRITICAL' ? 'CRITICAL' : 'LOW'} Stock Alert</h2>
            <p style="margin: 8px 0 0 0;">${itemName} requires immediate attention</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Alert Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Item:</td>
                <td style="padding: 8px 0;">${itemName} (${itemCategory})</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Station:</td>
                <td style="padding: 8px 0;">${stationName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Location:</td>
                <td style="padding: 8px 0;">${stationLocation}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Current Stock:</td>
                <td style="padding: 8px 0; color: ${severity === 'CRITICAL' ? '#dc3545' : '#f59e0b'}; font-weight: bold;">${currentStock} units</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Threshold:</td>
                <td style="padding: 8px 0;">${thresholdValue} units</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Severity:</td>
                <td style="padding: 8px 0;">
                  <span style="background: ${severity === 'CRITICAL' ? '#dc3545' : '#f59e0b'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    ${severity}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #555;">Alert Time:</td>
                <td style="padding: 8px 0;">${timezoneUtils.formatForEmail(new Date())}</td>
              </tr>
            </table>
          </div>
          
          <div style="background: ${severity === 'CRITICAL' ? '#f8d7da' : '#fff3cd'}; border: 1px solid ${severity === 'CRITICAL' ? '#f5c6cb' : '#ffeaa7'}; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <p style="margin: 0; color: ${severity === 'CRITICAL' ? '#721c24' : '#856404'};">
              📦 <strong>Action Required:</strong> ${severity === 'CRITICAL' ? 'IMMEDIATELY restock this item to prevent worker safety issues!' : 'Please restock this item soon to maintain adequate safety inventory levels.'}
            </p>
          </div>
        </div>
      `;

      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: recipients.store_personnel,
        subject,
        html: htmlContent
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ Stock alert email sent: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send stock alert email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send VPS grace period warning email
   */
  async sendGracePeriodWarning(graceStatus) {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      // Get admin email from database
      const adminEmail = await new Promise((resolve) => {
        db.get(`SELECT email FROM users WHERE role = 'ADMIN' LIMIT 1`, [], (err, row) => {
          resolve(err ? null : row?.email);
        });
      });

      if (!adminEmail) {
        console.log('No admin email found for grace period warning');
        return;
      }

      const subject = `⚠️ PPE Management License Validation Warning`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #ff6b35; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">⚠️ License Validation Warning</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333;">Action Required: Internet Connection Needed</h2>
            
            <p style="font-size: 16px; line-height: 1.6;">
              Your PPE Management system needs to validate its license online. 
              The system is currently operating in grace period mode.
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #ff6b35;">
              <h3 style="margin-top: 0; color: #ff6b35;">Grace Period Status</h3>
              <p><strong>Days Remaining:</strong> ${graceStatus.daysRemaining} days</p>
              <p><strong>Total Grace Period:</strong> ${graceStatus.totalDays} days</p>
            </div>
            
            <h3 style="color: #333;">What You Need to Do:</h3>
            <ol style="font-size: 16px; line-height: 1.8;">
              <li><strong>Check Internet Connection:</strong> Ensure your PPE Management system has internet access</li>
              <li><strong>Restart the System:</strong> Restart the PPE Management application to attempt validation</li>
              <li><strong>Contact Support:</strong> If issues persist, contact support with your license details</li>
            </ol>
            
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; color: #856404;">
                <strong>Important:</strong> After ${graceStatus.daysRemaining} days, the system will require 
                successful online validation to continue operating.
              </p>
            </div>
            
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              This is an automated message from your PPE Management system. 
              For support, please contact your system administrator.
            </p>
          </div>
          
          <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
            PPE Management System - License Validation Service
          </div>
        </div>
      `;

      await this.sendEmail(adminEmail, subject, html);
      console.log(`✅ Grace period warning email sent to ${adminEmail}`);
      
    } catch (error) {
      console.error('❌ Failed to send grace period warning email:', error);
      throw error;
    }
  }

  /**
   * Send test email to verify configuration
   */
  async sendTestEmail(recipientEmail) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        return { success: false, message: 'Email is not configured or disabled' };
      }
      
      const transporter = await this.getTransporter();
      
      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: recipientEmail,
        subject: '🧪 PPE Management System - Email Test',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #27AE60;">✅ Email Configuration Test</h2>
            <p>This is a test email from the PPE Management System.</p>
            <p>If you receive this email, the email notification system is working correctly.</p>
            <p><strong>Timestamp:</strong> ${timezoneUtils.formatForEmail(new Date())}</p>
          </div>
        `
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Test email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send test email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email with attachment (for scheduled reports)
   */
  async sendEmailWithAttachment(emailData) {
    try {
      // Check if email is configured and enabled first
      const config = await emailConfigService.getEmailConfig();
      if (!config || !config.enabled || !config.smtp_host) {
        console.log('📧 Email notifications disabled or not configured - skipping email with attachment');
        return { success: true, message: 'Email notifications are disabled' };
      }

      const transporter = await this.getTransporter();
      if (!transporter) {
        console.log('📧 No email transporter available - skipping email with attachment');
        return { success: true, message: 'Email transporter not available' };
      }
      const { to, subject, html, attachments } = emailData;
      
      const mailOptions = {
        from: config?.smtp_from || 'PPE Management System <noreply@ppemanagement.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        attachments
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Email with attachment sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send email with attachment:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();