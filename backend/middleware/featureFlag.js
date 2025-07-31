const { getDb } = require('../database/init');
const licenseService = require('../services/licenseService');

/**
 * Feature flag middleware to check if a company has access to a specific feature
 * @param {string} featureName - Name of the feature to check
 * @returns {Function} Express middleware function
 */
function checkFeatureAccess(featureName) {
  return async (req, res, next) => {
    try {
      // Check license-based feature access
      const hasAccess = await licenseService.isFeatureEnabled(featureName);
      
      if (!hasAccess) {
        const licenseStatus = await licenseService.getLicenseStatus();
        const featureDefinition = FEATURE_DEFINITIONS[featureName];
        
        // Check if feature is coming soon
        if (featureDefinition && featureDefinition.status === 'coming_soon') {
          return res.status(503).json({
            error: 'Feature coming soon',
            feature: featureName,
            feature_name: featureDefinition.name,
            coming_soon: true,
            license_status: licenseStatus.status,
            subscription_tier: licenseStatus.subscription_tier,
            message: `The feature "${featureDefinition.name}" is coming soon! We're working hard to bring this feature to you. Stay tuned for updates.`,
            expected_tier: featureDefinition.tier,
            expected_price: `RM ${featureDefinition.price}/month`
          });
        }
        
        return res.status(403).json({
          error: 'Feature not available in your current license',
          feature: featureName,
          feature_name: featureDefinition?.name || featureName,
          upgrade_required: true,
          license_status: licenseStatus.status,
          subscription_tier: licenseStatus.subscription_tier,
          required_tier: featureDefinition?.tier,
          required_price: featureDefinition ? `RM ${featureDefinition.price}/month` : 'Contact support',
          message: `The feature "${featureDefinition?.name || featureName}" is not available in your current subscription plan. Please contact support to upgrade your license.`
        });
      }
      
      req.featureAccess = true;
      next();
      
    } catch (error) {
      console.error('Feature access check error:', error);
      res.status(500).json({
        error: 'Unable to verify feature access',
        message: 'License validation failed'
      });
    }
  };
}

/**
 * Check if a company has access to a specific feature
 * @param {string} companyId - Company ID
 * @param {string} featureName - Feature name
 * @returns {Promise<boolean>} True if company has access
 */
async function checkCompanyFeature(companyId, featureName) {
  const db = getDb();
  
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ff.is_enabled, c.subscription_status
       FROM feature_flags ff
       JOIN companies c ON ff.company_id = c.id
       WHERE ff.company_id = ? AND ff.feature_name = ?`,
      [companyId, featureName],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Feature not found or company suspended
        if (!row || row.subscription_status === 'suspended') {
          resolve(false);
          return;
        }
        
        resolve(row.is_enabled === 1);
      }
    );
  });
}

/**
 * Get all enabled features for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} List of enabled features
 */
async function getCompanyFeatures(companyId) {
  const db = getDb();
  
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT ff.feature_name, ff.is_enabled, ff.enabled_at
       FROM feature_flags ff
       JOIN companies c ON ff.company_id = c.id
       WHERE ff.company_id = ? AND ff.is_enabled = 1 AND c.subscription_status = 'active'
       ORDER BY ff.feature_name`,
      [companyId],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      }
    );
  });
}

/**
 * Enable or disable a feature for a company
 * @param {string} companyId - Company ID
 * @param {string} featureName - Feature name
 * @param {boolean} isEnabled - Enable or disable
 * @returns {Promise<Object>} Update result
 */
async function toggleCompanyFeature(companyId, featureName, isEnabled) {
  const db = getDb();
  
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO feature_flags (company_id, feature_name, is_enabled, enabled_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [companyId, featureName, isEnabled],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        resolve({
          success: true,
          companyId,
          featureName,
          isEnabled,
          message: `Feature ${featureName} ${isEnabled ? 'enabled' : 'disabled'} for company ${companyId}`
        });
      }
    );
  });
}

/**
 * Middleware to add company context to requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function addCompanyContext(req, res, next) {
  // Extract company ID from various sources
  const companyId = req.user?.company_id || 
                   req.headers['x-company-id'] || 
                   req.query.company_id || 
                   'your-company';
  
  req.companyId = companyId;
  next();
}

/**
 * Middleware to ensure requests are scoped to company
 * This adds company_id filter to database queries
 */
