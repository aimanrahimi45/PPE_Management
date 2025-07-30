const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');

class AuditService {
  constructor() {
    // Don't store db connection in constructor - get it dynamically
  }

  /**
   * Get database connection dynamically to handle initialization timing
   */
  getDatabaseConnection() {
    const db = getDb();
    if (!db) {
      throw new Error('Database not initialized. Please wait for system startup to complete.');
    }
    return db;
  }

  /**
   * Log an action to the audit trail
   * @param {Object} auditData - The audit data
   * @param {string} auditData.userId - User performing the action
   * @param {string} auditData.action - Action performed (CREATE, UPDATE, DELETE, VIEW, etc.)
   * @param {string} auditData.resourceType - Type of resource (PPE_REQUEST, INVENTORY, USER, etc.)
   * @param {string} auditData.resourceId - ID of the resource
   * @param {Object} auditData.oldValues - Previous values (for updates)
   * @param {Object} auditData.newValues - New values
   * @param {string} auditData.ipAddress - Client IP address
   * @param {string} auditData.userAgent - Client user agent
   */
  async logAction(auditData) {
    const auditId = uuidv4();
    
    try {
      const db = this.getDatabaseConnection();
      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO audit_trail (
            id, user_id, action, resource_type, resource_id, 
            old_values, new_values, ip_address, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          auditId,
          auditData.userId || 'system',
          auditData.action,
          auditData.resourceType,
          auditData.resourceId,
          auditData.oldValues ? JSON.stringify(auditData.oldValues) : null,
          auditData.newValues ? JSON.stringify(auditData.newValues) : null,
          auditData.ipAddress,
          auditData.userAgent
        ], function(err) {
          if (err) reject(err);
          else resolve({ id: auditId, changes: this.changes });
        });
      });
      
      return { success: true, auditId };
    } catch (error) {
      if (error.message.includes('Database not initialized')) {
        console.log('⚠️ Audit logging skipped - database not ready yet');
        return { success: false, error: 'Database initializing', skipped: true };
      }
      console.error('Audit log error:', error);
      // Don't fail the main operation if audit logging fails
      return { success: false, error: error.message };
    }
  }

  /**
   * Get audit trail for a specific resource
   * @param {string} resourceType - Type of resource
   * @param {string} resourceId - ID of the resource
   * @param {number} limit - Number of records to return
   */
  async getAuditTrail(resourceType, resourceId, limit = 50) {
    try {
      const records = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(`
          SELECT 
            at.*,
            u.name as user_name,
            u.email as user_email
          FROM audit_trail at
          LEFT JOIN users u ON at.user_id = u.id
          WHERE at.resource_type = ? AND at.resource_id = ?
          ORDER BY at.timestamp DESC
          LIMIT ?
        `, [resourceType, resourceId, limit], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return records.map(record => ({
        ...record,
        old_values: record.old_values ? JSON.parse(record.old_values) : null,
        new_values: record.new_values ? JSON.parse(record.new_values) : null
      }));
    } catch (error) {
      console.error('Get audit trail error:', error);
      throw error;
    }
  }

  /**
   * Get system-wide audit trail
   * @param {Object} filters - Filter options
   * @param {number} limit - Number of records to return
   */
  async getSystemAuditTrail(filters = {}, limit = 100) {
    try {
      let query = `
        SELECT 
          at.*,
          u.name as user_name,
          u.email as user_email
        FROM audit_trail at
        LEFT JOIN users u ON at.user_id = u.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (filters.userId) {
        query += ' AND at.user_id = ?';
        params.push(filters.userId);
      }
      
      if (filters.action) {
        query += ' AND at.action = ?';
        params.push(filters.action);
      }
      
      if (filters.resourceType) {
        query += ' AND at.resource_type = ?';
        params.push(filters.resourceType);
      }
      
      if (filters.dateFrom) {
        query += ' AND at.timestamp >= ?';
        params.push(filters.dateFrom);
      }
      
      if (filters.dateTo) {
        query += ' AND at.timestamp <= ?';
        params.push(filters.dateTo);
      }
      
      query += ' ORDER BY at.timestamp DESC LIMIT ?';
      params.push(limit);

      const records = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return records.map(record => ({
        ...record,
        old_values: record.old_values ? JSON.parse(record.old_values) : null,
        new_values: record.new_values ? JSON.parse(record.new_values) : null
      }));
    } catch (error) {
      console.error('Get system audit trail error:', error);
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats() {
    try {
      const stats = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(`
          SELECT 
            action,
            resource_type,
            COUNT(*) as count,
            DATE(timestamp) as date
          FROM audit_trail
          WHERE timestamp >= datetime('now', '-30 days')
          GROUP BY action, resource_type, DATE(timestamp)
          ORDER BY date DESC
        `, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return stats;
    } catch (error) {
      console.error('Get audit stats error:', error);
      throw error;
    }
  }
}

module.exports = new AuditService();