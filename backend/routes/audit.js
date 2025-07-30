const express = require('express');
const auditService = require('../services/auditService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get audit trail for specific resource
router.get('/resource/:resourceType/:resourceId', authenticateToken, async (req, res) => {
  try {
    const { resourceType, resourceId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const auditTrail = await auditService.getAuditTrail(resourceType, resourceId, limit);
    
    res.json({
      success: true,
      auditTrail,
      count: auditTrail.length
    });
  } catch (error) {
    console.error('Get audit trail error:', error);
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

// Get system-wide audit trail
router.get('/system', authenticateToken, async (req, res) => {
  try {
    const filters = {
      userId: req.query.userId,
      action: req.query.action,
      resourceType: req.query.resourceType,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };
    
    const limit = parseInt(req.query.limit) || 100;
    
    const auditTrail = await auditService.getSystemAuditTrail(filters, limit);
    
    res.json({
      success: true,
      auditTrail,
      count: auditTrail.length,
      filters
    });
  } catch (error) {
    console.error('Get system audit trail error:', error);
    res.status(500).json({ error: 'Failed to fetch system audit trail' });
  }
});

// Get audit statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await auditService.getAuditStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

module.exports = router;