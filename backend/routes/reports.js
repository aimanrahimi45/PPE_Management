const express = require('express');
const { getDb } = require('../database/init');
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess } = require('../middleware/featureFlag');
// Note: Reports use feature-based protection, not employee limit enforcement

const router = express.Router();

// Advanced Usage Analytics (Pro Feature)
router.get('/usage-analytics', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30', groupBy = 'day' } = req.query;
  
  try {
    let dateFormat, dateGroup;
    
    if (groupBy === 'day') {
      dateFormat = '%Y-%m-%d';
      dateGroup = 'DATE(pr.created_at)';
    } else if (groupBy === 'week') {
      dateFormat = '%Y-W%W';
      dateGroup = 'strftime("%Y-W%W", pr.created_at)';
    } else if (groupBy === 'month') {
      dateFormat = '%Y-%m';
      dateGroup = 'strftime("%Y-%m", pr.created_at)';
    } else {
      dateFormat = '%Y-%m-%d';
      dateGroup = 'DATE(pr.created_at)';
    }
    
    const usageData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          ${dateGroup} as period,
          COUNT(DISTINCT pr.id) as total_requests,
          SUM(pri.quantity) as total_items,
          COUNT(DISTINCT u.id) as unique_requesters,
          AVG(pri.quantity) as avg_items_per_request,
          COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) as approved_requests,
          COUNT(CASE WHEN pr.status = 'PENDING' THEN 1 END) as pending_requests,
          COUNT(CASE WHEN pr.status = 'REJECTED' THEN 1 END) as rejected_requests
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        LEFT JOIN users u ON pr.user_id = u.id
        WHERE pr.created_at >= DATE('now', '-' || ? || ' days')
        GROUP BY ${dateGroup}
        ORDER BY period DESC
        LIMIT 100
      `, [parseInt(period)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      success: true,
      period: `${period} days`,
      group_by: groupBy,
      data: usageData
    });
    
  } catch (error) {
    console.error('Usage analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to generate usage analytics',
      message: error.message 
    });
  }
});

// Department Analytics (Pro Feature)
router.get('/department-analytics', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30' } = req.query;
  
  try {
    const departmentData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COALESCE(sd.department, u.department, 'Unknown Department') as department,
          COUNT(DISTINCT pr.id) as total_requests,
          SUM(pri.quantity) as total_items,
          COUNT(DISTINCT COALESCE(pr.staff_id, pr.user_id)) as unique_requesters,
          AVG(pri.quantity) as avg_items_per_request,
          COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) as approved_requests,
          COUNT(CASE WHEN pr.status = 'PENDING' THEN 1 END) as pending_requests,
          COUNT(CASE WHEN pr.status = 'REJECTED' THEN 1 END) as rejected_requests,
          ROUND(
            (COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) * 100.0 / COUNT(*)), 2
          ) as approval_rate
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN staff_directory sd ON pr.staff_id = sd.staff_id
        WHERE pr.created_at >= DATE('now', '-' || ? || ' days')
        GROUP BY COALESCE(sd.department, u.department, 'Unknown Department')
        ORDER BY total_requests DESC
      `, [parseInt(period)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      success: true,
      period: `${period} days`,
      data: departmentData
    });
    
  } catch (error) {
    console.error('Department analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to generate department analytics',
      message: error.message 
    });
  }
});

