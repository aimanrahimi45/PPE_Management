-- =====================================================
-- PPE Management Multi-Tenant Database Schema
-- Migration 001: Create Companies Master Table
-- =====================================================

-- Companies master table (tenant registry)
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,                    -- Unique company ID (e.g., ABCMAN1234)
    company_name TEXT NOT NULL,             -- Full company name
    company_email TEXT UNIQUE,              -- Primary contact email
    company_phone TEXT,                     -- Contact phone
    company_address TEXT,                   -- Physical address
    
    -- Business details
    business_registration TEXT,             -- Business registration number
    industry TEXT,                          -- Industry type
    company_size TEXT CHECK(company_size IN ('small', 'medium', 'large', 'enterprise')),
    
    -- Subscription & licensing
    subscription_tier TEXT NOT NULL DEFAULT 'basic' 
        CHECK(subscription_tier IN ('basic', 'pro', 'enterprise')),
    subscription_status TEXT NOT NULL DEFAULT 'active' 
        CHECK(subscription_status IN ('active', 'suspended', 'cancelled', 'trial')),
    license_key TEXT UNIQUE,                -- License file content/key
    license_expires_at DATETIME,            -- License expiration
    
    -- Billing
    billing_email TEXT,                     -- Billing contact
    billing_address TEXT,                   -- Billing address
    billing_cycle TEXT DEFAULT 'monthly' 
        CHECK(billing_cycle IN ('monthly', 'yearly')),
    next_billing_date DATETIME,             -- Next billing date
    
    -- System settings
    timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',  -- Company timezone
    currency TEXT DEFAULT 'MYR',               -- Preferred currency
    date_format TEXT DEFAULT 'DD/MM/YYYY',     -- Date display format
    language TEXT DEFAULT 'en',                -- Primary language
    
    -- Status & tracking
    is_active BOOLEAN DEFAULT 1,            -- Company active status
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,                        -- Who created this company
    
    -- Metadata
    settings JSON,                          -- Company-specific settings
    notes TEXT                              -- Admin notes
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_companies_subscription ON companies(subscription_tier, subscription_status);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active);
CREATE INDEX IF NOT EXISTS idx_companies_created ON companies(created_at);
CREATE INDEX IF NOT EXISTS idx_companies_license ON companies(license_expires_at);

-- Company administrators table
CREATE TABLE IF NOT EXISTS company_admins (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    company_id TEXT NOT NULL,               -- Reference to companies.id
    
    -- Admin details
    username TEXT NOT NULL,                 -- Admin username
    email TEXT NOT NULL,                    -- Admin email
    full_name TEXT NOT NULL,               -- Full name
    phone TEXT,                            -- Contact phone
    
    -- Authentication
    password_hash TEXT NOT NULL,            -- Hashed password
    last_login DATETIME,                   -- Last login time
    login_attempts INTEGER DEFAULT 0,      -- Failed login attempts
    account_locked_until DATETIME,         -- Account lock expiry
    
    -- Permissions & roles
    role TEXT NOT NULL DEFAULT 'admin' 
        CHECK(role IN ('super_admin', 'admin', 'manager', 'viewer')),
    permissions JSON,                       -- Specific permissions
    
    -- Settings
    timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',
    language TEXT DEFAULT 'en',
    email_notifications BOOLEAN DEFAULT 1,
    
    -- Status & tracking
    is_active BOOLEAN DEFAULT 1,
    email_verified BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,                        -- Who created this admin
    
    -- Security
    api_key TEXT UNIQUE,                    -- API access key
    api_key_expires_at DATETIME,           -- API key expiration
    two_factor_enabled BOOLEAN DEFAULT 0,  -- 2FA status
    recovery_codes JSON,                    -- 2FA recovery codes
    
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Create indexes for company_admins
CREATE INDEX IF NOT EXISTS idx_company_admins_company ON company_admins(company_id);
CREATE INDEX IF NOT EXISTS idx_company_admins_email ON company_admins(email);
CREATE INDEX IF NOT EXISTS idx_company_admins_username ON company_admins(company_id, username);
CREATE INDEX IF NOT EXISTS idx_company_admins_active ON company_admins(is_active);

-- Create unique constraint for username within company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_admins_unique_username 
    ON company_admins(company_id, username) WHERE is_active = 1;

-- Create unique constraint for email within company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_admins_unique_email 
    ON company_admins(company_id, email) WHERE is_active = 1;

-- Feature flags table for company-specific features
CREATE TABLE IF NOT EXISTS feature_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL,               -- Reference to companies.id
    feature_name TEXT NOT NULL,             -- Feature identifier
    is_enabled BOOLEAN NOT NULL DEFAULT 0, -- Feature enabled status
    enabled_at DATETIME,                    -- When feature was enabled
    enabled_by TEXT,                        -- Who enabled the feature
    notes TEXT,                            -- Admin notes about feature
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(company_id, feature_name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Create indexes for feature_flags
CREATE INDEX IF NOT EXISTS idx_feature_flags_company ON feature_flags(company_id);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);
CREATE INDEX IF NOT EXISTS idx_feature_flags_feature ON feature_flags(feature_name);

-- =====================================================
-- Default company for existing data migration
-- =====================================================

-- Insert default company for existing system data
INSERT OR IGNORE INTO companies (
    id, 
    company_name, 
    company_email, 
    subscription_tier, 
    subscription_status,
    created_by,
    notes
) VALUES (
    'DEFAULT0001', 
    'Default Company (Migration)', 
    'admin@example.com', 
    'pro', 
    'active',
    'SYSTEM_MIGRATION',
    'Default company created during multi-tenant migration. All existing data is assigned to this company.'
);

-- Insert default admin for the default company
INSERT OR IGNORE INTO company_admins (
    id,
    company_id, 
    username, 
    email, 
    full_name, 
    password_hash,
    role,
    created_by,
    email_verified
) VALUES (
    'admin_default_001',
    'DEFAULT0001', 
    'admin', 
    'admin@example.com', 
    'System Administrator', 
    '$2b$10$dummy.hash.for.migration.only', -- Will be updated during first login
    'super_admin',
    'SYSTEM_MIGRATION',
    1
);

-- Enable all basic features for default company
INSERT OR IGNORE INTO feature_flags (company_id, feature_name, is_enabled, enabled_at, enabled_by) VALUES
    ('DEFAULT0001', 'basic_ppe_management', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'staff_management', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'basic_inventory', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'email_notifications', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'basic_station_management', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'advanced_reports', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'analytics_dashboard', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'export_reports', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'usage_trends', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'compliance_tracking', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'cost_management', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'unlimited_employees', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'multi_location', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION'),
    ('DEFAULT0001', 'condition_reporting', 1, CURRENT_TIMESTAMP, 'SYSTEM_MIGRATION');

-- =====================================================
-- Migration validation
-- =====================================================

-- Verify companies table
SELECT 'Companies table created:' as status, COUNT(*) as count FROM companies;

-- Verify company_admins table  
SELECT 'Company admins table created:' as status, COUNT(*) as count FROM company_admins;

-- Verify feature_flags table
SELECT 'Feature flags table created:' as status, COUNT(*) as count FROM feature_flags;

-- Show default company details
SELECT 'Default company:' as info, id, company_name, subscription_tier FROM companies WHERE id = 'DEFAULT0001';