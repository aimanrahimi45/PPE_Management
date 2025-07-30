const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { authenticateToken, authenticateWithCompany } = require('../middleware/auth');
const { checkFeatureAccess, addCompanyContext } = require('../middleware/featureFlag');
const { enforceLicenseCompliance, enforceStaffLimits } = require('../middleware/licenseEnforcement');
const staffVerificationService = require('../services/staffVerificationService');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/staff/';
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const originalExtension = path.extname(file.originalname).toLowerCase();
    cb(null, `staff-import-${timestamp}${originalExtension}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    const allowedExtensions = ['.csv', '.xls', '.xlsx'];
    const hasValidExtension = allowedExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (allowedTypes.includes(file.mimetype) || hasValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for Excel files
  }
});

// Verify staff ID (public endpoint for worker interface)
router.post('/verify', async (req, res) => {
  try {
    // Check license before allowing staff verification
    const licenseService = require('../services/licenseService');
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.status === 'expired') {
      return res.status(403).json({
        valid: false,
        error: 'System License Required',
        message: 'A valid system license is required for staff verification. Please contact your administrator.',
        code: 'LICENSE_REQUIRED'
      });
    }
    
    const { staffId } = req.body;
    
    if (!staffId) {
      return res.status(400).json({ 
        error: 'Staff ID is required',
        code: 'MISSING_STAFF_ID'
      });
    }
    
    const result = await staffVerificationService.verifyStaffId(staffId);
    res.json(result);
    
  } catch (error) {
    console.error('Staff verification error:', error);
    res.status(500).json({ 
      error: 'Staff verification failed',
      message: 'Internal server error during verification'
    });
  }
});

// Get all staff (admin only)
router.get('/', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const { active, department, limit } = req.query;
    
    const options = {
      active: active === 'all' ? null : (active === 'false' ? false : true),
      department: department || null,
      limit: parseInt(limit) || 1000,
      companyId: req.companyId
    };
    
    const staff = await staffVerificationService.getAllStaff(options);
    res.json(staff);
    
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ error: 'Failed to fetch staff directory' });
  }
});

// Get staff statistics (admin only) - MUST BE BEFORE /:staffId route
router.get('/stats', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const stats = await staffVerificationService.getStaffStats(req.companyId);
    
    // Format stats for frontend
    const formattedStats = {
      total_staff: stats.total,
      active_staff: stats.active,
      inactive_staff: stats.inactive,
      departments: stats.departments
    };
    
    res.json(formattedStats);
    
  } catch (error) {
    console.error('Staff stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Get single staff member by ID (admin only)
router.get('/:staffId', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const { staffId } = req.params;
    const staff = await staffVerificationService.getStaffById(staffId, req.companyId);
    
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    
    res.json(staff);
    
  } catch (error) {
    console.error('Get staff by ID error:', error);
    res.status(500).json({ error: 'Failed to get staff' });
  }
});

// Add single staff member (admin only)
router.post('/', authenticateWithCompany, enforceLicenseCompliance, enforceStaffLimits, async (req, res) => {
  try {
    const { staffId, name, email, department, position } = req.body;
    
    if (!staffId || !name) {
      return res.status(400).json({ 
        error: 'Staff ID and name are required' 
      });
    }
    
    const result = await staffVerificationService.addStaff({
      staffId,
      name,
      email,
      department,
      position,
      companyId: req.companyId
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Add staff error:', error);
    res.status(500).json({ error: 'Failed to add staff member' });
  }
});

// Import staff from Excel or CSV (admin only) - Basic Staff Management Feature
router.post('/import', authenticateWithCompany, enforceLicenseCompliance, enforceStaffLimits, checkFeatureAccess('staff_management'), upload.single('staffFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Staff file is required' });
    }
    
    const filePath = req.file.path;
    const fileExtension = req.file.originalname.toLowerCase().split('.').pop();
    
    console.log(`Processing ${fileExtension.toUpperCase()} file: ${req.file.originalname}`);
    
    const result = await staffVerificationService.importStaffFromFile(filePath);
    
    // Clean up uploaded file
    fs.unlinkSync(filePath);
    
    console.log(`Import completed: ${result.successCount} successful, ${result.errorCount} errors`);
    
    res.json(result);
    
  } catch (error) {
    console.error('Staff import error:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Failed to import staff',
      message: error.message 
    });
  }
});

// Search staff (admin only)
router.get('/search', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ 
        error: 'Search term must be at least 2 characters' 
      });
    }
    
    const results = await staffVerificationService.searchStaff(q);
    res.json(results);
    
  } catch (error) {
    console.error('Staff search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Update staff member (admin only)
router.put('/:staffId', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { name, email, department, position } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const result = await staffVerificationService.updateStaff(staffId, {
      name,
      email,
      department,
      position
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ error: 'Failed to update staff' });
  }
});

// Add single staff member (admin only)
router.post('/add', authenticateWithCompany, enforceLicenseCompliance, enforceStaffLimits, async (req, res) => {
  try {
    const { staffId, name, email, department, position } = req.body;
    
    if (!staffId || !name) {
      return res.status(400).json({ error: 'Staff ID and name are required' });
    }
    
    const result = await staffVerificationService.addStaff({
      staffId,
      name,
      email,
      department,
      position,
      companyId: req.companyId
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Add staff error:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Staff ID already exists' });
    }
    res.status(500).json({ error: 'Failed to add staff' });
  }
});

// Deactivate staff member (admin only)
router.patch('/:staffId/deactivate', authenticateWithCompany, enforceLicenseCompliance, async (req, res) => {
  try {
    const { staffId } = req.params;
    const result = await staffVerificationService.deactivateStaff(staffId);
    res.json(result);
    
  } catch (error) {
    console.error('Deactivate staff error:', error);
    res.status(500).json({ error: 'Failed to deactivate staff' });
  }
});

// Reactivate staff member (admin only)
router.patch('/:staffId/reactivate', authenticateWithCompany, enforceLicenseCompliance, enforceStaffLimits, async (req, res) => {
  try {
    const { staffId } = req.params;
    const result = await staffVerificationService.reactivateStaff(staffId);
    res.json(result);
    
  } catch (error) {
    console.error('Reactivate staff error:', error);
    res.status(500).json({ error: 'Failed to reactivate staff' });
  }
});

// Download staff template Excel
router.get('/template', authenticateToken, enforceLicenseCompliance, (req, res) => {
  try {
    // Create a new workbook
    const wb = XLSX.utils.book_new();
    
    // Sample data with improved examples
    const data = [
      ['staff_id', 'name', 'email', 'department', 'position'],
      ['EMP001', 'John Doe', 'john.doe@company.com', 'Engineering', 'Software Engineer'],
      ['EMP002', 'Jane Smith', 'jane.smith@company.com', 'Operations', 'Supervisor'],
      ['EMP003', 'Bob Johnson', 'bob.johnson@company.com', 'Maintenance', 'Technician'],
      ['WRK001', 'Alice Wilson', 'alice.wilson@company.com', 'Production', 'Line Worker'],
      ['TEMP001', 'Mike Brown', 'mike.brown@temp.company.com', 'Contract', 'Temporary Worker'],
      ['', '', '', '', ''],
      ['NOTES:', 'Required fields: staff_id, name', 'Email can be blank', 'Department & position are optional', 'Delete sample rows before import']
    ];
    
    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Set column widths
    ws['!cols'] = [
      { width: 12 }, // staff_id
      { width: 20 }, // name
      { width: 25 }, // email
      { width: 15 }, // department
      { width: 20 }  // position
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Staff Data');
    
    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const filename = `staff-import-template-${timestamp}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Template generation error:', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// Permanently delete staff member
router.delete('/:staffId/delete', authenticateToken, enforceLicenseCompliance, async (req, res) => {
  try {
    console.log(`Delete request for staff: ${req.params.staffId}`);
    const { staffId } = req.params;
    const result = await staffVerificationService.permanentDeleteStaff(staffId);
    console.log(`Delete result:`, result);
    res.json(result);
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Failed to delete staff' });
  }
});

module.exports = router;