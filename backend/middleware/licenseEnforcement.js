const licenseService = require('../services/licenseService');

/**
 * Middleware to enforce license compliance for all admin operations
 * Blocks system access if license is expired or employee limits exceeded
 */
const enforceLicenseCompliance = async (req, res, next) => {
  try {
    // Skip enforcement for certain endpoints that must work for customer onboarding
    const exemptPaths = [
      '/api/auth/',
      '/api/features',
      '/api/features/license-status',
      '/api/features/employee-limit',
      '/api/dashboard/stats',
      '/api/license/upload',
      '/api/license/activate',
      '/api/license/status',
      '/api/setup/',
      '/api/approval/pending',
      '/api/departments',
      '/api/departments/',
      '/api/health',
      '/api/cache/',
      '/api/system/'
    ];
    
    // Check if path matches any exempt pattern
    const isExempt = exemptPaths.some(path => {
      if (path.endsWith('/')) {
        return req.originalUrl.startsWith(path);
      } else {
        return req.originalUrl === path || req.originalUrl.startsWith(path + '?') || req.originalUrl.startsWith(path + '/');
      }
    });
    
    // Debug logging for departments API
    if (req.originalUrl.includes('/api/departments')) {
      console.log(`🔍 Departments API call: ${req.method} ${req.originalUrl}, Exempt: ${isExempt}`);
    }
    
    if (isExempt) {
      return next();
    }

    // Check license validity
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid') {
      return res.status(403).json({
        error: 'License Required',
        message: 'A valid license is required to access this system. Please contact support.',
        code: 'LICENSE_INVALID',
        requires_license: true
      });
    }

    if (licenseStatus.status === 'expired') {
      return res.status(403).json({
        error: 'License Expired',
        message: 'Your license has expired. Please renew your license to continue using the system.',
        code: 'LICENSE_EXPIRED',
        expiration_date: licenseStatus.expiration_date
      });
    }

    // Check employee limits for admin operations (except deactivation which helps resolve the issue)
    const employeeLimit = await licenseService.checkEmployeeLimit();
    
    // Skip employee limit checks for unlimited licenses
    if (!employeeLimit.is_unlimited && employeeLimit.exceeded) {
      // Allow certain operations that help resolve the employee limit issue
      const allowedPaths = [
        '/deactivate',
        '/employee-limit'
      ];
      
      const isAllowedOperation = allowedPaths.some(path => req.path.includes(path));
      
      if (!isAllowedOperation) {
        return res.status(403).json({
          error: 'Employee Limit Exceeded',
          message: `Your license allows ${employeeLimit.max_employees} employees, but you currently have ${employeeLimit.current_employees} active employees. Please deactivate ${employeeLimit.current_employees - employeeLimit.max_employees} employees or upgrade your license to continue.`,
          code: 'EMPLOYEE_LIMIT_EXCEEDED',
          current_employees: employeeLimit.current_employees,
          max_employees: employeeLimit.max_employees,
          excess_employees: employeeLimit.current_employees - employeeLimit.max_employees
        });
      }
    }

    // Add license info to request for use in handlers
    req.licenseStatus = licenseStatus;
    req.employeeLimit = await licenseService.checkEmployeeLimit();
    
    next();
    
  } catch (error) {
    console.error('License enforcement error:', error);
    return res.status(500).json({
      error: 'License Validation Failed',
      message: 'Unable to validate license. Please try again.',
      code: 'LICENSE_VALIDATION_ERROR'
    });
  }
};

/**
 * Middleware specifically for staff operations
 * Prevents adding new staff when at or over limit
 */
const enforceStaffLimits = async (req, res, next) => {
  try {
    // Only check for POST operations that add staff
    if (req.method !== 'POST' && !req.path.includes('/add') && !req.path.includes('/import')) {
      return next();
    }

    const employeeLimit = await licenseService.checkEmployeeLimit();
    
    // Skip all employee limit checks for unlimited licenses
    if (employeeLimit.is_unlimited) {
      console.log('🔓 Unlimited license detected - skipping employee limit checks');
      return next();
    }

    if (employeeLimit.exceeded) {
      return res.status(403).json({
        error: 'Cannot Add Staff - Employee Limit Exceeded',
        message: `Your license allows ${employeeLimit.max_employees} employees. You currently have ${employeeLimit.current_employees} active employees. Please upgrade your license or deactivate existing staff before adding new employees.`,
        code: 'STAFF_LIMIT_EXCEEDED',
        current_employees: employeeLimit.current_employees,
        max_employees: employeeLimit.max_employees
      });
    }

    // Check if adding staff would exceed limit (only for limited licenses)
    if (req.body && (req.body.staffId || req.body.length)) {
      const newStaffCount = req.body.length || 1; // For bulk import or single add
      
      if (employeeLimit.current_employees + newStaffCount > employeeLimit.max_employees) {
        return res.status(403).json({
          error: 'Cannot Add Staff - Would Exceed License Limit',
          message: `Adding ${newStaffCount} staff would exceed your license limit of ${employeeLimit.max_employees} employees. You can add ${employeeLimit.remaining} more employees.`,
          code: 'WOULD_EXCEED_LIMIT',
          current_employees: employeeLimit.current_employees,
          max_employees: employeeLimit.max_employees,
          remaining: employeeLimit.remaining,
          attempting_to_add: newStaffCount
        });
      }
    }

    next();
    
  } catch (error) {
    console.error('Staff limit enforcement error:', error);
    return res.status(500).json({
      error: 'Staff Limit Validation Failed',
      message: 'Unable to validate staff limits. Please try again.'
    });
  }
};

module.exports = {
  enforceLicenseCompliance,
  enforceStaffLimits
};