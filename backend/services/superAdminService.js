const { getDb } = require('../database/init');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class SuperAdminService {
  
  /**
   * Create the first super admin account
   * @param {Object} adminData - Admin user data
   * @returns {Object} Created admin
   */
  async createSuperAdmin(adminData) {
    const db = getDb();
    const adminId = uuidv4();
    
    return new Promise(async (resolve, reject) => {
      try {
        const { username, email, password, name } = adminData;
        
        // Check if super admin already exists
        const existingAdmin = await this.getSuperAdminByEmail(email).catch(() => null);
        if (existingAdmin) {
          reject(new Error('Super admin already exists'));
          return;
        }
        
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        db.run(
          `INSERT INTO super_admins (id, username, email, password_hash, name)
           VALUES (?, ?, ?, ?, ?)`,
          [adminId, username, email, passwordHash, name],
          function(err) {
            if (err) {
              reject(err);
              return;
            }
            
            resolve({
              id: adminId,
              username,
              email,
              name,
              message: 'Super admin created successfully'
            });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Authenticate super admin login
   * @param {string} email - Admin email
   * @param {string} password - Admin password
   * @returns {Object} Login result with token
   */
  async login(email, password) {
    try {
      const admin = await this.getSuperAdminByEmail(email);
      if (!admin) {
        throw new Error('Invalid credentials');
      }
      
      if (!admin.is_active) {
        throw new Error('Account is deactivated');
      }
      
      const isValidPassword = await bcrypt.compare(password, admin.password_hash);
      if (!isValidPassword) {
        throw new Error('Invalid credentials');
      }
      
      // Update last login
      await this.updateLastLogin(admin.id);
      
      // Generate JWT token
      const token = jwt.sign(
        {
          id: admin.id,
          email: admin.email,
          role: 'SUPER_ADMIN',
          company_id: 'your-company'
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      return {
        success: true,
        token,
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: 'SUPER_ADMIN'
        }
      };
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Get super admin by email
   * @param {string} email - Admin email
   * @returns {Object} Admin data
   */
  async getSuperAdminByEmail(email) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM super_admins WHERE email = ?',
        [email],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (!row) {
            reject(new Error('Super admin not found'));
            return;
          }
          
          resolve(row);
        }
      );
    });
  }
  
  /**
   * Update last login timestamp
   * @param {string} adminId - Admin ID
   */
  async updateLastLogin(adminId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE super_admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [adminId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }
  
  /**
   * Get all super admins
   * @returns {Array} List of super admins
   */
  async getAllSuperAdmins() {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT id, username, email, name, is_active, created_at, last_login FROM super_admins ORDER BY created_at DESC',
        [],
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
   * Create initial super admin if none exists
   */
  async initializeSuperAdmin() {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as count FROM super_admins',
        [],
        async (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (row.count === 0) {
            // Create default super admin
            try {
              const defaultAdmin = await this.createSuperAdmin({
                username: 'admin',
                email: 'admin@ppemanagement.com',
                password: 'admin123',
                name: 'System Administrator'
              });
              
              console.log('🔑 Default super admin created:');
              console.log('   Email: admin@ppemanagement.com');
              console.log('   Password: admin123');
              console.log('   ⚠️  Please change these credentials immediately!');
              
              resolve(defaultAdmin);
            } catch (error) {
              reject(error);
            }
          } else {
            resolve({ message: 'Super admin already exists' });
          }
        }
      );
    });
  }
  
  /**
   * Change super admin password
   * @param {string} adminId - Admin ID
   * @param {string} newPassword - New password
   * @returns {Object} Update result
   */
  async changePassword(adminId, newPassword) {
    const db = getDb();
    
    return new Promise(async (resolve, reject) => {
      try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        db.run(
          'UPDATE super_admins SET password_hash = ? WHERE id = ?',
          [passwordHash, adminId],
          function(err) {
            if (err) {
              reject(err);
              return;
            }
            
            if (this.changes === 0) {
              reject(new Error('Super admin not found'));
              return;
            }
            
            resolve({
              success: true,
              message: 'Password updated successfully'
            });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Deactivate super admin
   * @param {string} adminId - Admin ID
   * @returns {Object} Update result
   */
  async deactivateSuperAdmin(adminId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE super_admins SET is_active = 0 WHERE id = ?',
        [adminId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes === 0) {
            reject(new Error('Super admin not found'));
            return;
          }
          
          resolve({
            success: true,
            message: 'Super admin deactivated successfully'
          });
        }
      );
    });
  }
}

module.exports = new SuperAdminService();