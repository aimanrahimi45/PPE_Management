const { getDb } = require('../database/init');

const checkSetupRequired = async (req, res, next) => {
  // Skip setup check for setup endpoints, license endpoints, and static files
  if (req.path.startsWith('/api/setup') || 
      req.path.startsWith('/api/license') ||
      req.path.startsWith('/api/features') ||
      req.path.startsWith('/api/dashboard') ||
      req.path.startsWith('/api/approval') ||
      req.path === '/setup.html' || 
      req.path === '/password-reset.html' ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/images/') ||
      req.path.startsWith('/uploads/') ||
      req.path.endsWith('.css') ||
      req.path.endsWith('.js') ||
      req.path.endsWith('.png') ||
      req.path.endsWith('.jpg') ||
      req.path.endsWith('.ico')) {
    return next();
  }

  const db = getDb();
  
  // Check if database is ready
  if (!db) {
    console.log('⚠️ Database not ready, redirecting to setup');
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.redirect('/setup.html');
    }
    return res.status(403).json({ 
      setupRequired: true, 
      message: 'Database initializing, please wait',
      redirectUrl: '/setup.html'
    });
  }
  
  try {
    const adminExists = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND first_login_completed = 1 LIMIT 1`, 
        (err, row) => {
          if (err) {
            // If column doesn't exist yet, assume setup is required
            if (err.message.includes('no such column') || err.message.includes('no such table')) {
              console.log('⚠️ Database schema not ready, setup required');
              resolve(null);
            } else {
              reject(err);
            }
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!adminExists) {
      // For HTML requests, redirect to setup page
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/setup.html');
      }
      
      // For API requests, return JSON
      return res.status(403).json({ 
        setupRequired: true, 
        message: 'Initial setup required',
        redirectUrl: '/setup.html'
      });
    }

    next();
  } catch (error) {
    console.error('Setup check error:', error);
    
    // If it's a database schema error, redirect to setup
    if (error.message.includes('no such column') || error.message.includes('no such table')) {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/setup.html');
      }
      return res.status(403).json({ 
        setupRequired: true, 
        message: 'Database setup required',
        redirectUrl: '/setup.html'
      });
    }
    
    res.status(500).json({ error: 'Setup check failed' });
  }
};

module.exports = { checkSetupRequired };