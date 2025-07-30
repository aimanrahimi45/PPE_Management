const express = require('express');
const staffPPEService = require('../services/staffPPEService');
const auditService = require('../services/auditService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get staff PPE assignments
router.get('/assignments/:staffId', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const status = req.query.status;
    
    const assignments = await staffPPEService.getStaffAssignments(staffId, status);
    
    res.json({
      success: true,
      assignments,
      count: assignments.length
    });
  } catch (error) {
    console.error('Get staff assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch staff assignments' });
  }
});

// Get all unreturned PPE assignments
router.get('/unreturned', authenticateToken, async (req, res) => {
  try {
    const assignments = await staffPPEService.getUnreturnedAssignments();
    
    res.json({
      success: true,
      assignments,
      count: assignments.length
    });
  } catch (error) {
    console.error('Get unreturned assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch unreturned assignments' });
  }
});

// Return PPE
router.post('/return/:assignmentId', authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { notes } = req.body;
    
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    const result = await staffPPEService.returnPPE(assignmentId, {
      returnedBy: req.user.id,
      notes,
      ipAddress: clientIP,
      userAgent
    });
    
    res.json({
      success: true,
      message: 'PPE returned successfully',
      assignment: result.assignment
    });
  } catch (error) {
    console.error('Return PPE error:', error);
    res.status(500).json({ error: 'Failed to return PPE' });
  }
});

// Get PPE waste report
router.get('/waste-report', authenticateToken, async (req, res) => {
  try {
    const wasteReport = await staffPPEService.getPPEWasteReport();
    
    res.json({
      success: true,
      wasteReport,
      count: wasteReport.length
    });
  } catch (error) {
    console.error('Get waste report error:', error);
    res.status(500).json({ error: 'Failed to fetch waste report' });
  }
});

// Get overdue staff
router.get('/overdue', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const overdueStaff = await staffPPEService.getOverdueStaff(days);
    
    res.json({
      success: true,
      overdueStaff,
      count: overdueStaff.length,
      overdueThreshold: days
    });
  } catch (error) {
    console.error('Get overdue staff error:', error);
    res.status(500).json({ error: 'Failed to fetch overdue staff' });
  }
});

// Manual PPE assignment (for admin use)
router.post('/assign', authenticateToken, async (req, res) => {
  try {
    const { staffId, staffName, department, ppeItemId, quantity, expectedReturnDate, notes } = req.body;
    
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    const result = await staffPPEService.assignPPE({
      staffId,
      staffName,
      department,
      ppeItemId,
      quantity,
      expectedReturnDate,
      notes,
      issuedBy: req.user.id,
      ipAddress: clientIP,
      userAgent
    });
    
    res.json({
      success: true,
      message: 'PPE assigned successfully',
      assignmentId: result.assignmentId,
      assignment: result.assignment
    });
  } catch (error) {
    console.error('Assign PPE error:', error);
    res.status(500).json({ error: 'Failed to assign PPE' });
  }
});

module.exports = router;