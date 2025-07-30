/**
 * Dynamic Timezone Detection and Conversion Utilities
 * Automatically detects user's timezone and converts UTC timestamps
 */

class TimezoneUtils {
    constructor() {
        this.userTimezone = this.detectUserTimezone();
        this.initializeUtils();
    }

    /**
     * Detect user's timezone automatically
     * @returns {string} IANA timezone identifier
     */
    detectUserTimezone() {
        try {
            // Primary: Use Intl.DateTimeFormat to get timezone
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            console.log(`🌍 Detected user timezone: ${timezone}`);
            return timezone;
        } catch (error) {
            console.warn('⚠️ Failed to detect timezone, using UTC as fallback:', error);
            return 'UTC';
        }
    }

    /**
     * Get timezone display name and offset
     * @returns {Object} Timezone information
     */
    getTimezoneInfo() {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: this.userTimezone,
                timeZoneName: 'long'
            });
            
            const parts = formatter.formatToParts(now);
            const timeZoneName = parts.find(part => part.type === 'timeZoneName')?.value || this.userTimezone;
            
            // Calculate offset in hours
            const offsetMs = now.getTimezoneOffset() * 60000;
            const offsetHours = -offsetMs / 3600000;
            const offsetString = offsetHours >= 0 ? `+${offsetHours}` : `${offsetHours}`;
            
            return {
                timezone: this.userTimezone,
                displayName: timeZoneName,
                offset: offsetHours,
                offsetString: `UTC${offsetString}`,
                abbreviation: this.getTimezoneAbbreviation(now)
            };
        } catch (error) {
            console.warn('⚠️ Failed to get timezone info:', error);
            return {
                timezone: 'UTC',
                displayName: 'Coordinated Universal Time',
                offset: 0,
                offsetString: 'UTC+0',
                abbreviation: 'UTC'
            };
        }
    }

    /**
     * Get timezone abbreviation (e.g., MYT, JST, EST)
     * @param {Date} date 
     * @returns {string}
     */
    getTimezoneAbbreviation(date = new Date()) {
        try {
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: this.userTimezone,
                timeZoneName: 'short'
            });
            
            const parts = formatter.formatToParts(date);
            return parts.find(part => part.type === 'timeZoneName')?.value || this.userTimezone;
        } catch (error) {
            return 'UTC';
        }
    }

    /**
     * Convert UTC timestamp to user's local timezone
     * @param {string|Date} utcTimestamp - UTC timestamp from database
     * @returns {Date} Date object in user's timezone
     */
    convertToLocalTime(utcTimestamp) {
        try {
            // Handle both string and Date inputs
            const utcDate = typeof utcTimestamp === 'string' ? new Date(utcTimestamp) : utcTimestamp;
            
            if (isNaN(utcDate.getTime())) {
                throw new Error('Invalid timestamp');
            }

            // JavaScript Date automatically handles timezone conversion
            // when using toLocaleString with specific timezone
            return utcDate;
        } catch (error) {
            console.warn('⚠️ Failed to convert timestamp:', error);
            return new Date(); // Return current time as fallback
        }
    }

    /**
     * Format timestamp in user's timezone with multiple options
     * @param {string|Date} utcTimestamp 
     * @param {Object} options - Formatting options
     * @returns {string} Formatted timestamp
     */
    formatInUserTimezone(utcTimestamp, options = {}) {
        try {
            const date = this.convertToLocalTime(utcTimestamp);
            
            const defaultOptions = {
                timeZone: this.userTimezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            };

            const formatOptions = { ...defaultOptions, ...options };
            return date.toLocaleString('en-GB', formatOptions);
        } catch (error) {
            console.warn('⚠️ Failed to format timestamp:', error);
            return 'Invalid Date';
        }
    }

    /**
     * Format timestamp as "time ago" (e.g., "2 hours ago") in user's timezone
     * @param {string|Date} utcTimestamp 
     * @returns {string} Relative time string
     */
    formatTimeAgo(utcTimestamp) {
        try {
            const date = this.convertToLocalTime(utcTimestamp);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            const diffWeeks = Math.floor(diffDays / 7);
            const diffMonths = Math.floor(diffDays / 30);
            
            if (diffMs < 0) return 'In the future';
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            if (diffWeeks < 4) return `${diffWeeks}w ago`;
            if (diffMonths < 12) return `${diffMonths}mo ago`;
            
            // For older items, show actual date in user's timezone
            return this.formatInUserTimezone(utcTimestamp, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (error) {
            console.warn('⚠️ Failed to format time ago:', error);
            return 'Unknown time';
        }
    }

    /**
     * Format date only (no time) in user's timezone
     * @param {string|Date} utcTimestamp 
     * @returns {string} Formatted date
     */
    formatDateOnly(utcTimestamp) {
        return this.formatInUserTimezone(utcTimestamp, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    /**
     * Format with timezone indicator for clarity
     * @param {string|Date} utcTimestamp 
     * @param {Object} options 
     * @returns {string} Formatted timestamp with timezone
     */
    formatWithTimezone(utcTimestamp, options = {}) {
        const formatted = this.formatInUserTimezone(utcTimestamp, options);
        const tzInfo = this.getTimezoneInfo();
        return `${formatted} (${tzInfo.abbreviation})`;
    }

    /**
     * Get common timezone examples for user reference
     * @returns {Array} Array of timezone examples
     */
    getTimezoneExamples() {
        const examples = [
            { timezone: 'Asia/Kuala_Lumpur', name: 'Malaysia (MYT)', offset: '+8' },
            { timezone: 'Asia/Tokyo', name: 'Japan (JST)', offset: '+9' },
            { timezone: 'Asia/Singapore', name: 'Singapore (SGT)', offset: '+8' },
            { timezone: 'America/New_York', name: 'US Eastern (EST/EDT)', offset: '-5/-4' },
            { timezone: 'Europe/London', name: 'UK (GMT/BST)', offset: '+0/+1' },
            { timezone: 'Australia/Sydney', name: 'Australia (AEST)', offset: '+10' }
        ];
        
        return examples.map(tz => ({
            ...tz,
            isCurrent: tz.timezone === this.userTimezone
        }));
    }

    /**
     * Initialize global utility functions for backward compatibility
     */
    initializeUtils() {
        // Make utilities available globally
        window.TimezoneUtils = this;
        
        // Create global convenience functions
        window.formatInLocalTimezone = (timestamp, options) => this.formatInUserTimezone(timestamp, options);
        window.formatTimeAgoLocal = (timestamp) => this.formatTimeAgo(timestamp);
        window.formatDateOnlyLocal = (timestamp) => this.formatDateOnly(timestamp);
        window.formatWithTimezoneLocal = (timestamp, options) => this.formatWithTimezone(timestamp, options);
        
        console.log('🕐 Timezone utilities initialized for:', this.getTimezoneInfo());
    }

    /**
     * Debug information for troubleshooting
     * @returns {Object} Debug information
     */
    getDebugInfo() {
        const now = new Date();
        const utcString = now.toISOString();
        const localString = this.formatInUserTimezone(now);
        
        return {
            detectedTimezone: this.userTimezone,
            timezoneInfo: this.getTimezoneInfo(),
            currentUTC: utcString,
            currentLocal: localString,
            browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date().getTimezoneOffset(),
            examples: this.getTimezoneExamples()
        };
    }
}

// Initialize timezone utilities when script loads
const timezoneUtils = new TimezoneUtils();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimezoneUtils;
}