const { getDb } = require('../database/init');
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');

class NotificationService {
  constructor() {
    this.initializeWebPush();
    // Note: initializeNotificationTables() called lazily when needed
  }

  // Lazy database connection - only get when needed
  getDatabase() {
    return getDb();
  }

  /**
   * Initialize Web Push with VAPID keys
   */
  initializeWebPush() {
    // Generate or use existing VAPID keys
    const publicKey = process.env.VAPID_PUBLIC_KEY || 'BEhNhDzulDM7JgyHSprx_-8ltm2_Y8lu_wzlVWcitRW5R_dbYZL-65CX5g7zvfKsvYTPO0r8CgowGENXn-Vsxvw';
    const privateKey = process.env.VAPID_PRIVATE_KEY || '98UHEbN-eM7JbfzZfGQoNtu3ede_k3ogDTsjPvskrMI';
    
    webpush.setVapidDetails(
      'mailto:admin@ppemanagement.com',
      publicKey,
      privateKey
    );
    
    console.log('🔔 Push notification service initialized');
  }

  /**
   * Initialize notification tables
   */
  async initializeNotificationTables() {
    return new Promise((resolve, reject) => {
      // Create push_subscriptions table
      this.getDatabase().run(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id TEXT PRIMARY KEY,
          staff_id TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          p256dh_key TEXT NOT NULL,
          auth_key TEXT NOT NULL,
          user_agent TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
          active INTEGER DEFAULT 1
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          // Create notifications table
          this.getDatabase().run(`
            CREATE TABLE IF NOT EXISTS notifications (
              id TEXT PRIMARY KEY,
              staff_id TEXT NOT NULL,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              body TEXT NOT NULL,
              data TEXT,
              sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              read_at DATETIME,
              action_taken DATETIME,
              request_id TEXT
            )
          `, (err) => {
            if (err) {
              reject(err);
            } else {
              console.log('📱 Notification tables initialized');
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Subscribe a user to push notifications
   */
  async subscribeToPushNotifications(staffId, subscription) {
    const id = uuidv4();
    
    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        INSERT OR REPLACE INTO push_subscriptions 
        (id, staff_id, endpoint, p256dh_key, auth_key, user_agent, last_used) 
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        id,
        staffId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        subscription.userAgent || 'Unknown'
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`📱 Push subscription added for staff: ${staffId}`);
          resolve({ id, success: true });
        }
      });
    });
  }

  /**
   * Get active push subscriptions for a staff member
   */
  async getPushSubscriptions(staffId) {
    return new Promise((resolve, reject) => {
      this.getDatabase().all(`
        SELECT * FROM push_subscriptions 
        WHERE staff_id = ? AND active = 1
        ORDER BY last_used DESC
      `, [staffId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Send push notification to a staff member
   */
  async sendPushNotification(staffId, notification) {
    try {
      // Check if staffId is valid before proceeding
      if (!staffId || staffId === null || staffId === undefined) {
        console.log('📱 Cannot send push notification - invalid staffId:', staffId);
        return { success: false, reason: 'Invalid staff ID' };
      }

      // Store notification in database
      const notificationId = uuidv4();
      await this.storeNotification(notificationId, staffId, notification);

      // Get push subscriptions for staff
      const subscriptions = await this.getPushSubscriptions(staffId);
      
      if (subscriptions.length === 0) {
        console.log(`📱 No active push subscriptions for staff: ${staffId}`);
        return { success: false, reason: 'No active subscriptions' };
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        icon: '/manifest-icon-192.png',
        badge: '/manifest-icon-192.png',
        data: {
          ...notification.data,
          notificationId: notificationId,
          url: notification.url || '/worker.html'
        },
        actions: notification.actions || []
      });

      const results = [];
      
      for (const subscription of subscriptions) {
        try {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh_key,
              auth: subscription.auth_key
            }
          };

          await webpush.sendNotification(pushSubscription, payload);
          
          // Update last_used timestamp
          await this.updateSubscriptionLastUsed(subscription.id);
          
          results.push({ subscriptionId: subscription.id, success: true });
          
        } catch (error) {
          console.error(`Failed to send push notification to subscription ${subscription.id}:`, error);
          
          // If subscription is invalid, mark as inactive
          if (error.statusCode === 410 || error.statusCode === 404) {
            await this.deactivateSubscription(subscription.id);
          }
          
          results.push({ 
            subscriptionId: subscription.id, 
            success: false, 
            error: error.message 
          });
        }
      }

      const successfulSends = results.filter(r => r.success).length;
      console.log(`📱 Push notification sent to ${successfulSends}/${results.length} subscriptions for staff: ${staffId}`);
      
      return { 
        success: successfulSends > 0, 
        results,
        notificationId
      };

    } catch (error) {
      console.error('Failed to send push notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Store notification in database
   */
  async storeNotification(notificationId, staffId, notification) {
    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        INSERT INTO notifications (id, staff_id, type, title, body, data, request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        notificationId,
        staffId,
        notification.type,
        notification.title,
        notification.body,
        JSON.stringify(notification.data || {}),
        notification.requestId || null
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get notifications for a staff member
   */
  async getNotifications(staffId, limit = 50) {
    return new Promise((resolve, reject) => {
      this.getDatabase().all(`
        SELECT * FROM notifications 
        WHERE staff_id = ? 
        ORDER BY sent_at DESC 
        LIMIT ?
      `, [staffId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Parse data field
          const notifications = rows.map(row => ({
            ...row,
            data: row.data ? JSON.parse(row.data) : {}
          }));
          resolve(notifications);
        }
      });
    });
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId) {
    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        UPDATE notifications 
        SET read_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [notificationId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Update subscription last used timestamp
   */
  async updateSubscriptionLastUsed(subscriptionId) {
    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        UPDATE push_subscriptions 
        SET last_used = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [subscriptionId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Deactivate invalid subscription
   */
  async deactivateSubscription(subscriptionId) {
    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        UPDATE push_subscriptions 
        SET active = 0 
        WHERE id = ?
      `, [subscriptionId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send notification when PPE request status changes
   */
  async notifyRequestStatusUpdate(staffId, requestId, status, details) {
    // Check if staffId is valid before proceeding
    if (!staffId || staffId === null || staffId === undefined) {
      console.log('📱 Cannot send request status notification - invalid staffId:', staffId);
      return { success: false, reason: 'Invalid staff ID' };
    }

    const statusMessages = {
      approved: {
        title: '✅ PPE Request Approved',
        body: `Your PPE request has been approved. Items are ready for collection.`,
        type: 'request_approved'
      },
      rejected: {
        title: '❌ PPE Request Rejected',
        body: `Your PPE request was rejected. ${details?.reason || 'Please contact safety officer for details.'}`,
        type: 'request_rejected'
      },
      ready: {
        title: '📦 PPE Items Ready',
        body: `Your approved PPE items are ready for collection at the storage location.`,
        type: 'request_ready'
      }
    };

    const notification = statusMessages[status];
    if (!notification) {
      console.warn(`Unknown request status: ${status}`);
      return;
    }

    await this.sendPushNotification(staffId, {
      ...notification,
      requestId: requestId,
      data: {
        requestId: requestId,
        status: status,
        ...details
      },
      url: '/worker.html?tab=history'
    });
  }

  /**
   * Send notification for low stock alerts (to admins)
   */
  async notifyLowStock(staffId, stationName, itemName, currentStock, threshold) {
    await this.sendPushNotification(staffId, {
      title: '🚨 Low Stock Alert',
      body: `${itemName} at ${stationName} is low (${currentStock} remaining, threshold: ${threshold})`,
      type: 'stock_alert',
      data: {
        stationName,
        itemName,
        currentStock,
        threshold
      },
      url: '/admin.html?tab=inventory'
    });
  }
}

module.exports = new NotificationService();