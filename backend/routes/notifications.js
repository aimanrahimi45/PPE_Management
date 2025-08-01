const express = require('express');
const notificationService = require('../services/notificationService');

const router = express.Router();

// Subscribe to push notifications
router.post('/subscribe', async (req, res) => {
  try {
    const { staffId, subscription, userAgent } = req.body;

    if (!staffId || !subscription) {
      return res.status(400).json({ 
        error: 'Staff ID and subscription are required' 
      });
    }

    const result = await notificationService.subscribeToPushNotifications(
      staffId, 
      { ...subscription, userAgent }
    );

    res.json({
      success: true,
      message: 'Successfully subscribed to push notifications',
      subscriptionId: result.id
    });

  } catch (error) {
    console.error('Subscribe to notifications error:', error);
    res.status(500).json({ 
      error: 'Failed to subscribe to notifications' 
    });
  }
});

// Get notifications for a staff member
router.get('/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const notifications = await notificationService.getNotifications(staffId, limit);

    res.json({
      success: true,
      notifications,
      count: notifications.length
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve notifications' 
    });
  }
});

// Mark notification as read
router.put('/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;

    await notificationService.markNotificationAsRead(notificationId);

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ 
      error: 'Failed to mark notification as read' 
    });
  }
});

// Send test notification (for testing purposes)
router.post('/test', async (req, res) => {
  try {
    const { staffId, title, body } = req.body;

    if (!staffId) {
      return res.status(400).json({ 
        error: 'Staff ID is required' 
      });
    }

    // Use default test notification content if not provided
    const testTitle = title || '🧪 Test Notification';
    const testBody = body || `Push notifications are working! Sent at ${new Date().toLocaleString()}`;

    const result = await notificationService.sendPushNotification(staffId, {
      title: testTitle,
      body: testBody,
      type: 'test',
      data: { 
        timestamp: new Date().toISOString(),
        isTest: true
      }
    });

    res.json({
      success: result.success,
      message: result.success ? 'Test notification sent successfully' : 'Failed to send notification',
      details: result
    });

  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(500).json({ 
      error: 'Failed to send test notification' 
    });
  }
});

// Get VAPID public key for client registration
router.get('/vapid-public-key', (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || 'BEhNhDzulDM7JgyHSprx_-8ltm2_Y8lu_wzlVWcitRW5R_dbYZL-65CX5g7zvfKsvYTPO0r8CgowGENXn-Vsxvw';
  
  res.json({
    success: true,
    publicKey
  });
});

// Get notification statistics for admin
router.get('/stats', async (req, res) => {
  try {
    // This would require additional database queries
    // For now, return basic stats
    res.json({
      success: true,
      stats: {
        totalNotifications: 0,
        activeSubscriptions: 0,
        message: 'Statistics endpoint - implementation pending'
      }
    });

  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve notification statistics' 
    });
  }
});

module.exports = router;