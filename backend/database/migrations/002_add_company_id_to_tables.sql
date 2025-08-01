-- =====================================================
-- PPE Management Multi-Tenant Database Schema
-- Migration 002: Add company_id to All Existing Tables
-- =====================================================

-- Add company_id column to all existing tables and migrate data

-- =====================================================
-- STAFF TABLE
-- =====================================================
-- Add company_id to staff table
ALTER TABLE staff ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing staff records to use default company
UPDATE staff SET company_id = 'DEFAULT0001' WHERE company_id IS NULL;

-- Make company_id required for new records
-- Note: SQLite doesn't support ALTER COLUMN, so we'll add constraint via trigger

-- Create index for staff company queries
CREATE INDEX IF NOT EXISTS idx_staff_company ON staff(company_id);

-- =====================================================
-- STATIONS TABLE
-- =====================================================
-- Add company_id to stations table
ALTER TABLE stations ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing stations to use default company
UPDATE stations SET company_id = 'DEFAULT0001' WHERE company_id IS NULL;

-- Create index for stations company queries
CREATE INDEX IF NOT EXISTS idx_stations_company ON stations(company_id);

-- =====================================================
-- PPE_ITEMS TABLE
-- =====================================================
-- Add company_id to ppe_items table
ALTER TABLE ppe_items ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing PPE items to use default company
UPDATE ppe_items SET company_id = 'DEFAULT0001' WHERE company_id IS NULL;

-- Create index for PPE items company queries
CREATE INDEX IF NOT EXISTS idx_ppe_items_company ON ppe_items(company_id);

-- =====================================================
-- STATION_INVENTORY TABLE
-- =====================================================
-- Add company_id to station_inventory table
ALTER TABLE station_inventory ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing inventory to use default company
UPDATE station_inventory SET company_id = 'DEFAULT0001' WHERE company_id IS NULL;

-- Create index for inventory company queries
CREATE INDEX IF NOT EXISTS idx_station_inventory_company ON station_inventory(company_id);

-- =====================================================
-- PPE_REQUESTS TABLE
-- =====================================================
-- Add company_id to ppe_requests table
ALTER TABLE ppe_requests ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing requests to use default company
UPDATE ppe_requests SET company_id = 'DEFAULT0001' WHERE company_id IS NULL;

-- Create index for requests company queries
CREATE INDEX IF NOT EXISTS idx_ppe_requests_company ON ppe_requests(company_id);

-- =====================================================
-- ALERTS TABLE (if exists)
-- =====================================================
-- Add company_id to alerts table if it exists
-- Check if alerts table exists first
SELECT name FROM sqlite_master WHERE type='table' AND name='alerts';

-- Add company_id if alerts table exists
ALTER TABLE alerts ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing alerts to use default company
UPDATE alerts SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='alerts'
);

-- Create index for alerts company queries if table exists
CREATE INDEX IF NOT EXISTS idx_alerts_company ON alerts(company_id);

-- =====================================================
-- INVENTORY_ALERTS TABLE (if exists)
-- =====================================================
-- Add company_id to inventory_alerts table if it exists
ALTER TABLE inventory_alerts ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing inventory alerts to use default company
UPDATE inventory_alerts SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_alerts'
);

-- Create index for inventory alerts company queries
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_company ON inventory_alerts(company_id);

-- =====================================================
-- QR_TOKENS TABLE (if exists)
-- =====================================================
-- Add company_id to qr_tokens table if it exists
ALTER TABLE qr_tokens ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing QR tokens to use default company
UPDATE qr_tokens SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='qr_tokens'
);

-- Create index for QR tokens company queries
CREATE INDEX IF NOT EXISTS idx_qr_tokens_company ON qr_tokens(company_id);

-- =====================================================
-- REPORTS TABLE (if exists)
-- =====================================================
-- Add company_id to reports table if it exists
ALTER TABLE reports ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing reports to use default company
UPDATE reports SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='reports'
);

