const express = require('express');
const { checkFeatureAccess, TIER_PRICING, FEATURE_DEFINITIONS } = require('../middleware/featureFlag');

const router = express.Router();

// Demo route to show Basic tier feature
router.get('/basic-demo', checkFeatureAccess('basic_ppe_management'), async (req, res) => {
  res.json({
    message: 'Welcome to Basic PPE Management!',
    tier: 'basic',
    price: 'RM 49/month',
    feature: 'Basic PPE request and approval functionality'
  });
});

// Demo route to show Pro tier feature
router.get('/pro-demo', checkFeatureAccess('advanced_reports'), async (req, res) => {
  res.json({
    message: 'Welcome to Pro Advanced Reports!',
    tier: 'pro', 
    price: 'RM 89/month',
    feature: 'Advanced analytics and reporting dashboard'
  });
});

// Demo route to show Enterprise tier feature (Available)
router.get('/enterprise-demo', checkFeatureAccess('api_access'), async (req, res) => {
  res.json({
    message: 'Welcome to Enterprise API Access!',
    tier: 'enterprise',
    price: 'RM 149/month',
    feature: 'Full REST API access for integrations'
  });
});

// Demo route to show Enterprise tier feature (Coming Soon)
router.get('/enterprise-coming-soon', checkFeatureAccess('white_label'), async (req, res) => {
  res.json({
    message: 'This should show Coming Soon!',
    tier: 'enterprise',
    price: 'RM 149/month',
    feature: 'White label branding (Coming Soon)'
  });
});

// Show all tier pricing
router.get('/pricing', async (req, res) => {
  res.json({
    message: 'PPE Management Subscription Tiers',
    pricing: TIER_PRICING,
    features_by_tier: {
      basic: Object.keys(FEATURE_DEFINITIONS).filter(f => FEATURE_DEFINITIONS[f].tier === 'basic'),
      pro: Object.keys(FEATURE_DEFINITIONS).filter(f => FEATURE_DEFINITIONS[f].tier === 'pro'),
      enterprise: Object.keys(FEATURE_DEFINITIONS).filter(f => FEATURE_DEFINITIONS[f].tier === 'enterprise')
    }  
  });
});

module.exports = router;