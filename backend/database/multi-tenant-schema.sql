-- Multi-Tenant Database Schema for PPE Management System
-- This extends the existing database with multi-tenancy support

-- Companies/Tenants table
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    contact_person TEXT,
    subscription_tier TEXT DEFAULT 'basic', -- basic, pro, enterprise
    subscription_status TEXT DEFAULT 'active', -- active, trial, suspended, cancelled
    trial_start_date DATETIME,
    trial_end_date DATETIME,
    billing_cycle TEXT DEFAULT 'monthly', -- monthly, annual
    max_employees INTEGER DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Feature flags table
CREATE TABLE IF NOT EXISTS feature_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT FALSE,
    enabled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(company_id, feature_name)
);

-- Super admin users table
CREATE TABLE IF NOT EXISTS super_admins (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
);

-- Update existing tables to include company_id
-- Add company_id to staff_directory
ALTER TABLE staff_directory ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Add company_id to ppe_items
ALTER TABLE ppe_items ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Add company_id to ppe_requests
ALTER TABLE ppe_requests ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Add company_id to inventory_transactions
ALTER TABLE inventory_transactions ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Add company_id to approval_queue
ALTER TABLE approval_queue ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Add company_id to audit_logs
ALTER TABLE audit_logs ADD COLUMN company_id TEXT DEFAULT 'your-company';

-- Pre-defined feature list
INSERT OR IGNORE INTO feature_flags (company_id, feature_name, is_enabled) VALUES
-- Basic plan features (always enabled)
('your-company', 'basic_ppe_management', TRUE),
('your-company', 'staff_management', TRUE),
('your-company', 'basic_inventory', TRUE),
('your-company', 'email_notifications', TRUE),

-- Pro plan features
('your-company', 'advanced_reports', TRUE),
('your-company', 'analytics_dashboard', TRUE),
('your-company', 'export_reports', TRUE),
('your-company', 'usage_trends', TRUE),
('your-company', 'compliance_tracking', TRUE),
('your-company', 'cost_management', TRUE),
('your-company', 'unlimited_employees', TRUE),

-- Enterprise plan features
('your-company', 'multi_location', TRUE),
('your-company', 'api_access', TRUE),
('your-company', 'custom_integrations', TRUE),
('your-company', 'white_label', TRUE),
('your-company', 'priority_support', TRUE),
('your-company', 'bulk_operations', TRUE);

-- Insert your company as the first tenant
INSERT OR IGNORE INTO companies (id, name, email, subscription_tier, subscription_status, max_employees, contact_person) VALUES
('your-company', 'Your Company Name', 'your-email@company.com', 'enterprise', 'active', 9999, 'Aiman');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_companies_subscription ON companies(subscription_tier, subscription_status);
CREATE INDEX IF NOT EXISTS idx_feature_flags_company ON feature_flags(company_id);
CREATE INDEX IF NOT EXISTS idx_staff_directory_company ON staff_directory(company_id);
CREATE INDEX IF NOT EXISTS idx_ppe_items_company ON ppe_items(company_id);
CREATE INDEX IF NOT EXISTS idx_ppe_requests_company ON ppe_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_company ON inventory_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_queue_company ON approval_queue(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id);