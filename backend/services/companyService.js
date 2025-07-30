const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');

class CompanyService {
  
  /**
   * Create a new company/tenant
   * @param {Object} companyData - Company information
   * @returns {Object} Created company
   */
  async createCompany(companyData) {
    const db = getDb();
    const companyId = uuidv4();
    
    return new Promise((resolve, reject) => {
      const {
        name,
        email,
        phone,
        address,
        contactPerson,
        subscriptionTier = 'basic',
        maxEmployees = 100
      } = companyData;
      
      db.run(
        `INSERT INTO companies (id, name, email, phone, address, contact_person, subscription_tier, max_employees)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [companyId, name, email, phone, address, contactPerson, subscriptionTier, maxEmployees],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          // Initialize default feature flags based on subscription tier
          this.initializeFeatureFlags(companyId, subscriptionTier)
            .then(() => {
              resolve({
                id: companyId,
                name,
                email,
                phone,
                address,
                contactPerson,
                subscriptionTier,
                maxEmployees,
                message: 'Company created successfully'
              });
            })
            .catch(reject);
        }.bind(this)
      );
    });
  }
  
  /**
   * Get all companies
   * @returns {Array} List of companies
   */
  async getAllCompanies() {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT c.*, 
                COUNT(sd.id) as employee_count,
                (SELECT COUNT(*) FROM feature_flags ff WHERE ff.company_id = c.id AND ff.is_enabled = 1) as enabled_features
         FROM companies c
         LEFT JOIN staff_directory sd ON c.id = sd.company_id AND sd.active = 1
         GROUP BY c.id
         ORDER BY c.created_at DESC`,
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
   * Get company by ID
   * @param {string} companyId - Company ID
   * @returns {Object} Company data
   */
  async getCompanyById(companyId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT c.*, 
                COUNT(sd.id) as employee_count
         FROM companies c
         LEFT JOIN staff_directory sd ON c.id = sd.company_id AND sd.active = 1
         WHERE c.id = ?
         GROUP BY c.id`,
        [companyId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row);
        }
      );
    });
  }
  
  /**
   * Update company information
   * @param {string} companyId - Company ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Update result
   */
  async updateCompany(companyId, updateData) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      const {
        name,
        email,
        phone,
        address,
        contactPerson,
        subscriptionTier,
        subscriptionStatus,
        maxEmployees
      } = updateData;
      
      db.run(
        `UPDATE companies 
         SET name = ?, email = ?, phone = ?, address = ?, contact_person = ?, 
             subscription_tier = ?, subscription_status = ?, max_employees = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, email, phone, address, contactPerson, subscriptionTier, subscriptionStatus, maxEmployees, companyId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes === 0) {
            reject(new Error('Company not found'));
            return;
          }
          
          resolve({
            success: true,
            message: 'Company updated successfully',
            changes: this.changes
          });
        }
      );
    });
  }
  
  /**
   * Delete company and all associated data
   * @param {string} companyId - Company ID
   * @returns {Object} Delete result
   */
  async deleteCompany(companyId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      // Start transaction
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Delete all related data
        const tables = [
          'feature_flags',
          'staff_directory',
          'ppe_items',
          'ppe_requests',
          'inventory_transactions',
          'approval_queue',
          'audit_logs'
        ];
        
        let completed = 0;
        let hasError = false;
        
        tables.forEach(table => {
          db.run(`DELETE FROM ${table} WHERE company_id = ?`, [companyId], (err) => {
            if (err && !hasError) {
              hasError = true;
              db.run('ROLLBACK');
              reject(err);
              return;
            }
            
            completed++;
            if (completed === tables.length && !hasError) {
              // Finally delete the company
              db.run('DELETE FROM companies WHERE id = ?', [companyId], (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }
                
                db.run('COMMIT');
                resolve({
                  success: true,
                  message: 'Company and all associated data deleted successfully'
                });
              });
            }
          });
        });
      });
    });
  }
  
  /**
   * Initialize feature flags for a company based on subscription tier
   * @param {string} companyId - Company ID
   * @param {string} subscriptionTier - Subscription tier
   * @returns {Promise} Promise that resolves when features are initialized
   */
  async initializeFeatureFlags(companyId, subscriptionTier) {
    const db = getDb();
    
    const featuresByTier = {
      basic: [
        'basic_ppe_management',
        'staff_management',
        'basic_inventory',
        'email_notifications'
      ],
      pro: [
        'basic_ppe_management',
        'staff_management',
        'basic_inventory',
        'email_notifications',
        'advanced_reports',
        'analytics_dashboard',
        'export_reports',
        'usage_trends',
        'compliance_tracking',
        'cost_management',
        'unlimited_employees'
      ],
      enterprise: [
        'basic_ppe_management',
        'staff_management',
        'basic_inventory',
        'email_notifications',
        'advanced_reports',
        'analytics_dashboard',
        'export_reports',
        'usage_trends',
        'compliance_tracking',
        'cost_management',
        'unlimited_employees',
        'multi_location',
        'api_access',
        'custom_integrations',
        'white_label',
        'priority_support',
        'bulk_operations'
      ]
    };
    
    const features = featuresByTier[subscriptionTier] || featuresByTier.basic;
    
    return new Promise((resolve, reject) => {
      let completed = 0;
      let hasError = false;
      
      features.forEach(feature => {
        db.run(
          `INSERT OR REPLACE INTO feature_flags (company_id, feature_name, is_enabled, enabled_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [companyId, feature, true],
          (err) => {
            if (err && !hasError) {
              hasError = true;
              reject(err);
              return;
            }
            
            completed++;
            if (completed === features.length && !hasError) {
              resolve();
            }
          }
        );
      });
      
      if (features.length === 0) {
        resolve();
      }
    });
  }
  
  /**
   * Get company statistics
   * @returns {Object} System statistics
   */
  async getSystemStats() {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          COUNT(DISTINCT c.id) as total_companies,
          COUNT(DISTINCT CASE WHEN c.subscription_status = 'active' THEN c.id END) as active_companies,
          COUNT(DISTINCT CASE WHEN c.subscription_status = 'trial' THEN c.id END) as trial_companies,
          COUNT(DISTINCT sd.id) as total_employees,
          COUNT(DISTINCT pr.id) as total_ppe_requests
         FROM companies c
         LEFT JOIN staff_directory sd ON c.id = sd.company_id AND sd.active = 1
         LEFT JOIN ppe_requests pr ON c.id = pr.company_id`,
        [],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || {});
        }
      );
    });
  }
}

module.exports = new CompanyService();