function companyScopedQuery(req, res, next) {
  const companyId = req.companyId || 'your-company';
  
  // Add company filter to query parameters
  if (!req.query.company_id) {
    req.query.company_id = companyId;
  }
  
  // Add company filter to body for POST/PUT requests
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!req.body.company_id) {
      req.body.company_id = companyId;
    }
  }
  
  next();
}

/**
 * Subscription tier pricing (RM/month)
 */
const TIER_PRICING = {
  basic: { price: 49, name: 'Basic', currency: 'RM' },
  pro: { price: 89, name: 'Pro', currency: 'RM' },
  enterprise: { price: 149, name: 'Enterprise', currency: 'RM' }
};

/**
 * Feature definitions and their descriptions
 */
const FEATURE_DEFINITIONS = {
  // Basic features (RM 49/month)
  'basic_ppe_management': {
    name: 'Basic PPE Management',
    description: 'Core PPE request and approval functionality',
    tier: 'basic',
    price: 49
  },
  'staff_management': {
    name: 'Staff Management',
    description: 'Manage staff directory and verification',
    tier: 'basic',
    price: 49
  },
  'basic_inventory': {
    name: 'Basic Inventory',
    description: 'Track PPE inventory and low stock alerts',
    tier: 'basic',
    price: 49
  },
  'email_notifications': {
    name: 'Email Notifications',
    description: 'Email alerts for requests and approvals',
    tier: 'basic',
    price: 49
  },
  'basic_station_management': {
    name: 'Basic Station Management',
    description: 'Create and manage up to 1 station location',
    tier: 'basic',
    price: 49,
    limits: {
      max_stations: 1
    }
  },
  
  // Pro features (RM 89/month)
  'advanced_reports': {
    name: 'Advanced Reports',
    description: 'Detailed analytics and reporting dashboard',
    tier: 'pro',
    price: 89
  },
  'analytics_dashboard': {
    name: 'Analytics Dashboard',
    description: 'Visual analytics and usage statistics',
    tier: 'pro',
    price: 89
  },
  'export_reports': {
    name: 'Export Reports',
    description: 'Export reports in PDF and Excel formats',
    tier: 'pro',
    price: 89
  },
  'usage_trends': {
    name: 'Usage Trends',
    description: 'Historical usage trends and forecasting',
    tier: 'pro',
    price: 89
  },
  'compliance_tracking': {
    name: 'Compliance Tracking',
    description: 'Safety compliance monitoring and reporting',
    tier: 'pro',
    price: 89
  },
  'cost_management': {
    name: 'Cost Management',
    description: 'PPE cost tracking and budget management',
    tier: 'pro',
    price: 89
  },
  'unlimited_employees': {
    name: 'Unlimited Employees',
    description: 'No limit on number of staff members',
    tier: 'pro',
    price: 89
  },
  'multi_location': {
    name: 'Multi-Location',
    description: 'Manage multiple locations and warehouses',
    tier: 'pro',
    price: 89
  },
  'condition_reporting': {
    name: 'Condition Reporting',
    description: 'Report and track PPE condition and maintenance',
    tier: 'pro',
    price: 89
  },
  
  // Enterprise features (RM 149/month)
  'api_access': {
    name: 'API Access',
    description: 'REST API for integrations',
    tier: 'enterprise',
    price: 149,
    status: 'available'
  },
  'custom_integrations': {
    name: 'Custom Integrations',
    description: 'Custom integration development',
    tier: 'enterprise',
    price: 149,
    status: 'coming_soon'
  },
  'white_label': {
    name: 'White Label',
    description: 'Brand customization and white labeling',
    tier: 'enterprise',
    price: 149,
    status: 'coming_soon'
  },
  'priority_support': {
    name: 'Priority Support',
    description: '24/7 priority customer support',
    tier: 'enterprise',
    price: 149,
    status: 'available'
  },
  'bulk_operations': {
    name: 'Bulk Operations',
    description: 'Bulk import/export and batch operations',
    tier: 'enterprise',
    price: 149,
    status: 'coming_soon'
  }
};

module.exports = {
  checkFeatureAccess,
  checkCompanyFeature,
  getCompanyFeatures,
  toggleCompanyFeature,
  addCompanyContext,
  companyScopedQuery,
  FEATURE_DEFINITIONS,
  TIER_PRICING
};