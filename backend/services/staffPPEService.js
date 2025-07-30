const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const auditService = require('./auditService');

class StaffPPEService {
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
   * Assign PPE to staff member
   * @param {Object} assignmentData - Assignment data
   */
  async assignPPE(assignmentData) {
    const assignmentId = uuidv4();
    
    try {
      const assignment = {
        id: assignmentId,
        staff_id: assignmentData.staffId,
        staff_name: assignmentData.staffName,
        department: assignmentData.department,
        ppe_item_id: assignmentData.ppeItemId,
        quantity: assignmentData.quantity || 1,
        expected_return_date: assignmentData.expectedReturnDate,
        notes: assignmentData.notes,
        issued_by: assignmentData.issuedBy || 'system',
        status: 'ISSUED'
      };

      await new Promise((resolve, reject) => {
        this.getDatabaseConnection().run(`
          INSERT INTO staff_ppe_assignments (
            id, staff_id, staff_name, department, ppe_item_id, 
            quantity, expected_return_date, notes, issued_by, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          assignment.id,
          assignment.staff_id,
          assignment.staff_name,
          assignment.department,
          assignment.ppe_item_id,
          assignment.quantity,
          assignment.expected_return_date,
          assignment.notes,
          assignment.issued_by,
          assignment.status
        ], function(err) {
          if (err) reject(err);
          else resolve({ id: assignmentId, changes: this.changes });
        });
      });

      // Log audit trail
      await auditService.logAction({
        userId: assignmentData.issuedBy,
        action: 'ASSIGN_PPE',
        resourceType: 'STAFF_PPE_ASSIGNMENT',
        resourceId: assignmentId,
        newValues: assignment,
        ipAddress: assignmentData.ipAddress,
        userAgent: assignmentData.userAgent
      });

      return { success: true, assignmentId, assignment };
    } catch (error) {
      console.error('Assign PPE error:', error);
      throw error;
    }
  }

  /**
   * Return PPE from staff member
   * @param {string} assignmentId - Assignment ID
   * @param {Object} returnData - Return data
   */
  async returnPPE(assignmentId, returnData) {
    try {
      // Get current assignment
      const currentAssignment = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().get(`
          SELECT * FROM staff_ppe_assignments WHERE id = ?
        `, [assignmentId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!currentAssignment) {
        throw new Error('Assignment not found');
      }

      const oldValues = { ...currentAssignment };
      
      // Update assignment
      await new Promise((resolve, reject) => {
        this.getDatabaseConnection().run(`
          UPDATE staff_ppe_assignments 
          SET 
            actual_return_date = CURRENT_TIMESTAMP,
            status = 'RETURNED',
            returned_by = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          returnData.returnedBy || 'system',
          returnData.notes || currentAssignment.notes,
          assignmentId
        ], function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });

      // Get updated assignment
      const updatedAssignment = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().get(`
          SELECT * FROM staff_ppe_assignments WHERE id = ?
        `, [assignmentId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      // Log audit trail
      await auditService.logAction({
        userId: returnData.returnedBy,
        action: 'RETURN_PPE',
        resourceType: 'STAFF_PPE_ASSIGNMENT',
        resourceId: assignmentId,
        oldValues,
        newValues: updatedAssignment,
        ipAddress: returnData.ipAddress,
        userAgent: returnData.userAgent
      });

      return { success: true, assignment: updatedAssignment };
    } catch (error) {
      console.error('Return PPE error:', error);
      throw error;
    }
  }

  /**
   * Get staff PPE assignments
   * @param {string} staffId - Staff ID
   * @param {string} status - Assignment status filter
   */
  async getStaffAssignments(staffId, status = null) {
    try {
      let query = `
        SELECT 
          spa.*,
          pi.name as ppe_item_name,
          pi.type as ppe_item_type
        FROM staff_ppe_assignments spa
        JOIN ppe_items pi ON spa.ppe_item_id = pi.id
        WHERE spa.staff_id = ?
      `;
      
      const params = [staffId];
      
      if (status) {
        query += ' AND spa.status = ?';
        params.push(status);
      }
      
      query += ' ORDER BY spa.issued_date DESC';

      const assignments = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return assignments;
    } catch (error) {
      console.error('Get staff assignments error:', error);
      throw error;
    }
  }

  /**
   * Get unreturned PPE assignments
   */
  async getUnreturnedAssignments() {
    try {
      const assignments = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(`
          SELECT 
            spa.*,
            pi.name as ppe_item_name,
            pi.type as ppe_item_type,
            (julianday('now') - julianday(spa.issued_date)) as days_issued
          FROM staff_ppe_assignments spa
          JOIN ppe_items pi ON spa.ppe_item_id = pi.id
          WHERE spa.status = 'ISSUED'
          ORDER BY spa.issued_date DESC
        `, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return assignments;
    } catch (error) {
      console.error('Get unreturned assignments error:', error);
      throw error;
    }
  }

  /**
   * Get PPE waste report
   */
  async getPPEWasteReport() {
    try {
      const wasteStats = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(`
          SELECT 
            pi.name as ppe_item_name,
            pi.type as ppe_item_type,
            spa.department,
            COUNT(*) as total_issued,
            SUM(CASE WHEN spa.status = 'RETURNED' THEN 1 ELSE 0 END) as returned_count,
            SUM(CASE WHEN spa.status = 'ISSUED' THEN 1 ELSE 0 END) as unreturned_count,
            SUM(CASE WHEN spa.status = 'ISSUED' AND julianday('now') - julianday(spa.issued_date) > 90 THEN 1 ELSE 0 END) as overdue_count,
            SUM(spa.quantity) as total_quantity_issued,
            SUM(CASE WHEN spa.status = 'RETURNED' THEN spa.quantity ELSE 0 END) as total_quantity_returned
          FROM staff_ppe_assignments spa
          JOIN ppe_items pi ON spa.ppe_item_id = pi.id
          GROUP BY pi.id, spa.department
          ORDER BY unreturned_count DESC, pi.name
        `, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return wasteStats;
    } catch (error) {
      console.error('Get PPE waste report error:', error);
      throw error;
    }
  }

  /**
   * Get staff with overdue PPE
   */
  async getOverdueStaff(days = 90) {
    try {
      const overdueStaff = await new Promise((resolve, reject) => {
        this.getDatabaseConnection().all(`
          SELECT 
            spa.staff_id,
            spa.staff_name,
            spa.department,
            pi.name as ppe_item_name,
            pi.type as ppe_item_type,
            spa.quantity,
            spa.issued_date,
            (julianday('now') - julianday(spa.issued_date)) as days_overdue
          FROM staff_ppe_assignments spa
          JOIN ppe_items pi ON spa.ppe_item_id = pi.id
          WHERE spa.status = 'ISSUED' 
            AND julianday('now') - julianday(spa.issued_date) > ?
          ORDER BY days_overdue DESC, spa.staff_name
        `, [days], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return overdueStaff;
    } catch (error) {
      console.error('Get overdue staff error:', error);
      throw error;
    }
  }
}

module.exports = new StaffPPEService();