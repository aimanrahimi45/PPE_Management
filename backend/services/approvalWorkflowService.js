const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const auditService = require('./auditService');
const emailService = require('./emailService');
const inventoryManagementService = require('./inventoryManagementService');

class ApprovalWorkflowService {
  constructor() {
    console.log('📋 ApprovalWorkflowService initialized, db: true');
  }

  // Lazy database connection - only get when needed
  getDatabase() {
    return getDb();
  }

  /**
   * Get pending PPE requests for Safety Officer approval
   * @param {string} companyId - Company ID for multi-tenant support
   */
  async getPendingRequests(companyId = 'your-company') {
    try {
      console.log('📋 Getting pending requests...');
      
      // Get pending requests with station information
      const requests = await new Promise((resolve, reject) => {
        this.getDatabase().all(`
          SELECT 
            pr.*,
            s.name as station_name,
            s.location as station_location,
            sd.name as staff_name,
            sd.staff_id as staff_id,
            sd.department
          FROM ppe_requests pr
          LEFT JOIN stations s ON pr.station_id = s.id
          LEFT JOIN staff_directory sd ON pr.user_id = sd.id
          WHERE pr.status = 'PENDING'
          ORDER BY pr.created_at DESC
        `, (err, rows) => {
          if (err) {
            console.error('Database query error:', err);
            reject(err);
          } else {
            console.log(`Found ${rows.length} pending requests`);
            console.log('Raw request data:', JSON.stringify(rows, null, 2));
            resolve(rows);
          }
        });
      });

      // For each request, get the requested items
      for (let request of requests) {
        try {
          const items = await new Promise((resolve, reject) => {
            this.getDatabase().all(`
              SELECT 
                pri.quantity,
                pi.name as item_name,
                pi.type as item_type
              FROM ppe_request_items pri
              JOIN ppe_items pi ON pri.ppe_item_id = pi.id
              WHERE pri.request_id = ?
            `, [request.id], (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });
          
          // Format requested items as string
          console.log(`Items for request ${request.id}:`, JSON.stringify(items, null, 2));
          request.requested_items = items.map(item => 
            `${item.item_name} (${item.quantity})`
          ).join(', ');
          
        } catch (itemError) {
          console.error(`Error getting items for request ${request.id}:`, itemError);
          request.requested_items = 'Error loading items';
        }
      }

      return requests;
    } catch (error) {
      console.error('Get pending requests error:', error);
      throw error;
    }
  }

  /**
   * Get detailed PPE request for approval review
   */
  async getRequestDetails(requestId) {
    try {
      const request = await new Promise((resolve, reject) => {
        this.getDatabase().get(`
          SELECT 
            pr.*,
            s.name as station_name,
            s.location as station_location,
            sd.name as staff_name,
            sd.staff_id,
            sd.department
          FROM ppe_requests pr
          LEFT JOIN stations s ON pr.station_id = s.id
          LEFT JOIN staff_directory sd ON pr.staff_id = sd.staff_id
          WHERE pr.id = ?
        `, [requestId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!request) {
        throw new Error('Request not found');
      }

      // Get request items
      const items = await new Promise((resolve, reject) => {
        this.getDatabase().all(`
          SELECT 
            pri.*,
            pi.name as item_name,
            pi.type as item_type,
            si.current_stock,
            si.max_capacity
          FROM ppe_request_items pri
          JOIN ppe_items pi ON pri.ppe_item_id = pi.id
          LEFT JOIN station_inventory si ON pi.id = si.ppe_item_id AND si.station_id = ?
          WHERE pri.request_id = ?
        `, [request.station_id, requestId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return { request, items };
    } catch (error) {
      console.error('Get request details error:', error);
      throw error;
    }
  }

  /**
   * Approve PPE request
   */
  async approveRequest(requestId, approvalData) {
    try {
      const { approvedBy, notes, approvalDate = new Date() } = approvalData;

      // Get current request
      const currentRequest = await new Promise((resolve, reject) => {
        this.getDatabase().get(`SELECT * FROM ppe_requests WHERE id = ?`, [requestId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!currentRequest) {
        throw new Error('Request not found');
      }

      if (currentRequest.status !== 'PENDING') {
        throw new Error(`Request is not pending approval. Current status: ${currentRequest.status}`);
      }

      // Update request status
      await new Promise((resolve, reject) => {
        this.getDatabase().run(`
          UPDATE ppe_requests 
          SET 
            status = 'APPROVED',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [requestId], function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });

      // Create approval record
      const approvalId = uuidv4();
      await new Promise((resolve, reject) => {
        this.getDatabase().run(`
          INSERT INTO approval_records (
            id, request_id, approved_by, approval_date, notes, action
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [approvalId, requestId, approvedBy, approvalDate, notes, 'APPROVED'], function(err) {
          if (err) reject(err);
          else resolve({ id: approvalId });
        });
      });

      // Get request items for inventory update
      const requestItems = await new Promise((resolve, reject) => {
        this.getDatabase().all(`
          SELECT * FROM ppe_request_items WHERE request_id = ?
        `, [requestId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Update inventory (deduct stock) with threshold checking
      for (const item of requestItems) {
        try {
          await inventoryManagementService.updateStock(
            currentRequest.station_id,
            item.ppe_item_id,
            item.quantity,
            'SUBTRACT',
            approvedBy
          );
        } catch (stockError) {
          console.error('Stock update failed:', stockError);
          // Continue with approval even if stock update fails
        }
      }

      // Log audit trail
      await auditService.logAction({
        userId: approvedBy,
        action: 'APPROVE_PPE_REQUEST',
        resourceType: 'PPE_REQUEST',
        resourceId: requestId,
        oldValues: currentRequest,
        newValues: { status: 'APPROVED', approvedBy, notes },
        ipAddress: approvalData.ipAddress,
        userAgent: approvalData.userAgent
      });

      // Send email notification to Store Personnel
      try {
        const requestDetails = await this.getRequestDetails(requestId);
        const emailData = {
          requestId,
          staffName: requestDetails.request.staff_name || 'Unknown',
          staffId: requestDetails.request.staff_id || 'N/A',
          department: requestDetails.request.department || 'N/A',
          items: requestDetails.items.map(item => `${item.item_name} (${item.quantity})`).join(', '),
          stationName: requestDetails.request.station_name,
          approvedBy: approvalData.approverName || approvedBy,
          approvalNotes: notes
        };
        
        await emailService.notifyApprovedPPERequest(emailData);
      } catch (emailError) {
        console.error('Failed to send approval notification email:', emailError);
      }

      return { success: true, approvalId, requestId };
    } catch (error) {
      console.error('Approve request error:', error);
      throw error;
    }
  }

  /**
   * Reject PPE request
   */
  async rejectRequest(requestId, rejectionData) {
    try {
      const { rejectedBy, reason, rejectionDate = new Date() } = rejectionData;

      // Get current request
      const currentRequest = await new Promise((resolve, reject) => {
        this.getDatabase().get(`SELECT * FROM ppe_requests WHERE id = ?`, [requestId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!currentRequest) {
        throw new Error('Request not found');
      }

      if (currentRequest.status !== 'PENDING') {
        throw new Error(`Request is not pending approval. Current status: ${currentRequest.status}`);
      }

      // Update request status
      await new Promise((resolve, reject) => {
        this.getDatabase().run(`
          UPDATE ppe_requests 
          SET 
            status = 'REJECTED',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [requestId], function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });

      // Create rejection record
      const rejectionId = uuidv4();
      await new Promise((resolve, reject) => {
        this.getDatabase().run(`
          INSERT INTO approval_records (
            id, request_id, approved_by, approval_date, notes, action
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [rejectionId, requestId, rejectedBy, rejectionDate, reason, 'REJECTED'], function(err) {
          if (err) reject(err);
          else resolve({ id: rejectionId });
        });
      });

      // Log audit trail
      await auditService.logAction({
        userId: rejectedBy,
        action: 'REJECT_PPE_REQUEST',
        resourceType: 'PPE_REQUEST',
        resourceId: requestId,
        oldValues: currentRequest,
        newValues: { status: 'REJECTED', rejectedBy, reason },
        ipAddress: rejectionData.ipAddress,
        userAgent: rejectionData.userAgent
      });

      // Send email notification to Store Personnel about rejection
      try {
        const requestDetails = await this.getRequestDetails(requestId);
        const emailData = {
          requestId,
          staffName: requestDetails.request.staff_name || 'Unknown',
          staffId: requestDetails.request.staff_id || 'N/A',
          department: requestDetails.request.department || 'N/A',
          items: requestDetails.items.map(item => `${item.item_name} (${item.quantity})`).join(', '),
          rejectedBy: rejectionData.rejectorName || rejectedBy,
          rejectionReason: reason
        };
        
        await emailService.notifyStorePersonnelRejection(emailData);
      } catch (emailError) {
        console.error('Failed to send store personnel rejection notification email:', emailError);
      }

      return { success: true, rejectionId, requestId };
    } catch (error) {
      console.error('Reject request error:', error);
      throw error;
    }
  }

  /**
   * Get approval history for a request
   */
  async getApprovalHistory(requestId) {
    try {
      const history = await new Promise((resolve, reject) => {
        this.getDatabase().all(`
          SELECT 
            ar.*,
            u.name as approver_name,
            u.email as approver_email
          FROM approval_records ar
          LEFT JOIN users u ON ar.approved_by = u.id
          WHERE ar.request_id = ?
          ORDER BY ar.approval_date DESC
        `, [requestId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      return history;
    } catch (error) {
      console.error('Get approval history error:', error);
      throw error;
    }
  }

  /**
   * Get approval statistics
   */
  async getApprovalStats() {
    try {
      const stats = await new Promise((resolve, reject) => {
        this.getDatabase().get(`
          SELECT 
            COUNT(*) as total_requests,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_requests,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_requests,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_requests,
            AVG(
              CASE 
                WHEN status != 'PENDING' THEN 
                  (julianday(updated_at) - julianday(created_at)) * 24 
                ELSE NULL 
              END
            ) as avg_approval_time_hours
          FROM ppe_requests
          WHERE created_at >= datetime('now', '-30 days')
        `, [], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      return stats;
    } catch (error) {
      console.error('Get approval stats error:', error);
      throw error;
    }
  }
}

module.exports = new ApprovalWorkflowService();