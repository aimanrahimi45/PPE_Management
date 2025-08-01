const express = require('express');
const approvalWorkflowService = require('../services/approvalWorkflowService');
const notificationService = require('../services/notificationService');
const { authenticateToken, authenticateWithCompany } = require('../middleware/auth');
const { enforceLicenseCompliance } = require('../middleware/licenseEnforcement');

const router = express.Router();


// Get pending requests for Safety Officer approval - No auth required for customer onboarding
router.get('/pending', async (req, res) => {
  try {
    // Check license but don't block, show friendly message
    const licenseService = require('../services/licenseService');
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.status === 'expired') {
      return res.json({
        success: true,
        pendingRequests: [],
        count: 0,
        license_required: true,
        message: 'License required to view pending approvals. Please activate your subscription.'
      });
    }
    
    // Use default company for customer onboarding (no user context)
    const companyId = req.user?.company_id || 'default-company';
    const pendingRequests = await approvalWorkflowService.getPendingRequests(companyId);
    
    res.json({
      success: true,
      pendingRequests,
      count: pendingRequests.length
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

// Get detailed request for approval review
router.get('/request/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const requestDetails = await approvalWorkflowService.getRequestDetails(requestId);
    
    res.json({
      success: true,
      ...requestDetails
    });
  } catch (error) {
    console.error('Get request details error:', error);
    res.status(500).json({ error: 'Failed to fetch request details' });
  }
});

// Approve PPE request
router.post('/approve/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { notes } = req.body;
    
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    const result = await approvalWorkflowService.approveRequest(requestId, {
      approvedBy: req.user.id,
      approverName: req.user.name,
      notes,
      ipAddress: clientIP,
      userAgent
    });
    
    // Send push notification to staff member
    try {
      const requestDetails = await approvalWorkflowService.getRequestDetails(requestId);
      console.log('📱 Request details for notification:', {
        staff_id: requestDetails.request ? requestDetails.request.staff_id : undefined,
        requestId: requestId,
        hasItems: requestDetails.items ? true : false
      });
      
      if (requestDetails.request && requestDetails.request.staff_id) {
        await notificationService.notifyRequestStatusUpdate(
          requestDetails.request.staff_id,
          requestId,
          'approved',
          {
            approverName: req.user.name,
            notes: notes,
            items: requestDetails.items
          }
        );
      } else {
        console.warn('⚠️ Cannot send push notification - no staff_id found in request details');
      }
    } catch (notificationError) {
      console.error('Failed to send approval notification:', notificationError);
      // Continue - don't fail the approval if notification fails
    }
    
    res.json({
      success: true,
      message: 'PPE request approved successfully',
      ...result
    });
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ error: error.message || 'Failed to approve request' });
  }
});

// Reject PPE request
router.post('/reject/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    const result = await approvalWorkflowService.rejectRequest(requestId, {
      rejectedBy: req.user.id,
      rejectorName: req.user.name,
      reason,
      ipAddress: clientIP,
      userAgent
    });
    
    // Send push notification to staff member
    try {
      const requestDetails = await approvalWorkflowService.getRequestDetails(requestId);
      console.log('📱 Request details for rejection notification:', {
        staff_id: requestDetails.request ? requestDetails.request.staff_id : undefined,
        requestId: requestId,
        hasItems: requestDetails.items ? true : false
      });
      
      if (requestDetails.request && requestDetails.request.staff_id) {
        await notificationService.notifyRequestStatusUpdate(
          requestDetails.request.staff_id,
          requestId,
          'rejected',
          {
            rejectorName: req.user.name,
            reason: reason,
            items: requestDetails.items
          }
        );
      } else {
        console.warn('⚠️ Cannot send push notification - no staff_id found in request details');
      }
    } catch (notificationError) {
      console.error('Failed to send rejection notification:', notificationError);
      // Continue - don't fail the rejection if notification fails
    }
    
    res.json({
      success: true,
      message: 'PPE request rejected',
      ...result
    });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: error.message || 'Failed to reject request' });
  }
});

// Get approval history for a request
router.get('/history/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const history = await approvalWorkflowService.getApprovalHistory(requestId);
    
    res.json({
      success: true,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Get approval history error:', error);
    res.status(500).json({ error: 'Failed to fetch approval history' });
  }
});

// Get approval statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await approvalWorkflowService.getApprovalStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get approval stats error:', error);
    res.status(500).json({ error: 'Failed to fetch approval statistics' });
  }
});

module.exports = router;