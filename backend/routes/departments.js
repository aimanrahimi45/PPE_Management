const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { authenticateToken } = require('../middleware/auth');

// Get all active departments
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    
    db.all(`
      SELECT id, name, description, active, created_at, updated_at 
      FROM departments 
      WHERE active = 1 
      ORDER BY name ASC
    `, (err, rows) => {
      if (err) {
        console.error('Error fetching departments:', err);
        return res.status(500).json({ error: 'Failed to fetch departments' });
      }
      
      res.json({
        success: true,
        departments: rows || []
      });
    });
  } catch (error) {
    console.error('Departments fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all departments (including inactive) - Admin only
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    
    db.all(`
      SELECT id, name, description, active, created_at, updated_at 
      FROM departments 
      ORDER BY name ASC
    `, (err, rows) => {
      if (err) {
        console.error('Error fetching all departments:', err);
        return res.status(500).json({ error: 'Failed to fetch departments' });
      }
      
      res.json({
        success: true,
        departments: rows || []
      });
    });
  } catch (error) {
    console.error('All departments fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new department - Works with or without authentication (customer onboarding friendly)
router.post('/', async (req, res) => {
  try {
    console.log(`📋 Department creation request: ${req.method} ${req.originalUrl}`);
    
    // Skip authentication entirely for now - customer distribution friendly
    // TODO: Add authentication back when license system is fully set up

    const { name, description } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Department name is required' });
    }
    
    const db = getDb();
    const departmentId = uuidv4();
    const cleanName = name.trim().toLowerCase();
    const displayName = name.trim();
    
    // Check if department already exists
    db.get(`
      SELECT id FROM departments 
      WHERE LOWER(name) = ? OR id = ?
    `, [cleanName, cleanName], (err, existingDept) => {
      if (err) {
        console.error('Error checking existing department:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingDept) {
        return res.status(400).json({ error: 'Department already exists' });
      }
      
      // Insert new department
      db.run(`
        INSERT INTO departments (id, name, description, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [cleanName, displayName, description || null], function(err) {
        if (err) {
          console.error('Error creating department:', err);
          return res.status(500).json({ error: 'Failed to create department' });
        }
        
        res.json({
          success: true,
          message: 'Department created successfully',
          department: {
            id: cleanName,
            name: displayName,
            description: description || null,
            active: true,
            created_at: new Date().toISOString()
          }
        });
      });
    });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update department - Admin only
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Department name is required' });
    }
    
    const db = getDb();
    const displayName = name.trim();
    
    // Check if department exists
    db.get(`SELECT id FROM departments WHERE id = ?`, [id], (err, dept) => {
      if (err) {
        console.error('Error checking department:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!dept) {
        return res.status(404).json({ error: 'Department not found' });
      }
      
      // Check if new name conflicts with existing department (if name changed)
      db.get(`
        SELECT id FROM departments 
        WHERE LOWER(name) = ? AND id != ?
      `, [displayName.toLowerCase(), id], (err, existingDept) => {
        if (err) {
          console.error('Error checking name conflict:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (existingDept) {
          return res.status(400).json({ error: 'Department name already exists' });
        }
        
        // Update department
        db.run(`
          UPDATE departments 
          SET name = ?, description = ?, active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [displayName, description || null, active !== undefined ? active : 1, id], function(err) {
          if (err) {
            console.error('Error updating department:', err);
            return res.status(500).json({ error: 'Failed to update department' });
          }
          
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Department not found' });
          }
          
          res.json({
            success: true,
            message: 'Department updated successfully',
            department: {
              id: id,
              name: displayName,
              description: description || null,
              active: active !== undefined ? active : 1
            }
          });
        });
      });
    });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deactivate department (soft delete) - Admin only
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    
    // Check if department exists and is active
    db.get(`SELECT id, name FROM departments WHERE id = ? AND active = 1`, [id], (err, dept) => {
      if (err) {
        console.error('Error checking department:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!dept) {
        return res.status(404).json({ error: 'Department not found or already inactive' });
      }
      
      // Check if department is being used by staff
      db.get(`
        SELECT COUNT(*) as count FROM staff_directory 
        WHERE department = ? AND active = 1
      `, [dept.name], (err, result) => {
        if (err) {
          console.error('Error checking department usage:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        if (result.count > 0) {
          return res.status(400).json({ 
            error: `Cannot deactivate department "${dept.name}" - it is assigned to ${result.count} active staff member(s)`,
            staff_count: result.count
          });
        }
        
        // Deactivate department
        db.run(`
          UPDATE departments 
          SET active = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [id], function(err) {
          if (err) {
            console.error('Error deactivating department:', err);
            return res.status(500).json({ error: 'Failed to deactivate department' });
          }
          
          res.json({
            success: true,
            message: `Department "${dept.name}" deactivated successfully`
          });
        });
      });
    });
  } catch (error) {
    console.error('Deactivate department error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;