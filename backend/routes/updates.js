/**
 * Software Update Check Routes
 * Provides endpoints for update notifications and changelog viewing
 */

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const updateCheckService = require('../services/updateCheckService');

const router = express.Router();

// Get current update status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = updateCheckService.getUpdateStatus();
    
    res.json({
      success: true,
      ...status
    });
    
  } catch (error) {
    console.error('Get update status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get update status'
    });
  }
});

// Manual update check
router.post('/check', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Manual update check triggered by admin');
    
    // Get user info from token
    const currentUser = req.user;
    console.log('👤 Update check requested by:', currentUser.name || currentUser.email);
    
    const result = await updateCheckService.checkForUpdates();
    
    if (result) {
      res.json({
        success: true,
        message: 'Update check completed',
        ...result
      });
    } else {
      // If VPS check failed, still return current version info
      res.json({
        success: true,
        updateAvailable: false,
        currentVersion: updateCheckService.currentVersion,
        latestVersion: null,
        message: 'Update check completed - no updates available or VPS unreachable'
      });
    }
    
  } catch (error) {
    console.error('Manual update check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check for updates',
      message: error.message
    });
  }
});

// Get changelog for specific version
router.get('/changelog/:version', authenticateToken, async (req, res) => {
  try {
    const { version } = req.params;
    
    console.log(`📋 Fetching changelog for version: ${version}`);
    
    const changelog = await updateCheckService.getChangelog(version);
    
    if (changelog) {
      res.json({
        success: true,
        ...changelog
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Changelog not found',
        message: 'Unable to fetch changelog for this version'
      });
    }
    
  } catch (error) {
    console.error('Get changelog error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch changelog'
    });
  }
});

// Get pending update notifications
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await updateCheckService.getPendingUpdateNotifications();
    
    res.json({
      success: true,
      notifications,
      count: notifications.length
    });
    
  } catch (error) {
    console.error('Get update notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get update notifications'
    });
  }
});

// Dismiss update notification
router.post('/notifications/:version/dismiss', authenticateToken, async (req, res) => {
  try {
    const { version } = req.params;
    
    console.log(`❌ Dismissing update notification for version: ${version}`);
    
    const success = await updateCheckService.dismissUpdateNotification(version);
    
    if (success) {
      res.json({
        success: true,
        message: 'Update notification dismissed'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss notification'
      });
    }
    
  } catch (error) {
    console.error('Dismiss update notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to dismiss update notification'
    });
  }
});

// Get system info for update tracking
router.get('/system-info', authenticateToken, async (req, res) => {
  try {
    const os = require('os');
    const packageJson = require('../../package.json');
    
    const systemInfo = {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      currentVersion: updateCheckService.currentVersion,
      packageVersion: packageJson.version || 'unknown'
    };
    
    res.json({
      success: true,
      systemInfo
    });
    
  } catch (error) {
    console.error('Get system info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system information'
    });
  }
});

// Debug endpoint to compare device fingerprints
router.get('/debug', authenticateToken, async (req, res) => {
  try {
    const crypto = require('crypto');
    const os = require('os');
    
    // Update service fingerprint (current)
    const updateDeviceInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      networkInterfaces: Object.keys(os.networkInterfaces())
    };
    const updateFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(updateDeviceInfo))
      .digest('hex');

    res.json({
      success: true,
      debug_info: {
        update_service: {
          fingerprint: updateFingerprint,
          device_info: updateDeviceInfo
        },
        expected_vps_fingerprint: 'ffd7e9b5834a4dfa483b7787d2269cd5770ed789319ab2dbcdd6022e3621ab89',
        vps_registered_license: 'VPS-4CB30C4366308EF5',
        match: updateFingerprint === 'ffd7e9b5834a4dfa483b7787d2269cd5770ed789319ab2dbcdd6022e3621ab89'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;