// PPE Type Analytics (Pro Feature)
router.get('/ppe-analytics', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30' } = req.query;
  
  try {
    const ppeData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pi.name as ppe_item,
          pi.type as ppe_type,
          COUNT(DISTINCT pr.id) as total_requests,
          SUM(pri.quantity) as total_quantity,
          AVG(pri.quantity) as avg_quantity_per_request,
          COUNT(CASE WHEN pri.issued = 1 THEN 1 END) as issued_quantity,
          COUNT(CASE WHEN pri.issued = 0 THEN 1 END) as pending_quantity,
          ROUND(
            (COUNT(CASE WHEN pri.issued = 1 THEN 1 END) * 100.0 / COUNT(*)), 2
          ) as fulfillment_rate
        FROM ppe_request_items pri
        JOIN ppe_items pi ON pri.ppe_item_id = pi.id
        JOIN ppe_requests pr ON pri.request_id = pr.id
        WHERE pr.created_at >= DATE('now', '-' || ? || ' days')
        GROUP BY pi.id, pi.name, pi.type
        ORDER BY total_quantity DESC
      `, [parseInt(period)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      success: true,
      period: `${period} days`,
      data: ppeData
    });
    
  } catch (error) {
    console.error('PPE analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to generate PPE analytics',
      message: error.message 
    });
  }
});

// Cost Analysis (Pro Feature)
router.get('/cost-analysis', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30' } = req.query;
  
  try {
    const costData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          pi.name as ppe_item,
          pi.type as ppe_type,
          SUM(pri.quantity) as total_quantity,
          COALESCE(pi.unit_cost, 0) as unit_cost,
          ROUND(SUM(pri.quantity) * COALESCE(pi.unit_cost, 0), 2) as total_cost,
          COUNT(DISTINCT pr.id) as total_requests,
          strftime('%Y-%m', pr.created_at) as month
        FROM ppe_request_items pri
        JOIN ppe_items pi ON pri.ppe_item_id = pi.id
        JOIN ppe_requests pr ON pri.request_id = pr.id
        WHERE pr.created_at >= DATE('now', '-' || ? || ' days')
          AND pr.status = 'APPROVED'
        GROUP BY pi.id, pi.name, pi.type, strftime('%Y-%m', pr.created_at)
        ORDER BY month DESC, total_cost DESC
      `, [parseInt(period)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Calculate summary statistics
    const totalCost = costData.reduce((sum, item) => sum + (item.total_cost || 0), 0);
    const totalQuantity = costData.reduce((sum, item) => sum + (item.total_quantity || 0), 0);
    const avgCostPerItem = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    
    res.json({
      success: true,
      period: `${period} days`,
      summary: {
        total_cost: Math.round(totalCost * 100) / 100,
        total_quantity: totalQuantity,
        avg_cost_per_item: Math.round(avgCostPerItem * 100) / 100
      },
      data: costData
    });
    
  } catch (error) {
    console.error('Cost analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to generate cost analysis',
      message: error.message 
    });
  }
});

