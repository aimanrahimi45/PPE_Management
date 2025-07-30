/**
 * Timezone Indicator Component
 * Shows user's detected timezone and current time
 */

class TimezoneIndicator {
    constructor() {
        this.container = null;
        this.updateInterval = null;
        this.initializeIndicator();
    }

    /**
     * Initialize the timezone indicator
     */
    initializeIndicator() {
        // Wait for TimezoneUtils to be available
        if (typeof TimezoneUtils === 'undefined') {
            setTimeout(() => this.initializeIndicator(), 100);
            return;
        }

        this.createIndicator();
        this.startUpdateTimer();
        console.log('🕐 Timezone indicator initialized');
    }

    /**
     * Create the timezone indicator element
     */
    createIndicator() {
        // Remove existing indicator if present
        const existing = document.getElementById('timezone-indicator');
        if (existing) {
            existing.remove();
        }

        // Create indicator container
        this.container = document.createElement('div');
        this.container.id = 'timezone-indicator';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: 'Inter', sans-serif;
            font-size: 12px;
            z-index: 9999;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            cursor: pointer;
            transition: all 0.3s ease;
            opacity: 0.7;
            user-select: none;
        `;

        // Add hover effects
        this.container.addEventListener('mouseenter', () => {
            this.container.style.opacity = '1';
            this.container.style.transform = 'scale(1.05)';
        });

        this.container.addEventListener('mouseleave', () => {
            this.container.style.opacity = '0.7';
            this.container.style.transform = 'scale(1)';
        });

        // Add click to show more info
        this.container.addEventListener('click', () => {
            this.showTimezoneInfo();
        });

        // Add to body
        document.body.appendChild(this.container);
        
        // Initial update
        this.updateDisplay();
    }

    /**
     * Update the indicator display
     */
    updateDisplay() {
        if (!this.container || typeof TimezoneUtils === 'undefined') return;

        try {
            const now = new Date();
            const tzInfo = TimezoneUtils.getTimezoneInfo();
            
            // Format current time
            const timeString = now.toLocaleString('en-GB', {
                timeZone: tzInfo.timezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            // Create display content
            this.container.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-weight: 600;">${timeString}</div>
                    <div style="font-size: 10px; opacity: 0.8;">${tzInfo.abbreviation}</div>
                </div>
            `;
            
            this.container.title = `Current timezone: ${tzInfo.displayName}\nClick for more details`;
        } catch (error) {
            console.warn('⚠️ Failed to update timezone indicator:', error);
            this.container.innerHTML = '<div>🕐 UTC</div>';
        }
    }

    /**
     * Show detailed timezone information
     */
    showTimezoneInfo() {
        if (typeof TimezoneUtils === 'undefined') return;

        try {
            const tzInfo = TimezoneUtils.getTimezoneInfo();
            const debugInfo = TimezoneUtils.getDebugInfo();
            
            // Create modal content
            const modalContent = `
                <div style="font-family: 'Inter', sans-serif; max-width: 500px;">
                    <h3 style="margin: 0 0 16px 0; color: #1f2937;">🌍 Timezone Information</h3>
                    
                    <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <h4 style="margin: 0 0 8px 0; color: #374151;">Detected Timezone</h4>
                        <p style="margin: 0; font-weight: 600;">${tzInfo.displayName}</p>
                        <p style="margin: 4px 0 0 0; font-size: 14px; color: #6b7280;">
                            ${tzInfo.timezone} (${tzInfo.offsetString})
                        </p>
                    </div>

                    <div style="background: #f0f9ff; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <h4 style="margin: 0 0 8px 0; color: #374151;">Current Time</h4>
                        <p style="margin: 0; font-weight: 600; font-size: 18px; font-family: monospace;">
                            ${debugInfo.currentLocal}
                        </p>
                        <p style="margin: 4px 0 0 0; font-size: 14px; color: #6b7280;">
                            UTC: ${debugInfo.currentUTC}
                        </p>
                    </div>

                    <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
                        <h4 style="margin: 0 0 8px 0; color: #374151;">How It Works</h4>
                        <p style="margin: 0; font-size: 14px; color: #6b7280; line-height: 1.5;">
                            The system automatically detects your timezone and converts all timestamps 
                            (request times, alerts, etc.) to your local time. This ensures dates and 
                            times are displayed correctly regardless of your location.
                        </p>
                    </div>

                    <div style="margin-top: 16px; text-align: center;">
                        <button onclick="this.closest('.modal').style.display='none'" 
                                style="background: #3b82f6; color: white; border: none; padding: 8px 16px; 
                                       border-radius: 6px; cursor: pointer; font-weight: 500;">
                            Close
                        </button>
                    </div>
                </div>
            `;

            // Create modal
            this.showModal(modalContent);
        } catch (error) {
            console.warn('⚠️ Failed to show timezone info:', error);
        }
    }

    /**
     * Show modal with content
     * @param {string} content 
     */
    showModal(content) {
        // Remove existing modal
        const existingModal = document.getElementById('timezone-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'timezone-modal';
        modal.className = 'modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(4px);
        `;

        modal.innerHTML = `
            <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px; 
                        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); max-width: 90vw; max-height: 90vh; 
                        overflow-y: auto;">
                ${content}
            </div>
        `;

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Add to body
        document.body.appendChild(modal);
    }

    /**
     * Start the update timer
     */
    startUpdateTimer() {
        // Update every second
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 1000);
    }

    /**
     * Stop the update timer
     */
    stopUpdateTimer() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Hide the indicator
     */
    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
        this.stopUpdateTimer();
    }

    /**
     * Show the indicator
     */
    show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
        this.startUpdateTimer();
    }

    /**
     * Destroy the indicator
     */
    destroy() {
        this.stopUpdateTimer();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }
}

// Initialize timezone indicator when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Only show on non-mobile devices to avoid cluttering mobile UI
    if (window.innerWidth > 768) {
        setTimeout(() => {
            window.timezoneIndicator = new TimezoneIndicator();
        }, 1000); // Delay to ensure timezone utils are loaded
    }
});

// Export for manual control
window.TimezoneIndicator = TimezoneIndicator;