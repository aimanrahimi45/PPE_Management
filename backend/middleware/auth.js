const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      name: user.name,
      role: user.role,
      company_id: user.company_id || 'your-company'
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Middleware to ensure company isolation
const requireCompanyAccess = (req, res, next) => {
  const userCompanyId = req.user?.company_id;
  
  if (!userCompanyId) {
    return res.status(403).json({ error: 'Company access required' });
  }
  
  // Add company filter to queries automatically
  req.companyId = userCompanyId;
  next();
};

// Combined middleware for authentication + company isolation
const authenticateWithCompany = (req, res, next) => {
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    requireCompanyAccess(req, res, next);
  });
};

module.exports = { 
  authenticateToken, 
  generateToken, 
  requireCompanyAccess,
  authenticateWithCompany 
};