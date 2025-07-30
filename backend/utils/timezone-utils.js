/**
 * Backend Timezone Utilities for Email and Server-side Formatting
 * Handles timezone conversion for email notifications and API responses
 */

class BackendTimezoneUtils {
    constructor() {
        // Default to server timezone or UTC
        this.serverTimezone = process.env.TZ || 'UTC';
    }

    /**
     * Format timestamp for emails (user-friendly with timezone)
     * @param {string|Date} timestamp 
     * @param {string} userTimezone - User's timezone (optional)
     * @returns {string} Formatted timestamp
     */
    formatForEmail(timestamp, userTimezone = null) {
        try {
            const date = new Date(timestamp);
            
            if (userTimezone) {
                // Format in user's timezone if provided
                return date.toLocaleString('en-GB', {
                    timeZone: userTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }) + ` (${this.getTimezoneAbbreviation(userTimezone)})`;
            } else {
                // Default to Malaysia timezone for email notifications
                return date.toLocaleString('en-GB', {
                    timeZone: 'Asia/Kuala_Lumpur',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }).replace(/\//g, '/') + ' (Malaysia Time)';
            }
        } catch (error) {
            console.warn('⚠️ Failed to format timestamp for email:', error);
            // Fallback to server time if Malaysia timezone fails
            try {
                const date = new Date(timestamp);
                return date.toLocaleString('en-GB', {
                    timeZone: this.serverTimezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }) + ` (Server Time)`;
            } catch (fallbackError) {
                return new Date(timestamp).toISOString();
            }
        }
    }

    /**
     * Get timezone abbreviation
     * @param {string} timezone 
     * @returns {string}
     */
    getTimezoneAbbreviation(timezone) {
        try {
            const date = new Date();
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'short'
            });
            
            const parts = formatter.formatToParts(date);
            return parts.find(part => part.type === 'timeZoneName')?.value || timezone;
        } catch (error) {
            return timezone;
        }
    }

    /**
     * Format for API responses (ISO with timezone info)
     * @param {string|Date} timestamp 
     * @returns {Object} Formatted timestamp data
     */
    formatForAPI(timestamp) {
        try {
            const date = new Date(timestamp);
            
            return {
                utc: date.toISOString(),
                timestamp: date.getTime(),
                server_timezone: this.serverTimezone,
                display_hint: 'Convert to user timezone on frontend'
            };
        } catch (error) {
            console.warn('⚠️ Failed to format timestamp for API:', error);
            return {
                utc: new Date().toISOString(),
                timestamp: Date.now(),
                server_timezone: this.serverTimezone,
                display_hint: 'Invalid timestamp provided'
            };
        }
    }

    /**
     * Common timezone mappings for users
     * @returns {Object} Timezone mappings
     */
    getCommonTimezones() {
        return {
            'Asia/Kuala_Lumpur': 'Malaysia Time (MYT)',
            'Asia/Tokyo': 'Japan Standard Time (JST)', 
            'Asia/Singapore': 'Singapore Time (SGT)',
            'Asia/Shanghai': 'China Standard Time (CST)',
            'Asia/Bangkok': 'Indochina Time (ICT)',
            'Asia/Jakarta': 'Western Indonesia Time (WIB)',
            'Asia/Manila': 'Philippines Time (PST)',
            'Australia/Sydney': 'Australian Eastern Time (AEST)',
            'Europe/London': 'Greenwich Mean Time (GMT)',
            'America/New_York': 'Eastern Time (EST/EDT)',
            'America/Los_Angeles': 'Pacific Time (PST/PDT)',
            'UTC': 'Coordinated Universal Time (UTC)'
        };
    }

    /**
     * Format current timestamp for logs
     * @returns {string} Log-friendly timestamp
     */
    formatForLogs() {
        return new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');
    }

    /**
     * Multi-timezone email formatter for multiple recipients
     * @param {string|Date} timestamp 
     * @param {Array} userTimezones - Array of user timezones
     * @returns {string} Multi-timezone formatted string
     */
    formatMultiTimezone(timestamp, userTimezones = []) {
        try {
            const date = new Date(timestamp);
            const baseFormat = this.formatForEmail(timestamp);
            
            if (userTimezones.length === 0) {
                return baseFormat;
            }

            // Show primary timezone plus additional ones
            const additionalTimes = userTimezones
                .filter(tz => tz !== this.serverTimezone)
                .slice(0, 3) // Limit to 3 additional timezones
                .map(tz => {
                    const formatted = date.toLocaleString('en-GB', {
                        timeZone: tz,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                    const abbr = this.getTimezoneAbbreviation(tz);
                    return `${formatted} ${abbr}`;
                });

            if (additionalTimes.length > 0) {
                return `${baseFormat} | ${additionalTimes.join(' | ')}`;
            }
            
            return baseFormat;
        } catch (error) {
            console.warn('⚠️ Failed to format multi-timezone timestamp:', error);
            return this.formatForEmail(timestamp);
        }
    }

    /**
     * Create timezone-aware date for database storage
     * @returns {string} UTC timestamp for database
     */
    createUTCTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Validate timezone identifier
     * @param {string} timezone 
     * @returns {boolean}
     */
    isValidTimezone(timezone) {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
            return true;
        } catch (error) {
            return false;
        }
    }
}

// Create singleton instance
const backendTimezoneUtils = new BackendTimezoneUtils();

module.exports = backendTimezoneUtils;