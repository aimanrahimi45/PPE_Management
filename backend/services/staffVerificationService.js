const { getDb } = require('../database/init');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse');
const XLSX = require('xlsx');
const fs = require('fs');

class StaffVerificationService {
  
  /**
   * Verify if staff ID exists in the system
   * @param {string} staffId - Staff ID to verify
   * @returns {Object} Verification result with staff details
   */
  async verifyStaffId(staffId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM staff_directory WHERE staff_id = ? AND active = 1',
        [staffId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (row) {
            resolve({
              valid: true,
              staff: {
                id: row.id,
                staffId: row.staff_id,
                name: row.name,
                email: row.email,
                department: row.department,
                position: row.position
              }
            });
          } else {
            resolve({
              valid: false,
              message: 'Staff ID not found in directory. Please check your ID or contact HR.',
              staff: null
            });
          }
        }
      );
    });
  }

  /**
   * Add or update staff member in directory
   * @param {Object} staffData - Staff information
   * @returns {Object} Operation result
   */
  async addStaff(staffData) {
    const { staffId, name, email, department, position, companyId = 'your-company' } = staffData;
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      // Check if staff ID already exists
      db.get('SELECT id FROM staff_directory WHERE staff_id = ?', [staffId], (err, existing) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (existing) {
          // Update existing staff
          db.run(
            `UPDATE staff_directory 
             SET name = ?, email = ?, department = ?, position = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE staff_id = ?`,
            [name, email, department, position, staffId],
            function(err) {
              if (err) {
                reject(err);
                return;
              }
              resolve({
                success: true,
                action: 'updated',
                staffId,
                message: `Staff ${name} (${staffId}) updated successfully`
              });
            }
          );
        } else {
          // Insert new staff
          const id = uuidv4();
          db.run(
            `INSERT INTO staff_directory (id, staff_id, name, email, department, position) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, staffId, name, email, department, position],
            function(err) {
              if (err) {
                reject(err);
                return;
              }
              resolve({
                success: true,
                action: 'created',
                staffId,
                id,
                message: `Staff ${name} (${staffId}) added successfully`
              });
            }
          );
        }
      });
    });
  }

  /**
   * Import staff from Excel or CSV file
   * @param {string} filePath - Path to file
   * @returns {Object} Import results
   */
  async importStaffFromFile(filePath) {
    const fileExtension = filePath.toLowerCase().split('.').pop();
    
    console.log(`[DEBUG] File path: ${filePath}`);
    console.log(`[DEBUG] Detected extension: ${fileExtension}`);
    
    if (fileExtension === 'csv') {
      console.log('[DEBUG] Routing to CSV parser');
      return this.importStaffFromCSV(filePath);
    } else if (['xls', 'xlsx'].includes(fileExtension)) {
      console.log('[DEBUG] Routing to Excel parser');
      return this.importStaffFromExcel(filePath);
    } else {
      throw new Error('Unsupported file format. Please use CSV or Excel files.');
    }
  }

  /**
   * Import staff from Excel file
   * @param {string} filePath - Path to Excel file
   * @returns {Object} Import results
   */
  async importStaffFromExcel(filePath) {
    try {
      console.log(`[DEBUG] Reading Excel file: ${filePath}`);
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0]; // Use first sheet
      console.log(`[DEBUG] Sheet name: ${sheetName}`);
      
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      console.log(`[DEBUG] Parsed ${jsonData.length} rows from Excel`);
      
      // Debug: Show first row structure
      if (jsonData.length > 0) {
        console.log('[DEBUG] First row keys:', Object.keys(jsonData[0]));
        console.log('[DEBUG] First row data:', jsonData[0]);
      }
      
      const results = [];
      const errors = [];
      
      for (const row of jsonData) {
        try {
          // Flexible column mapping - accept common column names
          const staffId = row.staff_id || row.staffId || row['Staff ID'] || row.ID || row.id || row.STAFF_ID || row['STAFF ID'] || row['EMP NO'] || row.EMP_NO || row.empNo;
          const name = row.name || row.Name || row.fullName || row['Full Name'] || row.NAME || row.FULL_NAME || row['FULL NAME'];
          const email = row.email || row.Email || row['Email Address'] || row.EMAIL;
          const department = row.department || row.Department || row.dept || row.DEPARTMENT || row.DEPT;
          const position = row.position || row.Position || row.title || row.Title || row.POSITION || row.TITLE || row['JOB POSITION'] || row.JOB_POSITION || row.jobPosition;
          
          // Debug: Show what was extracted
          console.log(`[DEBUG] Row ${results.length + errors.length + 1}: staffId="${staffId}", name="${name}"`);
          
          // Validate required fields
          if (!staffId || !name) {
            errors.push({
              row: row,
              error: 'Missing required fields: staff_id and name'
            });
            console.log(`[DEBUG] Row rejected: missing staffId or name`);
            continue;
          }
          
          const staffData = {
            staffId: staffId.toString().trim(),
            name: name.toString().trim(),
            email: email ? email.toString().trim() : null,
            department: department ? department.toString().trim() : null,
            position: position ? position.toString().trim() : null
          };
          
          const result = await this.addStaff(staffData);
          results.push(result);
          
        } catch (error) {
          errors.push({
            row: row,
            error: error.message
          });
        }
      }
      
      return {
        success: true,
        totalProcessed: results.length + errors.length,
        successCount: results.length,
        errorCount: errors.length,
        results,
        errors
      };
      
    } catch (error) {
      throw new Error(`Excel import failed: ${error.message}`);
    }
  }

  /**
   * Import staff from CSV file
   * @param {string} filePath - Path to CSV file
   * @returns {Object} Import results
   */
  async importStaffFromCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      const errors = [];
      
      if (!fs.existsSync(filePath)) {
        reject(new Error('CSV file not found'));
        return;
      }
      
      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      
      parser.on('readable', async () => {
        let record;
        while (record = parser.read()) {
          try {
            // Validate required fields
            if (!record.staff_id || !record.name) {
              errors.push({
                row: record,
                error: 'Missing required fields: staff_id and name'
              });
              continue;
            }
            
            const staffData = {
              staffId: record.staff_id.toString().trim(),
              name: record.name.trim(),
              email: record.email ? record.email.trim() : null,
              department: record.department ? record.department.trim() : null,
              position: record.position ? record.position.trim() : null
            };
            
            const result = await this.addStaff(staffData);
            results.push(result);
            
          } catch (error) {
            errors.push({
              row: record,
              error: error.message
            });
          }
        }
      });
      
      parser.on('error', (err) => {
        reject(err);
      });
      
      parser.on('end', () => {
        resolve({
          success: true,
          totalProcessed: results.length + errors.length,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors
        });
      });
      
      fs.createReadStream(filePath).pipe(parser);
    });
  }

  /**
   * Get staff member by ID
   * @param {string} staffId - Staff ID
   * @param {string} companyId - Company ID for multi-tenant support
   * @returns {Object} Staff member
   */
  async getStaffById(staffId, companyId = 'your-company') {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM staff_directory WHERE staff_id = ?',
        [staffId],
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
   * Get all staff members
   * @param {Object} options - Query options
   * @returns {Array} Staff list
   */
  async getAllStaff(options = {}) {
    const { active = true, department = null, limit = 1000, companyId = 'your-company' } = options;
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM staff_directory WHERE 1=1';
      const params = [];
      
      if (active !== null) {
        query += ' AND active = ?';
        params.push(active ? 1 : 0);
      }
      
      if (department) {
        query += ' AND department = ?';
        params.push(department);
      }
      
      query += ' ORDER BY active DESC, name ASC LIMIT ?';
      params.push(limit);
      
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  /**
   * Get staff statistics
   * @returns {Object} Statistics
   */
  async getStaffStats() {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          COUNT(*) as total_staff,
          COUNT(CASE WHEN active = 1 THEN 1 END) as active_staff,
          COUNT(CASE WHEN active = 0 THEN 1 END) as inactive_staff,
          COUNT(DISTINCT department) as departments
        FROM staff_directory
      `, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows[0] || {});
      });
    });
  }

  /**
   * Deactivate staff member
   * @param {string} staffId - Staff ID to deactivate
   * @returns {Object} Operation result
   */
  async deactivateStaff(staffId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE staff_directory SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE staff_id = ?',
        [staffId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes > 0) {
            resolve({
              success: true,
              message: `Staff ${staffId} deactivated successfully`
            });
          } else {
            resolve({
              success: false,
              message: `Staff ${staffId} not found`
            });
          }
        }
      );
    });
  }

  /**
   * Update staff member
   * @param {string} staffId - Staff ID
   * @param {Object} updates - Updated information
   * @returns {Object} Update result
   */
  async updateStaff(staffId, updates) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      const { name, email, department, position } = updates;
      
      db.run(
        `UPDATE staff_directory 
         SET name = ?, email = ?, department = ?, position = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE staff_id = ?`,
        [name, email, department, position, staffId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes > 0) {
            resolve({
              success: true,
              message: `Staff ${staffId} updated successfully`
            });
          } else {
            resolve({
              success: false,
              message: `Staff ${staffId} not found`
            });
          }
        }
      );
    });
  }

  /**
   * Reactivate staff member
   * @param {string} staffId - Staff ID
   * @returns {Object} Reactivation result
   */
  async reactivateStaff(staffId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE staff_directory SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE staff_id = ?',
        [staffId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          
          if (this.changes > 0) {
            resolve({
              success: true,
              message: `Staff ${staffId} reactivated successfully`
            });
          } else {
            resolve({
              success: false,
              message: `Staff ${staffId} not found`
            });
          }
        }
      );
    });
  }

  /**
   * Get staff statistics
   * @param {string} companyId - Company ID for multi-tenant support
   * @returns {Object} Statistics
   */
  async getStaffStats(companyId = 'your-company') {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive,
          COUNT(DISTINCT department) as departments
         FROM staff_directory`,
        [],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || { total: 0, active: 0, inactive: 0, departments: 0 });
        }
      );
    });
  }

  /**
   * Search staff by name or ID
   * @param {string} searchTerm - Search term
   * @returns {Array} Matching staff
   */
  async searchStaff(searchTerm) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM staff_directory 
         WHERE (staff_id LIKE ? OR name LIKE ?) AND active = 1 
         ORDER BY name ASC LIMIT 50`,
        [`%${searchTerm}%`, `%${searchTerm}%`],
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
   * Permanently delete staff member from the system
   * @param {string} staffId - Staff ID to delete permanently
   * @returns {Object} Deletion result
   */
  async permanentDeleteStaff(staffId) {
    const db = getDb();
    
    return new Promise((resolve, reject) => {
      // First check if staff exists and get their details
      db.get(
        'SELECT * FROM staff_directory WHERE staff_id = ?',
        [staffId],
        (err, staff) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (!staff) {
            resolve({
              success: false,
              message: `Staff ${staffId} not found`
            });
            return;
          }
          
          // Check if staff is active (only allow deletion of inactive staff for safety)
          if (staff.active === 1) {
            resolve({
              success: false,
              message: `Cannot delete active staff. Please deactivate ${staffId} first.`
            });
            return;
          }
          
          // Proceed with deletion
          db.run(
            'DELETE FROM staff_directory WHERE staff_id = ?',
            [staffId],
            function(deleteErr) {
              if (deleteErr) {
                reject(deleteErr);
                return;
              }
              
              if (this.changes > 0) {
                console.log(`Staff ${staffId} (${staff.name}) permanently deleted from system`);
                resolve({
                  success: true,
                  message: `Staff ${staffId} permanently deleted from system`,
                  deletedStaff: {
                    staff_id: staff.staff_id,
                    name: staff.name,
                    department: staff.department,
                    position: staff.position
                  }
                });
              } else {
                resolve({
                  success: false,
                  message: `Failed to delete staff ${staffId}`
                });
              }
            }
          );
        }
      );
    });
  }
}

module.exports = new StaffVerificationService();