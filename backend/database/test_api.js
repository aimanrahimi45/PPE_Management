/**
 * Test API endpoints to check where sample data is coming from
 */

const http = require('http');

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

async function testAPIEndpoints() {
    console.log('🧪 TESTING API ENDPOINTS FOR SAMPLE DATA SOURCE\n');
    
    const endpoints = [
        '/api/dashboard/stats',
        '/api/approval/pending',
        '/api/inventory-management/inventory',
        '/api/features'
    ];
    
    for (const endpoint of endpoints) {
        try {
            console.log(`📡 Testing: ${endpoint}`);
            const result = await makeRequest(endpoint);
            console.log(`   Status: ${result.status}`);
            
            if (result.status === 200) {
                if (endpoint === '/api/dashboard/stats' && result.data.stats) {
                    console.log(`   Dashboard Stats:`);
                    console.log(`     Total Stock: ${result.data.stats.total_stock}`);
                    console.log(`     Low Stock: ${result.data.stats.low_stock_items}`);
                    console.log(`     Daily Issued: ${result.data.stats.daily_issued}`);
                    console.log(`     License Required: ${result.data.license_required}`);
                }
                console.log(`   Data: ${JSON.stringify(result.data, null, 2).substring(0, 200)}...`);
            } else {
                console.log(`   Error: ${JSON.stringify(result.data)}`);
            }
            console.log('');
        } catch (error) {
            console.log(`   Connection Error: ${error.message}\n`);
        }
    }
}

testAPIEndpoints();