-- Create index for reports company queries
CREATE INDEX IF NOT EXISTS idx_reports_company ON reports(company_id);

-- =====================================================
-- AUDIT_LOGS TABLE (if exists)
-- =====================================================
-- Add company_id to audit_logs table if it exists
ALTER TABLE audit_logs ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing audit logs to use default company
UPDATE audit_logs SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_logs'
);

-- Create index for audit logs company queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id);

-- =====================================================
-- ANALYTICS TABLE (if exists)
-- =====================================================
-- Add company_id to analytics table if it exists
ALTER TABLE analytics ADD COLUMN company_id TEXT REFERENCES companies(id);

-- Update existing analytics to use default company
UPDATE analytics SET company_id = 'DEFAULT0001' WHERE company_id IS NULL AND EXISTS (
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='analytics'
);

-- Create index for analytics company queries
CREATE INDEX IF NOT EXISTS idx_analytics_company ON analytics(company_id);

-- =====================================================
-- CREATE TRIGGERS FOR COMPANY_ID VALIDATION
-- =====================================================

-- Trigger to ensure company_id is set for new staff records
CREATE TRIGGER IF NOT EXISTS trg_staff_company_id_required
    BEFORE INSERT ON staff
    WHEN NEW.company_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'company_id is required for new staff records');
END;

-- Trigger to ensure company_id is set for new stations
CREATE TRIGGER IF NOT EXISTS trg_stations_company_id_required
    BEFORE INSERT ON stations
    WHEN NEW.company_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'company_id is required for new station records');
END;

-- Trigger to ensure company_id is set for new PPE items
CREATE TRIGGER IF NOT EXISTS trg_ppe_items_company_id_required
    BEFORE INSERT ON ppe_items
    WHEN NEW.company_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'company_id is required for new PPE item records');
END;

-- Trigger to ensure company_id is set for new inventory records
CREATE TRIGGER IF NOT EXISTS trg_station_inventory_company_id_required
    BEFORE INSERT ON station_inventory
    WHEN NEW.company_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'company_id is required for new inventory records');
END;

-- Trigger to ensure company_id is set for new PPE requests
CREATE TRIGGER IF NOT EXISTS trg_ppe_requests_company_id_required
    BEFORE INSERT ON ppe_requests
    WHEN NEW.company_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'company_id is required for new PPE request records');
END;

-- =====================================================
-- MIGRATION VALIDATION
-- =====================================================

-- Verify all existing records have company_id
SELECT 'Staff records with company_id:' as check_name, COUNT(*) as total, 
       COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id
FROM staff;

SELECT 'Station records with company_id:' as check_name, COUNT(*) as total, 
       COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id
FROM stations;

SELECT 'PPE item records with company_id:' as check_name, COUNT(*) as total, 
       COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id
FROM ppe_items;

SELECT 'Inventory records with company_id:' as check_name, COUNT(*) as total, 
       COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id
FROM station_inventory;

SELECT 'PPE request records with company_id:' as check_name, COUNT(*) as total, 
       COUNT(CASE WHEN company_id IS NOT NULL THEN 1 END) as with_company_id
FROM ppe_requests;

-- Show summary of data distribution by company
SELECT 'Data distribution by company:' as summary_title;
SELECT 
    c.id as company_id,
    c.company_name,
    (SELECT COUNT(*) FROM staff WHERE company_id = c.id) as staff_count,
    (SELECT COUNT(*) FROM stations WHERE company_id = c.id) as stations_count,
    (SELECT COUNT(*) FROM ppe_items WHERE company_id = c.id) as ppe_items_count,
    (SELECT COUNT(*) FROM station_inventory WHERE company_id = c.id) as inventory_count,
    (SELECT COUNT(*) FROM ppe_requests WHERE company_id = c.id) as requests_count
FROM companies c
ORDER BY c.created_at;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
SELECT 'Multi-tenant database migration complete!' as status,
       'All existing tables now have company_id columns and default data assigned to DEFAULT0001' as details;