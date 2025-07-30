const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { FEATURE_DEFINITIONS } = require('../middleware/featureFlag');
const licenseService = require('../services/licenseService');

const router = express.Router();

// Get license features and status
router.get('/', async (req, res) => {
  try {
    // Get license status
    const licenseStatus = await licenseService.getLicenseStatus();
    
    if (!licenseStatus || licenseStatus.status === 'invalid' || licenseStatus.requires_license) {
      // No license - all features disabled for security
      console.log('🔒 No valid license found - all features disabled');
      
      const allFeatures = Object.keys(FEATURE_DEFINITIONS).map(featureName => ({
        ...FEATURE_DEFINITIONS[featureName],
        enabled: false, // All features disabled without license
        feature_key: featureName
      }));
      
      const featuresByTier = {
        basic: allFeatures.filter(f => f.tier === 'basic'),
        pro: allFeatures.filter(f => f.tier === 'pro'),
        enterprise: allFeatures.filter(f => f.tier === 'enterprise')
      };
      
      return res.json({
        success: true,
        license_status: { 
          status: 'inactive', 
          message: 'No active license - Please activate your subscription',
          requires_activation: true 
        },
        features: featuresByTier,
        enabled_count: 0,
        total_count: Object.keys(FEATURE_DEFINITIONS).length
      });
    }
    
    // Get enabled features using enhanced logic (matches licenseService.isFeatureEnabled)
    const featurePromises = Object.keys(FEATURE_DEFINITIONS).map(async featureName => {
      const isEnabled = await licenseService.isFeatureEnabled(featureName);
      return {
        ...FEATURE_DEFINITIONS[featureName],
        enabled: isEnabled,
        feature_key: featureName
      };
    });
    
    const allFeatures = await Promise.all(featurePromises);
    
    // Group by tier
    const featuresByTier = {
      basic: allFeatures.filter(f => f.tier === 'basic'),
      pro: allFeatures.filter(f => f.tier === 'pro'),
      enterprise: allFeatures.filter(f => f.tier === 'enterprise')
    };
    
    // Calculate enabled features count
    const enabledCount = allFeatures.filter(f => f.enabled).length;
    
    res.json({
      success: true,
      license_status: licenseStatus,
      features: featuresByTier,
      enabled_count: enabledCount,
      total_count: Object.keys(FEATURE_DEFINITIONS).length
    });
    
  } catch (error) {
    console.error('Get license features error:', error);
    res.status(500).json({ 
      error: 'Failed to get license features',
      message: 'License validation failed'
    });
  }
});

// Check specific feature availability
router.get('/check/:featureName', authenticateToken, async (req, res) => {
  try {
    const { featureName } = req.params;
    
    if (!FEATURE_DEFINITIONS[featureName]) {
      return res.status(404).json({
        error: 'Feature not found',
        feature: featureName
      });
    }
    
    const isEnabled = await licenseService.isFeatureEnabled(featureName);
    const licenseStatus = await licenseService.getLicenseStatus();
    
    res.json({
      success: true,
      feature: featureName,
      enabled: isEnabled,
      definition: FEATURE_DEFINITIONS[featureName],
      license_status: licenseStatus
    });
    
  } catch (error) {
    console.error('Check feature error:', error);
    res.status(500).json({ 
      error: 'Failed to check feature availability',
      message: 'License validation failed'
    });
  }
});

// Get license status only
router.get('/license-status', async (req, res) => {
  try {
    const licenseStatus = await licenseService.getLicenseStatus();
    res.json({
      success: true,
      license: licenseStatus
    });
  } catch (error) {
    console.error('Get license status error:', error);
    res.status(500).json({ 
      error: 'Failed to get license status',
      message: 'License validation failed'
    });
  }
});

// Check employee limit
router.get('/employee-limit', async (req, res) => {
  try {
    const employeeLimit = await licenseService.checkEmployeeLimit();
    res.json({
      success: true,
      employee_limit: employeeLimit
    });
  } catch (error) {
    console.error('Employee limit check error:', error);
    res.status(500).json({
      error: 'Failed to check employee limit'
    });
  }
});

module.exports = router;