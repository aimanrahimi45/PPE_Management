/**
 * Update Notifications UI Component
 * Handles automatic update checking and notification display
 */

class UpdateNotifications {
  constructor() {
    this.updateCheckInterval = 6 * 60 * 60 * 1000; // 6 hours
    this.lastUpdateCheck = null;
    this.updateAvailable = false;
    this.latestVersionInfo = null;
    this.notificationBanner = null;
    this.initialized = false;
  }

  /**
   * Initialize update notifications system
   */
  async initialize() {
    try {
      if (this.initialized) {
        console.log('ℹ️ Update notifications already initialized');
        return;
      }

      console.log('🔄 Initializing update notifications...');
      
      // Create notification banner container
      this.createNotificationContainer();
      
      // Check for updates on page load
      await this.checkForUpdates();
      
      // Load pending notifications
      await this.loadPendingNotifications();
      
      // Start periodic update checking
      this.startPeriodicUpdates();
      
      this.initialized = true;
      console.log('✅ Update notifications initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize update notifications:', error);
    }
  }

  /**
   * Create notification banner container
   */
  createNotificationContainer() {
    // Create container if it doesn't exist
    if (!document.getElementById('update-notifications-container')) {
      const container = document.createElement('div');
      container.id = 'update-notifications-container';
      container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10000;
        pointer-events: none;
      `;
      
      document.body.appendChild(container);
    }
  }

  /**
   * Get authentication token dynamically
   */
  getAuthToken() {
    // List of possible auth token keys (reset-proof)
    const possibleTokenKeys = [
      'authToken',
      'ppe_auth_token', 
      'auth_token',
      'token',
      'jwt_token',
      'access_token',
      'bearer_token'
    ];
    
    for (const key of possibleTokenKeys) {
      const token = localStorage.getItem(key);
      if (token && token !== 'null' && token.length > 10) {
        console.log(`🔑 Found auth token with key: ${key}`);
        return token;
      }
    }
    
    return null;
  }

  /**
   * Check for software updates
   */
  async checkForUpdates() {
    try {
      console.log('🔍 Checking for software updates...');
      
      // Get auth token dynamically
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.log('⚠️ No authentication token found - skipping update check');
        return null;
      }
      
      const response = await fetch('/api/updates/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Update check failed: HTTP ${response.status}`, errorText);
        
        // Handle specific error cases
        if (response.status === 401 || response.status === 403) {
          console.warn('🔐 Authentication issue - user may need to login again');
          return null;
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.lastUpdateCheck = new Date();
        this.updateAvailable = data.updateAvailable;
        this.latestVersionInfo = data.latestVersion;
        
        console.log('✅ Update check completed:', {
          current: data.currentVersion,
          latest: data.latestVersion?.version || 'none',
          updateAvailable: data.updateAvailable,
          message: data.message
        });
        
        // Only show notification if there's actually an update available
        if (data.updateAvailable && data.latestVersion) {
          console.log('🆕 New version available:', data.latestVersion.version);
          this.showUpdateNotification(data.latestVersion);
        } else {
          console.log('ℹ️ No updates available - current version is up to date');
        }
        
        return data;
      } else {
        console.warn('⚠️ Update check failed:', data.error || data.message);
        return null;
      }
      
    } catch (error) {
      console.error('❌ Update check error:', error);
      return null;
    }
  }

  /**
   * Load pending update notifications
   */
  async loadPendingNotifications() {
    try {
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.log('⚠️ No auth token for pending notifications check');
        return;
      }

      const response = await fetch('/api/updates/notifications', {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.notifications.length > 0) {
        console.log(`📬 Found ${data.notifications.length} pending update notifications`);
        
        // Show the most recent notification
        const latestNotification = data.notifications[0];
        this.showUpdateNotificationFromDB(latestNotification);
      }
      
    } catch (error) {
      console.error('❌ Failed to load pending notifications:', error);
    }
  }

  /**
   * Show update notification banner
   */
  showUpdateNotification(versionInfo) {
    // Remove existing notification
    this.hideUpdateNotification();
    
    const isSecurityUpdate = versionInfo.securityUpdate;
    const isMandatory = versionInfo.mandatory;
    
    const banner = document.createElement('div');
    banner.id = 'update-notification-banner';
    banner.style.cssText = `
      background: ${isSecurityUpdate ? '#dc3545' : (isMandatory ? '#fd7e14' : '#007bff')};
      color: white;
      padding: 12px 20px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      animation: slideDown 0.3s ease-out;
    `;
    
    const urgencyIcon = isSecurityUpdate ? '🚨' : (isMandatory ? '⚠️' : '🆕');
    const urgencyText = isSecurityUpdate ? 'SECURITY UPDATE' : (isMandatory ? 'MANDATORY UPDATE' : 'UPDATE AVAILABLE');
    
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 18px;">${urgencyIcon}</span>
        <div>
          <strong>${urgencyText}: PPE Management System v${versionInfo.version}</strong>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">
            Released: ${new Date(versionInfo.releaseDate).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <button id="view-changelog-btn" style="
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.3);
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        ">View Changes</button>
        ${!isMandatory ? `<button id="dismiss-update-btn" style="
          background: transparent;
          border: none;
          color: white;
          cursor: pointer;
          font-size: 18px;
          padding: 4px;
          opacity: 0.7;
        " title="Dismiss notification">×</button>` : ''}
      </div>
    `;
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
    
    // Add event listeners
    banner.querySelector('#view-changelog-btn').addEventListener('click', () => {
      this.showChangelogModal(versionInfo.version);
    });
    
    if (!isMandatory) {
      banner.querySelector('#dismiss-update-btn').addEventListener('click', () => {
        this.dismissNotification(versionInfo.version);
      });
    }
    
    // Add to container
    document.getElementById('update-notifications-container').appendChild(banner);
    this.notificationBanner = banner;
    
    // Auto-hide non-mandatory notifications after 30 seconds
    if (!isMandatory && !isSecurityUpdate) {
      setTimeout(() => {
        if (this.notificationBanner === banner) {
          this.hideUpdateNotification();
        }
      }, 30000);
    }
  }

  /**
   * Show update notification from database
   */
  showUpdateNotificationFromDB(notification) {
    const versionInfo = {
      version: notification.version,
      releaseDate: notification.release_date,
      securityUpdate: !!notification.security_update,
      mandatory: !!notification.mandatory
    };
    
    this.showUpdateNotification(versionInfo);
  }

  /**
   * Hide update notification
   */
  hideUpdateNotification() {
    if (this.notificationBanner) {
      this.notificationBanner.style.animation = 'slideUp 0.3s ease-in';
      setTimeout(() => {
        if (this.notificationBanner && this.notificationBanner.parentNode) {
          this.notificationBanner.parentNode.removeChild(this.notificationBanner);
        }
        this.notificationBanner = null;
      }, 300);
    }
  }

  /**
   * Dismiss update notification
   */
  async dismissNotification(version) {
    try {
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.log('⚠️ No auth token for dismissing notification');
        return false;
      }

      const response = await fetch(`/api/updates/notifications/${version}/dismiss`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (response.ok) {
        console.log(`✅ Update notification dismissed for version ${version}`);
        this.hideUpdateNotification();
      } else {
        console.error('❌ Failed to dismiss notification');
      }
      
    } catch (error) {
      console.error('❌ Error dismissing notification:', error);
    }
  }

  /**
   * Show changelog modal
   */
  async showChangelogModal(version) {
    try {
      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'changelog-modal-backdrop';
      backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      `;
      
      // Create modal
      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        max-width: 600px;
        max-height: 80vh;
        width: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      
      modal.innerHTML = `
        <div style="padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; color: #333;">What's New in v${version}</h3>
          <button id="close-changelog-btn" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">×</button>
        </div>
        <div id="changelog-content" style="
          padding: 20px;
          overflow-y: auto;
          flex: 1;
          line-height: 1.6;
          color: #333;
        ">
          <div style="text-align: center; padding: 40px;">
            <div style="font-size: 18px; color: #666;">Loading changelog...</div>
          </div>
        </div>
        <div style="padding: 15px 20px; border-top: 1px solid #eee; text-align: right;">
          <button id="close-modal-btn" style="
            background: #6c757d;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
          ">Close</button>
          <a href="https://github.com/aimanrahimi45/PPE_Management/releases" target="_blank" style="
            background: #007bff;
            color: white;
            text-decoration: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          ">View on GitHub</a>
        </div>
      `;
      
      // Add event listeners
      const closeModal = () => {
        document.body.removeChild(backdrop);
      };
      
      modal.querySelector('#close-changelog-btn').addEventListener('click', closeModal);
      modal.querySelector('#close-modal-btn').addEventListener('click', closeModal);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
      
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      
      // Load changelog
      await this.loadChangelog(version);
      
    } catch (error) {
      console.error('❌ Failed to show changelog modal:', error);
    }
  }

  /**
   * Load changelog content
   */
  async loadChangelog(version) {
    try {
      const authToken = this.getAuthToken();
      if (!authToken) {
        throw new Error('No authentication token available');
      }

      const response = await fetch(`/api/updates/changelog/${version}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        const content = document.getElementById('changelog-content');
        if (content) {
          content.innerHTML = this.formatChangelog(data.changelog, data);
        }
      } else {
        throw new Error(data.error || 'Failed to load changelog');
      }
      
    } catch (error) {
      console.error('❌ Changelog load error:', error);
      
      const content = document.getElementById('changelog-content');
      if (content) {
        content.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #dc3545;">
            <div style="font-size: 18px; margin-bottom: 10px;">❌ Failed to load changelog</div>
            <div style="font-size: 14px;">${error.message}</div>
          </div>
        `;
      }
    }
  }

  /**
   * Format changelog content
   */
  formatChangelog(changelog, versionData) {
    // Check if changelog is already HTML
    if (changelog.includes('<') && changelog.includes('>')) {
      return changelog;
    }
    
    // Convert markdown-style changelog to HTML
    let html = changelog
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: #f1f1f1; padding: 2px 4px; border-radius: 3px;">$1</code>')
      .replace(/### (.*?)(<br>|$)/g, '<h4 style="color: #007bff; margin: 20px 0 10px 0;">$1</h4>')
      .replace(/## (.*?)(<br>|$)/g, '<h3 style="color: #333; margin: 25px 0 15px 0;">$1</h3>')
      .replace(/# (.*?)(<br>|$)/g, '<h2 style="color: #333; margin: 30px 0 20px 0;">$1</h2>');
    
    // Add version info header
    const releaseDate = new Date(versionData.releaseDate).toLocaleDateString();
    const badges = [];
    
    if (versionData.securityUpdate) {
      badges.push('<span style="background: #dc3545; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold;">SECURITY</span>');
    }
    
    if (versionData.mandatory) {
      badges.push('<span style="background: #fd7e14; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold;">MANDATORY</span>');
    }
    
    const header = `
      <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #007bff;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <strong style="color: #007bff;">Version ${versionData.version}</strong>
          <div>${badges.join(' ')}</div>
        </div>
        <div style="font-size: 12px; color: #666;">Released: ${releaseDate}</div>
      </div>
    `;
    
    return header + html;
  }

  /**
   * Start periodic update checking
   */
  startPeriodicUpdates() {
    // Check for updates every 6 hours
    setInterval(() => {
      this.checkForUpdates();
    }, this.updateCheckInterval);
    
    console.log('🔄 Periodic update checking started (every 6 hours)');
  }

  /**
   * Get current update status
   */
  async getUpdateStatus() {
    try {
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.log('⚠️ No auth token for status check');
        return null;
      }

      const response = await fetch('/api/updates/status', {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.success ? data : null;
      
    } catch (error) {
      console.error('❌ Failed to get update status:', error);
      return null;
    }
  }
}

// Initialize update notifications when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize on admin pages
  if (window.location.pathname.includes('admin') || 
      window.location.pathname.includes('index.html') ||
      window.location.pathname === '/') {
    
    const updateNotifications = new UpdateNotifications();
    
    // Wait for auth token to be available with dynamic detection
    const initializeWhenReady = () => {
      const authToken = updateNotifications.getAuthToken();
      
      if (authToken) {
        console.log('🔐 Auth token found, initializing update notifications...');
        updateNotifications.initialize();
      } else {
        // Keep checking every 2 seconds, but don't spam console
        setTimeout(initializeWhenReady, 2000);
      }
    };
    
    // Start initialization after page loads
    setTimeout(initializeWhenReady, 3000);
    
    // Listen for any auth token changes (reset-proof)
    window.addEventListener('storage', (e) => {
      const possibleTokenKeys = ['authToken', 'ppe_auth_token', 'auth_token', 'token'];
      if (possibleTokenKeys.includes(e.key) && e.newValue && !updateNotifications.initialized) {
        console.log('🔐 Auth token detected, initializing update notifications...');
        updateNotifications.initialize();
      }
    });
    
    // Make globally available for debugging
    window.updateNotifications = updateNotifications;
  }
});