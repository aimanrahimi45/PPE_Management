const express = require('express');
const inventoryManagementService = require('../services/inventoryManagementService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get inventory with alerts
router.get('/inventory', authenticateToken, async (req, res) => {
  try {
    // Check license status first
    const licenseService = require('../services/licenseService');
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid') {
      return res.json({
        success: true,
        license_required: true,
        message: 'License activation required to access inventory',
        inventory: [],
        alerts: []
      });
    }
    
    const { station_id } = req.query;
    
    try {
      const inventory = await inventoryManagementService.getInventoryWithAlerts(station_id);
      res.json(inventory);
    } catch (dbError) {
      if (dbError.message.includes('Database not initialized')) {
        console.log('⚠️ Database not ready yet, returning empty inventory');
        return res.json({
          success: true,
          license_required: false,
          message: 'Database initializing, please refresh in a moment',
          inventory: [],
          alerts: []
        });
      }
      throw dbError; // Re-throw if it's a different error
    }
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventory' });
  }
});

// Update stock levels
router.post('/stock/update', authenticateToken, async (req, res) => {
  try {
    const { stationId, ppeItemId, quantity, operation } = req.body;
    
    if (!stationId || !ppeItemId || !quantity || !operation) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!['ADD', 'SUBTRACT'].includes(operation)) {
      return res.status(400).json({ error: 'Invalid operation. Must be ADD or SUBTRACT' });
    }
    
    const result = await inventoryManagementService.updateStock(
      stationId,
      ppeItemId,
      parseInt(quantity),
      operation,
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update inventory thresholds
router.post('/thresholds/update', authenticateToken, async (req, res) => {
  try {
    const { stationId, ppeItemId, minThreshold, criticalThreshold } = req.body;
    
    if (!stationId || !ppeItemId || minThreshold === undefined || criticalThreshold === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const result = await inventoryManagementService.updateThresholds(
      stationId,
      ppeItemId,
      parseInt(minThreshold),
      parseInt(criticalThreshold),
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    console.error('Update thresholds error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active alerts
router.get('/alerts', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const alerts = await inventoryManagementService.getActiveAlerts(parseInt(limit));
    res.json(alerts);
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge alert
router.post('/alerts/:alertId/acknowledge', authenticateToken, async (req, res) => {
  try {
    const { alertId } = req.params;
    const result = await inventoryManagementService.acknowledgeAlert(alertId, req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Acknowledge alert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk update thresholds
router.post('/thresholds/bulk-update', authenticateToken, async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates must be an array' });
    }
    
    const results = [];
    
    for (const update of updates) {
      try {
        const result = await inventoryManagementService.updateThresholds(
          update.stationId,
          update.ppeItemId,
          parseInt(update.minThreshold),
          parseInt(update.criticalThreshold),
          req.user.id
        );
        results.push({ ...update, success: true });
      } catch (error) {
        results.push({ ...update, success: false, error: error.message });
      }
    }
    
    res.json({ results });
  } catch (error) {
    console.error('Bulk update thresholds error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get inventory statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const inventory = await inventoryManagementService.getInventoryWithAlerts();
    const alerts = await inventoryManagementService.getActiveAlerts();
    
    const stats = {
      totalItems: inventory.length,
      lowStockItems: inventory.filter(item => item.stock_status === 'LOW').length,
      criticalStockItems: inventory.filter(item => item.stock_status === 'CRITICAL').length,
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(alert => alert.severity === 'CRITICAL').length,
      averageStock: inventory.reduce((sum, item) => sum + item.current_stock, 0) / inventory.length || 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk restock all items in a station
router.post('/bulk-restock', authenticateToken, async (req, res) => {
  try {
    const { stationId, quantity } = req.body;
    
    if (!stationId || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const restockQuantity = parseInt(quantity);
    if (isNaN(restockQuantity) || restockQuantity < 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    
    const result = await inventoryManagementService.bulkRestock(
      stationId,
      restockQuantity,
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    console.error('Bulk restock error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk restock all stations at once (more efficient)
router.post('/bulk-restock-all', authenticateToken, async (req, res) => {
  try {
    const { quantity } = req.body;
    
    if (!quantity) {
      return res.status(400).json({ error: 'Missing quantity field' });
    }
    
    const restockQuantity = parseInt(quantity);
    if (isNaN(restockQuantity) || restockQuantity < 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    
    const result = await inventoryManagementService.bulkRestockAllStations(
      restockQuantity,
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    console.error('Bulk restock all stations error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;