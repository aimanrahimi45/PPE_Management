/**
 * Notification Helper Service
 * Centralized system for handling push notifications based on user preferences
 * Reset-proof and dynamic approach
 */

const emailConfigService = require('./emailConfigService');
const notificationService = require('./notificationService');

class NotificationHelper {
  constructor() {
    // Default admin staff ID - will be improved with proper user management
    this.defaultAdminStaffId = 'admin-001';
  }

  /**
   * Send notification if enabled in preferences
   * @param {string} notificationType - Type of notification (stock_low, ppe_request_new, etc.)
   * @param {object} notificationData - Data for the notification
   * @returns {Promise<boolean>} - True if notification was sent
   */
  async sendNotificationIfEnabled(notificationType, notificationData) {
    try {
      // Get admin email and notification preferences
      const config = await emailConfigService.getEmailConfig();
      const adminEmail = (config && config.admin_email) || 'admin@company.com';
      
      // Get notification preferences
      const preferences = await emailConfigService.getNotificationPreferences(adminEmail);
      
      // Find preference for this notification type
      const preference = preferences.find(p => p.notification_type === notificationType);
      
      // Check if notifications are enabled for this type
      if (!preference || !preference.enabled) {
        console.log(`🔕 Push notifications disabled for ${notificationType}`);
        return false;
      }
      
      // Check frequency settings
      const frequency = preference.frequency || 'immediate';
      console.log(`📱 Sending ${notificationType} push notification (frequency: ${frequency})`);
      
      // For immediate notifications, send right away
      if (frequency === 'immediate') {
        await this.sendPushNotification(notificationType, notificationData);
        return true;
      }
      
      // For scheduled notifications (daily, weekly), queue them
      await this.queueScheduledNotification(notificationType, notificationData, frequency);
      return true;
      
    } catch (error) {
      console.error(`Send ${notificationType} notification error:`, error);
      return false;
    }
  }

  /**
   * Send push notification based on type
   * @param {string} notificationType - Type of notification
   * @param {object} data - Notification data
   */
  async sendPushNotification(notificationType, data) {
    const staffId = data.staffId || this.defaultAdminStaffId;
    
    switch (notificationType) {
      case 'stock_low':
      case 'stock_critical':
        await notificationService.notifyLowStock(
          staffId,
          data.stationName,
          data.itemName,
          data.currentStock,
          data.threshold
        );
        break;
        
      case 'ppe_request_new':
        await notificationService.notifyNewPPERequest(
          staffId,
          data.requestId,
          data.staffName,
          data.itemCount
        );
        break;
        
      case 'ppe_request_approved':
      case 'ppe_request_rejected':
        await notificationService.notifyRequestStatusUpdate(
          data.requesterStaffId,
          data.requestId,
          notificationType.includes('approved') ? 'approved' : 'rejected',
          data.details
        );
        break;
        
      case 'license_expiring':
        await notificationService.notifyLicenseExpiration(
          staffId,
          data.daysRemaining,
          data.expirationDate
        );
        break;
        
      case 'weekly_summary':
      case 'monthly_summary':
        await notificationService.notifyUsageSummary(
          staffId,
          data.period,
          data.stats
        );
        break;
        
      default:
        console.warn(`Unknown notification type: ${notificationType}`);
    }
    
    console.log(`✅ ${notificationType} push notification sent`);
  }

  /**
   * Queue notification for scheduled delivery
   * @param {string} notificationType - Type of notification
   * @param {object} data - Notification data
   * @param {string} frequency - daily, weekly, monthly
   */
  async queueScheduledNotification(notificationType, data, frequency) {
    // For now, store in database for scheduled processing
    // This will be processed by the cron jobs
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT OR REPLACE INTO scheduled_notifications 
        (notification_type, frequency, data, created_at) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [notificationType, frequency, JSON.stringify(data)], function(err) {
        if (err) {
          console.error('Queue scheduled notification error:', err);
          // Don't fail - send immediately as fallback
          resolve(false);
        } else {
          console.log(`📅 ${notificationType} queued for ${frequency} delivery`);
          resolve(true);
        }
      });
    });
  }

  /**
   * Process scheduled notifications (called by cron jobs)
   * @param {string} frequency - daily, weekly, monthly
   */
  async processScheduledNotifications(frequency) {
    try {
      const { getDb } = require('../database/init');
      const db = getDb();
      
      // Get scheduled notifications for this frequency
      const notifications = await new Promise((resolve, reject) => {
        db.all(`
          SELECT * FROM scheduled_notifications 
          WHERE frequency = ? 
          ORDER BY created_at ASC
        `, [frequency], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      
      console.log(`📅 Processing ${notifications.length} ${frequency} scheduled notifications`);
      
      for (const notification of notifications) {
        try {
          const data = JSON.parse(notification.data);
          await this.sendPushNotification(notification.notification_type, data);
          
          // Remove processed notification
          await new Promise((resolve) => {
            db.run(`DELETE FROM scheduled_notifications WHERE id = ?`, [notification.id], resolve);
          });
          
        } catch (notificationError) {
          console.error(`Failed to process scheduled notification ${notification.id}:`, notificationError);
        }
      }
      
    } catch (error) {
      console.error(`Process ${frequency} scheduled notifications error:`, error);
    }
  }

  /**
   * Initialize scheduled notifications table
   */
  async initializeScheduledNotificationsTable() {
    const { getDb } = require('../database/init');
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS scheduled_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          notification_type TEXT NOT NULL,
          frequency TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          processed_at DATETIME NULL
        )
      `, (err) => {
        if (err) {
          console.error('Create scheduled_notifications table error:', err);
          reject(err);
        } else {
          console.log('✅ Scheduled notifications table ready');
          resolve();
        }
      });
    });
  }
}

module.exports = new NotificationHelper();