// Staff Performance Analytics (Pro Feature)
router.get('/staff-analytics', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30', department = null } = req.query;
  
  try {
    let whereClause = `pr.created_at >= DATE('now', '-' || ? || ' days')`;
    let params = [parseInt(period)];
    
    if (department && department !== 'all') {
      whereClause += ` AND (COALESCE(sd.department, u.department) = ?)`;
      params.push(department);
    }
    
    const staffData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COALESCE(pr.staff_id, pr.user_id) as user_id,
          COALESCE(sd.name, u.name, 'Unknown User') as staff_name,
          COALESCE(sd.department, u.department, 'Unknown Department') as department,
          COALESCE(u.role, 'Worker') as position,
          COUNT(DISTINCT pr.id) as total_requests,
          SUM(pri.quantity) as total_items,
          AVG(pri.quantity) as avg_items_per_request,
          COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) as approved_requests,
          COUNT(CASE WHEN pr.status = 'PENDING' THEN 1 END) as pending_requests,
          COUNT(CASE WHEN pr.status = 'REJECTED' THEN 1 END) as rejected_requests,
          MIN(pr.created_at) as first_request,
          MAX(pr.created_at) as last_request
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN staff_directory sd ON pr.staff_id = sd.staff_id
        WHERE ${whereClause}
        GROUP BY COALESCE(pr.staff_id, pr.user_id), COALESCE(sd.name, u.name, 'Unknown User'), COALESCE(sd.department, u.department, 'Unknown Department'), COALESCE(u.role, 'Worker')
        ORDER BY total_requests DESC
        LIMIT 100
      `, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({
      success: true,
      period: `${period} days`,
      department: department || 'all',
      data: staffData
    });
    
  } catch (error) {
    console.error('Staff analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to generate staff analytics',
      message: error.message 
    });
  }
});

// Individual PPE Issuance Records (Pro Feature)
router.get('/individual-issuance', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30', userId = null, department = null, limit = 100 } = req.query;
  
  try {
    let whereClause = `pr.created_at >= DATE('now', '-' || ? || ' days') AND pr.status = 'APPROVED'`;
    let params = [parseInt(period)];
    
    if (userId && userId !== 'all') {
      whereClause += ` AND pr.user_id = ?`;
      params.push(userId);
    }
    
    if (department && department !== 'all') {
      whereClause += ` AND u.department = ?`;
      params.push(department);
    }
    
    const issuanceData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COALESCE(u.name, 'Unknown User') as staff_name,
          COALESCE(u.department, 'Unknown Department') as department,
          COALESCE(u.role, 'Unknown Position') as position,
          pi.name as ppe_item,
          pi.type as ppe_type,
          pri.quantity,
          pr.notes as reason,
          pr.created_at as issue_date,
          s.name as station_name,
          s.location as station_location,
          ROUND(pri.quantity * COALESCE(pi.unit_cost, 0), 2) as item_cost
        FROM ppe_requests pr
        JOIN ppe_request_items pri ON pr.id = pri.request_id
        JOIN ppe_items pi ON pri.ppe_item_id = pi.id
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN stations s ON pr.station_id = s.id
        WHERE ${whereClause}
        ORDER BY pr.created_at DESC
        LIMIT ${parseInt(limit)}
      `, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    // Calculate summary statistics
    const totalIssued = issuanceData.reduce((sum, item) => sum + item.quantity, 0);
    const totalCost = issuanceData.reduce((sum, item) => sum + (item.item_cost || 0), 0);
    const uniqueWorkers = new Set(issuanceData.map(item => item.staff_name)).size;
    const uniqueItems = new Set(issuanceData.map(item => item.ppe_item)).size;
    
    res.json({
      success: true,
      period: `${period} days`,
      summary: {
        total_records: issuanceData.length,
        total_items_issued: totalIssued,
        total_cost: Math.round(totalCost * 100) / 100,
        unique_workers: uniqueWorkers,
        unique_ppe_types: uniqueItems
      },
      data: issuanceData
    });
    
  } catch (error) {
    console.error('Individual issuance error:', error);
    res.status(500).json({ 
      error: 'Failed to generate individual issuance report',
      message: error.message 
    });
  }
});

// Export Report (Pro Feature)
router.get('/export/:reportType', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const { reportType } = req.params;
  const { period = '30', format = 'json' } = req.query;
  
  try {
    let reportData;
    
    // Route to appropriate report generator
    switch (reportType) {
      case 'usage':
        const usageResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reports/usage-analytics?period=${period}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        reportData = await usageResponse.json();
        break;
        
      case 'department':
        const deptResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reports/department-analytics?period=${period}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        reportData = await deptResponse.json();
        break;
        
      case 'ppe':
        const ppeResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reports/ppe-analytics?period=${period}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        reportData = await ppeResponse.json();
        break;
        
      case 'cost':
        const costResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reports/cost-analysis?period=${period}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        reportData = await costResponse.json();
        break;
        
      case 'staff':
        const staffResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/reports/staff-analytics?period=${period}`, {
          headers: { 'Authorization': req.headers.authorization }
        });
        reportData = await staffResponse.json();
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid report type' });
    }
    
    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(reportData.data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}-report-${period}days.csv"`);
      res.send(csv);
    } else {
      // Return JSON
      res.json(reportData);
    }
    
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ 
      error: 'Failed to export report',
      message: error.message 
    });
  }
});

