const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Generate secure recovery key (16 characters in XXXX-XXXX-XXXX-XXXX format)
function generateRecoveryKey() {
  return crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
}

// Generate password reset token
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Check if setup is required
router.get('/required', async (req, res) => {
  const db = getDb();
  
  try {
    const adminExists = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND first_login_completed = 1 LIMIT 1`, 
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    res.json({ 
      setupRequired: !adminExists,
      hasAdmin: !!adminExists 
    });
  } catch (error) {
    console.error('Setup check error:', error);
    res.status(500).json({ error: 'Setup check failed' });
  }
});

// Complete initial setup
router.post('/complete', async (req, res) => {
  const { adminName, adminEmail, adminPassword, companyName, securityQuestion, securityAnswer, businessTimezone, timezoneAutoDetected } = req.body;
  
  if (!adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Admin name, email, and password are required' });
  }

  if (!businessTimezone) {
    return res.status(400).json({ error: 'Business timezone is required' });
  }

  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();
  
  try {
    // Check if setup already completed
    const existingAdmin = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND first_login_completed = 1`, 
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existingAdmin) {
      return res.status(400).json({ error: 'Setup already completed' });
    }

    // Hash password and security answer
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    const hashedSecurityAnswer = securityAnswer ? await bcrypt.hash(securityAnswer.toLowerCase().trim(), 10) : null;
    
    // Generate recovery key
    const recoveryKey = generateRecoveryKey();
    
    // Create/update admin user
    const adminId = uuidv4();
    await new Promise((resolve, reject) => {
      db.run(`INSERT OR REPLACE INTO users 
              (id, name, email, password, role, active, first_login_completed, setup_completed_at, recovery_key, security_question, security_answer, business_timezone, timezone_auto_detected) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [adminId, adminName, adminEmail, hashedPassword, 'ADMIN', 1, 1, new Date().toISOString(), recoveryKey, securityQuestion, hashedSecurityAnswer, businessTimezone, timezoneAutoDetected ? 1 : 0],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update company name if provided
    if (companyName) {
      await new Promise((resolve, reject) => {
        db.run(`UPDATE email_config SET company_name = ? WHERE id = '1'`,
          [companyName],
          (err) => {
            if (err) console.warn('Could not update company name:', err);
            resolve();
          }
        );
      });
    }

    res.json({ 
      success: true, 
      message: 'Setup completed successfully',
      adminEmail: adminEmail,
      recoveryKey: recoveryKey,
      setupInfo: {
        adminCreated: true,
        companyNameSet: !!companyName,
        securityQuestionSet: !!securityQuestion
      }
    });

  } catch (error) {
    console.error('Setup completion error:', error);
    res.status(500).json({ error: 'Setup failed: ' + error.message });
  }
});

// Password reset request
router.post('/reset-request', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const db = getDb();
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({ 
        success: true, 
        message: 'If the email exists, recovery instructions will be provided' 
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?`,
        [resetToken, expiresAt.toISOString(), user.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Password reset token generated',
      resetToken: resetToken, // In production, this would be sent via email
      expiresIn: '1 hour',
      recoveryMethods: {
        token: true,
        recoveryKey: !!user.recovery_key,
        securityQuestion: !!user.security_question
      }
    });

  } catch (error) {
    console.error('Reset request error:', error);
    res.status(500).json({ error: 'Reset request failed' });
  }
});

// Reset password with token
router.post('/reset-with-token', async (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE password_reset_token = ? AND password_reset_expires > ? AND active = 1`,
        [token, new Date().toISOString()],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password and clear reset token
    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL, updated_at = ? WHERE id = ?`,
        [hashedPassword, new Date().toISOString(), user.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Password reset successfully',
      email: user.email
    });

  } catch (error) {
    console.error('Token reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Reset password with recovery key
router.post('/reset-with-recovery-key', async (req, res) => {
  const { recoveryKey, newPassword } = req.body;
  
  if (!recoveryKey || !newPassword) {
    return res.status(400).json({ error: 'Recovery key and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE recovery_key = ? AND recovery_key_used = 0 AND active = 1`,
        [recoveryKey.replace(/\s+/g, '').toUpperCase()],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or already used recovery key' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password and mark recovery key as used
    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET password = ?, recovery_key_used = 1, updated_at = ? WHERE id = ?`,
        [hashedPassword, new Date().toISOString(), user.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Password reset successfully using recovery key',
      email: user.email,
      warning: 'Recovery key has been used and is no longer valid'
    });

  } catch (error) {
    console.error('Recovery key reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Reset password with security question
router.post('/reset-with-security-question', async (req, res) => {
  const { email, securityAnswer, newPassword } = req.body;
  
  if (!email || !securityAnswer || !newPassword) {
    return res.status(400).json({ error: 'Email, security answer, and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE email = ? AND security_question IS NOT NULL AND security_answer IS NOT NULL AND active = 1`,
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(400).json({ error: 'No security question set for this email' });
    }

    // Verify security answer
    const validAnswer = await bcrypt.compare(securityAnswer.toLowerCase().trim(), user.security_answer);
    
    if (!validAnswer) {
      return res.status(400).json({ error: 'Incorrect security answer' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`,
        [hashedPassword, new Date().toISOString(), user.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Password reset successfully using security question',
      email: user.email
    });

  } catch (error) {
    console.error('Security question reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Get security question for email
router.post('/get-security-question', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const db = getDb();
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(`SELECT security_question FROM users WHERE email = ? AND security_question IS NOT NULL AND active = 1`,
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user || !user.security_question) {
      return res.status(404).json({ error: 'No security question found for this email' });
    }

    res.json({ 
      success: true, 
      securityQuestion: user.security_question
    });

  } catch (error) {
    console.error('Get security question error:', error);
    res.status(500).json({ error: 'Failed to get security question' });
  }
});

// Generate new recovery key (for admin use)
router.post('/generate-new-recovery-key', async (req, res) => {
  const { adminPassword } = req.body;
  
  if (!adminPassword) {
    return res.status(400).json({ error: 'Admin password required' });
  }

  const db = getDb();
  
  try {
    // Get admin user
    const admin = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND active = 1 LIMIT 1`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!admin) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    // Verify admin password
    const validPassword = await bcrypt.compare(adminPassword, admin.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }

    // Generate new recovery key
    const newRecoveryKey = generateRecoveryKey();

    // Update recovery key
    await new Promise((resolve, reject) => {
      db.run(`UPDATE users SET recovery_key = ?, recovery_key_used = 0, updated_at = ? WHERE id = ?`,
        [newRecoveryKey, new Date().toISOString(), admin.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'New recovery key generated',
      recoveryKey: newRecoveryKey,
      warning: 'Previous recovery key is no longer valid'
    });

  } catch (error) {
    console.error('Generate recovery key error:', error);
    res.status(500).json({ error: 'Failed to generate new recovery key' });
  }
});

module.exports = router;