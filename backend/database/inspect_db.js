/**
 * Database Inspection Script
 * Check what data exists in the database after customer reset
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'ppe_management.db');
const db = new sqlite3.Database(DB_PATH);

async function inspectDatabase() {
    console.log('🔍 DATABASE INSPECTION REPORT');
    console.log('================================\n');
    
    try {
        // Check admin users
        const adminUsers = await new Promise((resolve, reject) => {
            db.all(`SELECT id, name, email, role, first_login_completed, password FROM users WHERE role IN ('ADMIN', 'admin') LIMIT 5`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`👤 ADMIN USERS: ${adminUsers.length} found`);
        adminUsers.forEach(user => {
            console.log(`   ${user.name} (${user.email}) - Setup: ${user.first_login_completed ? 'Complete' : 'Required'} - Password: ${user.password ? 'SET' : 'EMPTY'}`);
        });
        console.log('');
        
        // Check stations
        const stations = await new Promise((resolve, reject) => {
            db.all(`SELECT id, name, location FROM stations LIMIT 5`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`🏢 STATIONS: ${stations.length} found`);
        stations.forEach(station => {
            console.log(`   ${station.id} - ${station.name} (${station.location})`);
        });
        console.log('');
        
        // Check PPE items
        const ppeItems = await new Promise((resolve, reject) => {
            db.all(`SELECT id, name, type FROM ppe_items LIMIT 5`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`🛡️ PPE ITEMS: ${ppeItems.length} found`);
        ppeItems.forEach(item => {
            console.log(`   ${item.id} - ${item.name} (${item.type})`);
        });
        console.log('');
        
        // Check station inventory (source of dashboard numbers)
        const inventory = await new Promise((resolve, reject) => {
            db.all(`SELECT station_id, ppe_item_id, current_stock FROM station_inventory LIMIT 10`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`📦 STATION INVENTORY: ${inventory.length} records found`);
        let totalStock = 0;
        inventory.forEach(inv => {
            console.log(`   Station: ${inv.station_id}, Item: ${inv.ppe_item_id}, Stock: ${inv.current_stock}`);
            totalStock += inv.current_stock || 0;
        });
        console.log(`   TOTAL STOCK CALCULATED: ${totalStock}`);
        console.log('');
        
        // Check PPE requests (source of daily issued)
        const requests = await new Promise((resolve, reject) => {
            db.all(`SELECT id, status, created_at FROM ppe_requests WHERE created_at >= date('now') LIMIT 5`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`📋 TODAY'S PPE REQUESTS: ${requests.length} found`);
        requests.forEach(req => {
            console.log(`   ${req.id} - ${req.status} (${req.created_at})`);
        });
        console.log('');
        
        // Check request items for daily issued count
        const todayIssued = await new Promise((resolve, reject) => {
            db.all(`
                SELECT COUNT(*) as count 
                FROM ppe_request_items pri 
                JOIN ppe_requests pr ON pri.request_id = pr.id 
                WHERE pr.created_at >= date('now') AND pri.issued = 1
            `, (err, rows) => {
                if (err) resolve([{count: 0}]);
                else resolve(rows || [{count: 0}]);
            });
        });
        
        console.log(`📊 DAILY ISSUED COUNT: ${todayIssued[0]?.count || 0}`);
        console.log('');
        
        // Check license status
        const license = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM license_config LIMIT 1`, (err, rows) => {
                if (err) resolve([]);
                else resolve(rows || []);
            });
        });
        
        console.log(`🔐 LICENSE: ${license.length} records found`);
        license.forEach(lic => {
            console.log(`   Company: ${lic.company_name}, Status: ${lic.status}, Expires: ${lic.expires_at}`);
        });
        console.log('');
        
        // Get table sizes
        const tables = ['users', 'stations', 'ppe_items', 'station_inventory', 'ppe_requests', 'ppe_request_items'];
        console.log('📊 TABLE SIZES:');
        
        for (const table of tables) {
            try {
                const count = await new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
                        if (err) resolve({ count: 'ERROR' });
                        else resolve(row || { count: 0 });
                    });
                });
                console.log(`   ${table}: ${count.count} records`);
            } catch (err) {
                console.log(`   ${table}: TABLE NOT FOUND`);
            }
        }
        
    } catch (error) {
        console.error('❌ Inspection failed:', error.message);
    } finally {
        db.close();
    }
}

inspectDatabase();