// Staff Audit Export for Compliance (Pro Feature)
router.get('/staff-audit-export', authenticateToken, checkFeatureAccess('advanced_reports'), async (req, res) => {
  const db = getDb();
  const { period = '30', format = 'csv' } = req.query;
  
  try {
    const auditData = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COALESCE(sd.name, u.name, 'Unknown User') as staff_name,
          COALESCE(sd.email, u.email, pr.staff_id, 'No Email') as staff_email,
          COALESCE(sd.department, u.department, 'Unknown Department') as department,
          COALESCE(u.role, 'Worker') as position,
          pi.name as ppe_item_name,
          pi.type as ppe_category,
          pri.quantity as quantity_requested,
          CASE 
            WHEN pr.status = 'APPROVED' THEN 'APPROVED'
            WHEN pr.status = 'REJECTED' THEN 'REJECTED'
            WHEN pr.status = 'PENDING' THEN 'PENDING'
            ELSE 'UNKNOWN'
          END as approval_status,
          CASE 
            WHEN pr.status = 'APPROVED' AND pri.issued = 1 THEN 'ISSUED'
            WHEN pr.status = 'APPROVED' AND pri.issued = 0 THEN 'APPROVED_NOT_ISSUED'
            WHEN pr.status = 'REJECTED' THEN 'REJECTED'
            WHEN pr.status = 'PENDING' THEN 'PENDING_APPROVAL'
            ELSE 'UNKNOWN'
          END as issuance_status,
          COALESCE(pr.notes, 'No reason provided') as request_reason,
          DATE(pr.created_at) as request_date,
          TIME(pr.created_at) as request_time,
          s.name as station_name,
          s.location as station_location,
          ROUND(pri.quantity * COALESCE(pi.unit_cost, 0), 2) as total_cost,
          pr.id as request_id,
          pr.updated_at as last_updated,
          pr.staff_id as staff_id
        FROM ppe_requests pr
        JOIN ppe_request_items pri ON pr.id = pri.request_id
        JOIN ppe_items pi ON pri.ppe_item_id = pi.id
        LEFT JOIN users u ON pr.user_id = u.id
        LEFT JOIN staff_directory sd ON pr.staff_id = sd.staff_id
        LEFT JOIN stations s ON pr.station_id = s.id
        WHERE pr.created_at >= DATE('now', '-' || ? || ' days')
        ORDER BY pr.created_at DESC, COALESCE(sd.name, u.name, 'Unknown User') ASC, pi.name ASC
      `, [parseInt(period)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    if (format === 'csv') {
      // Convert to CSV format with proper headers for audit trail
      const csvHeaders = [
        'Staff Name',
        'Staff Email', 
        'Department',
        'Position',
        'PPE Item',
        'PPE Category',
        'Quantity',
        'Approval Status',
        'Issuance Status',
        'Request Reason',
        'Request Date',
        'Request Time',
        'Station Name',
        'Station Location',
        'Total Cost ($)',
        'Request ID',
        'Last Updated'
      ].join(',');
      
      const csvRows = auditData.map(row => [
        `"${row.staff_name}"`,
        `"${row.staff_email}"`,
        `"${row.department}"`,
        `"${row.position}"`,
        `"${row.ppe_item_name}"`,
        `"${row.ppe_category}"`,
        row.quantity_requested,
        `"${row.approval_status}"`,
        `"${row.issuance_status}"`,
        `"${row.request_reason}"`,
        `"${row.request_date}"`,
        `"${row.request_time}"`,
        `"${row.station_name}"`,
        `"${row.station_location}"`,
        row.total_cost,
        `"${row.request_id}"`,
        `"${row.last_updated}"`
      ].join(','));
      
      const csv = [csvHeaders, ...csvRows].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="staff-audit-detailed-${period}days.csv"`);
      res.send(csv);
    } else {
      // Return JSON with summary
      const summary = {
        total_records: auditData.length,
        unique_staff: new Set(auditData.map(item => item.staff_name)).size,
        approved_requests: auditData.filter(item => item.approval_status === 'APPROVED').length,
        rejected_requests: auditData.filter(item => item.approval_status === 'REJECTED').length,
        pending_requests: auditData.filter(item => item.approval_status === 'PENDING').length,
        total_cost: auditData.reduce((sum, item) => sum + (item.total_cost || 0), 0)
      };
      
      res.json({
        success: true,
        period: `${period} days`,
        summary: summary,
        data: auditData
      });
    }
    
  } catch (error) {
    console.error('Staff audit export error:', error);
    res.status(500).json({ 
      error: 'Failed to generate staff audit export',
      message: error.message 
    });
  }
});

// Helper function to convert JSON to CSV
function convertToCSV(jsonData) {
  if (!jsonData || jsonData.length === 0) {
    return '';
  }
  
  const headers = Object.keys(jsonData[0]).join(',');
  const rows = jsonData.map(row => 
    Object.values(row).map(value => 
      typeof value === 'string' ? `"${value}"` : value
    ).join(',')
  );
  
  return [headers, ...rows].join('\n');
}

module.exports = router;