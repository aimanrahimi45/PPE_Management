const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/init');
const { generateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Validate user endpoint - check if user exists and get current data
router.get('/validate-user/:userId', async (req, res) => {
  try {
    const db = getDb();
    const userId = req.params.userId;
    
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, name, email, role FROM users WHERE id = ? AND active = 1', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('User validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// System status for customer onboarding (no auth required)
router.get('/system-status', async (req, res) => {
  try {
    const db = getDb();
    const licenseService = require('../services/licenseService');
    
    // Check if system has admin users
    const hasAdmin = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users WHERE role = "ADMIN" AND first_login_completed = 1', [], (err, row) => {
        if (err) resolve(false);
        else resolve(row.count > 0);
      });
    });
    
    // Check license status
    let licenseStatus = null;
    try {
      licenseStatus = await licenseService.getLicenseStatus();
    } catch (error) {
      licenseStatus = { status: 'invalid', message: 'No license found' };
    }
    
    res.json({
      success: true,
      system: {
        has_admin: hasAdmin,
        setup_completed: hasAdmin,
        license_status: licenseStatus?.status || 'invalid',
        requires_license: !licenseStatus || licenseStatus.status === 'invalid',
        ready_for_use: hasAdmin && licenseStatus && licenseStatus.status === 'active'
      }
    });
    
  } catch (error) {
    console.error('System status error:', error);
    res.json({
      success: true,
      system: {
        has_admin: false,
        setup_completed: false,
        license_status: 'invalid',
        requires_license: true,
        ready_for_use: false
      }
    });
  }
});

// Get available companies for login
router.get('/companies', async (req, res) => {
  const db = getDb();
  
  try {
    const companies = await new Promise((resolve, reject) => {
      db.all('SELECT id, name FROM companies WHERE subscription_status = "active" ORDER BY name', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    res.json({ success: true, companies });
    
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Failed to get companies' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user (simplified for single-tenant)
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    console.log('Login attempt for:', email);
    console.log('User found:', user ? 'Yes' : 'No');
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Secure password verification only
    if (!user.password) {
      return res.status(401).json({ error: 'Account setup incomplete' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Register (for admin use)
router.post('/register', async (req, res) => {
  const db = getDb();
  const { name, email, password, role = 'STAFF', department } = req.body;
  
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    
    // Check if user exists
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    // Create user
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO users (id, name, email, password, role, department)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [userId, name, email, hashedPassword, role, department], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ 
      success: true, 
      userId,
      message: 'User registered successfully' 
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get current user profile
router.get('/profile', async (req, res) => {
  const db = getDb();
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    // For demo, return mock user
    res.json({
      id: 'user-1',
      name: 'Demo User',
      email: 'demo@ppe.local',
      role: 'STAFF',
      department: 'Manufacturing'
    });
    
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;