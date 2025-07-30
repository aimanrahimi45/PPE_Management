const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate super admin requests
 */
function authenticateSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }
    
    const token = authHeader.substring(7);
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
      if (err) {
        return res.status(401).json({
          error: 'Invalid token',
          message: 'Authentication token is invalid or expired'
        });
      }
      
      // Check if user has super admin role
      if (decoded.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Super admin access required'
        });
      }
      
      req.user = decoded;
      next();
    });
    
  } catch (error) {
    console.error('Super admin auth error:', error);
    res.status(500).json({
      error: 'Authentication error',
      message: 'Unable to verify authentication'
    });
  }
}

module.exports = { authenticateSuperAdmin };