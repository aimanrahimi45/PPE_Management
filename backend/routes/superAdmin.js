const express = require('express');
const router = express.Router();
const superAdminService = require('../services/superAdminService');
const companyService = require('../services/companyService');
const { checkFeatureAccess, toggleCompanyFeature, getCompanyFeatures, FEATURE_DEFINITIONS } = require('../middleware/featureFlag');
const { authenticateSuperAdmin } = require('../middleware/superAdminAuth');

// Super Admin Authentication
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }
    
    const result = await superAdminService.login(email, password);
    res.json(result);
    
  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(401).json({
      error: 'Invalid credentials'
    });
  }
});

// Create super admin (for initial setup)
router.post('/create', async (req, res) => {
  try {
    const { username, email, password, name } = req.body;
    
    if (!username || !email || !password || !name) {
      return res.status(400).json({
        error: 'All fields are required'
      });
    }
    
    const result = await superAdminService.createSuperAdmin({
      username,
      email,
      password,
      name
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Create super admin error:', error);
    res.status(400).json({
      error: error.message || 'Failed to create super admin'
    });
  }
});

// Get system statistics
router.get('/stats', authenticateSuperAdmin, async (req, res) => {
  try {
    const stats = await companyService.getSystemStats();
    res.json(stats);
    
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({
      error: 'Failed to get system statistics'
    });
  }
});

// Company Management Routes

// Get all companies
router.get('/companies', authenticateSuperAdmin, async (req, res) => {
  try {
    const companies = await companyService.getAllCompanies();
    res.json(companies);
    
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      error: 'Failed to get companies'
    });
  }
});

// Create new company
router.post('/companies', authenticateSuperAdmin, async (req, res) => {
  try {
    const companyData = req.body;
    const result = await companyService.createCompany(companyData);
    res.json(result);
    
  } catch (error) {
    console.error('Create company error:', error);
    res.status(400).json({
      error: error.message || 'Failed to create company'
    });
  }
});

// Get company by ID
router.get('/companies/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await companyService.getCompanyById(companyId);
    
    if (!company) {
      return res.status(404).json({
        error: 'Company not found'
      });
    }
    
    res.json(company);
    
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({
      error: 'Failed to get company'
    });
  }
});

// Update company
router.put('/companies/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const updateData = req.body;
    
    const result = await companyService.updateCompany(companyId, updateData);
    res.json(result);
    
  } catch (error) {
    console.error('Update company error:', error);
    res.status(400).json({
      error: error.message || 'Failed to update company'
    });
  }
});

// Delete company
router.delete('/companies/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Prevent deletion of your own company
    if (companyId === 'your-company') {
      return res.status(403).json({
        error: 'Cannot delete your own company'
      });
    }
    
    const result = await companyService.deleteCompany(companyId);
    res.json(result);
    
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(400).json({
      error: error.message || 'Failed to delete company'
    });
  }
});

// Feature Management Routes

// Get all features for a company
router.get('/companies/:companyId/features', async (req, res) => {
  try {
    const { companyId } = req.params;
    const features = await getCompanyFeatures(companyId);
    
    // Add feature definitions
    const featuresWithDefinitions = features.map(feature => ({
      ...feature,
      definition: FEATURE_DEFINITIONS[feature.feature_name] || {
        name: feature.feature_name,
        description: 'Custom feature',
        tier: 'custom'
      }
    }));
    
    res.json({
      companyId,
      features: featuresWithDefinitions,
      availableFeatures: FEATURE_DEFINITIONS
    });
    
  } catch (error) {
    console.error('Get company features error:', error);
    res.status(500).json({
      error: 'Failed to get company features'
    });
  }
});

// Toggle feature for a company
router.post('/companies/:companyId/features/:featureName/toggle', async (req, res) => {
  try {
    const { companyId, featureName } = req.params;
    const { enabled } = req.body;
    
    const result = await toggleCompanyFeature(companyId, featureName, enabled);
    res.json(result);
    
  } catch (error) {
    console.error('Toggle feature error:', error);
    res.status(400).json({
      error: error.message || 'Failed to toggle feature'
    });
  }
});

// Get all available features
router.get('/features', (req, res) => {
  res.json({
    features: FEATURE_DEFINITIONS
  });
});

// Subscription Management Routes

// Update subscription tier
router.post('/companies/:companyId/subscription/update', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { subscriptionTier } = req.body;
    
    // Update company subscription
    const result = await companyService.updateCompany(companyId, {
      subscription_tier: subscriptionTier
    });
    
    // Re-initialize features for new tier
    await companyService.initializeFeatureFlags(companyId, subscriptionTier);
    
    res.json({
      success: true,
      message: `Subscription updated to ${subscriptionTier}`,
      companyId,
      subscriptionTier
    });
    
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(400).json({
      error: error.message || 'Failed to update subscription'
    });
  }
});

// Suspend company
router.post('/companies/:companyId/suspend', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const result = await companyService.updateCompany(companyId, {
      subscription_status: 'suspended'
    });
    
    res.json({
      success: true,
      message: 'Company suspended successfully',
      companyId
    });
    
  } catch (error) {
    console.error('Suspend company error:', error);
    res.status(400).json({
      error: error.message || 'Failed to suspend company'
    });
  }
});

// Reactivate company
router.post('/companies/:companyId/reactivate', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const result = await companyService.updateCompany(companyId, {
      subscription_status: 'active'
    });
    
    res.json({
      success: true,
      message: 'Company reactivated successfully',
      companyId
    });
    
  } catch (error) {
    console.error('Reactivate company error:', error);
    res.status(400).json({
      error: error.message || 'Failed to reactivate company'
    });
  }
});

module.exports = router;