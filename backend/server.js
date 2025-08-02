// Load required modules first
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Email configuration now managed through database - see Admin Panel → Email Settings

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const os = require('os');
const { autoCacheBustMiddleware, serveHTMLWithCacheBust, getVersionInfo } = require('./middleware/autoCacheBust');
const cacheBuster = require('./utils/cacheUtils');

// Get network IP address
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Import routes (with error handling)
let authRoutes, stationRoutes, ppeRoutes, inventoryRoutes, dashboardRoutes, alertRoutes, qrRoutes, auditRoutes, staffPPERoutes, approvalRoutes, setupRoutes;

try {
  authRoutes = require('./routes/auth');
  stationRoutes = require('./routes/stations');
  ppeRoutes = require('./routes/ppe');
  inventoryRoutes = require('./routes/inventory');
  dashboardRoutes = require('./routes/dashboard');
  alertRoutes = require('./routes/alerts');
  qrRoutes = require('./routes/qr');
  auditRoutes = require('./routes/audit');
  staffPPERoutes = require('./routes/staff-ppe');
  approvalRoutes = require('./routes/approval');
  setupRoutes = require('./routes/setup');
} catch (error) {
  console.error('Error loading routes:', error.message);
  process.exit(1);
}

const { initDatabase, runMigrations } = require('./database/init');
const { checkLowStock } = require('./services/inventoryService');
const { authenticateToken } = require('./middleware/auth');
const { checkSetupRequired } = require('./middleware/setupCheck');
const reportSchedulerService = require('./services/reportSchedulerService');
const updateCheckService = require('./services/updateCheckService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

// Security middleware with disabled CSP for development
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: '*', // Allow all origins for company network
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Smart Rate Limiting - Different limits for different resource types

// 1. Static Assets Rate Limiter (very permissive for UX)
const staticAssetsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 500, // 500 requests per 5 minutes for static assets
  message: {
    error: 'Too many static asset requests, please wait a moment',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for local development
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('192.168.');
    return isLocal && process.env.NODE_ENV !== 'production';
  }
});

// 2. API Endpoints Rate Limiter (moderate security)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 API requests per 15 minutes
  message: {
    error: 'Too many API requests, please slow down',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('192.168.');
    return isLocal && process.env.NODE_ENV !== 'production';
  }
});

// 3. Authentication Rate Limiter (strict security)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per 15 minutes
  message: {
    error: 'Too many authentication attempts, please wait before trying again',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiters selectively
app.use('/api/auth', authLimiter); // Strict for authentication
app.use('/api', apiLimiter); // Moderate for general API
app.use('/frontend', staticAssetsLimiter); // Permissive for static assets

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Smart cache-busting middleware (applied selectively)
app.use('/frontend', staticAssetsLimiter); // Apply static assets rate limiting

// Global cache-busting middleware (applied to ALL responses except cached manifest)
app.use((req, res, next) => {
  // Add aggressive no-cache headers to prevent any caching issues
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Disable ETags globally
  res.removeHeader('ETag');
  res.removeHeader('Last-Modified');
  
  next();
});

// Auto cache-bust HTML files (MUST be before static middleware)
app.get('/worker.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/worker.html')));
app.get('/worker-mobile.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/worker-mobile.html')));

// Admin.html with setup check - redirect to setup if no admin users exist
app.get('/admin.html', async (req, res) => {
  try {
    const { getDb } = require('./database/init');
    const db = getDb();
    
    // Check if database is initialized
    if (!db) {
      return res.redirect('/setup.html');
    }

    // Check if any admin users exist and completed setup
    const adminExists = await new Promise((resolve) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND first_login_completed = 1 LIMIT 1`, 
        (err, row) => {
          if (err) {
            // If column/table doesn't exist, setup is required
            if (err.message.includes('no such column') || err.message.includes('no such table')) {
              resolve(null);
            } else {
              resolve(null); // Any other error, assume setup required
            }
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!adminExists) {
      // No admin users found, redirect to setup
      return res.redirect('/setup.html');
    }
    
    // Admin exists, serve the admin page
    serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/admin.html'))(req, res);
  } catch (error) {
    console.error('Admin.html setup check error:', error);
    res.redirect('/setup.html');
  }
});

app.get('/setup.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/setup.html')));
app.get('/password-reset.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/password-reset.html')));
app.get('/index.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../pages/index.html')));
app.get('/test-aggressive-cache-busting.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../test-aggressive-cache-busting.html')));
app.get('/manifest-diagnostic.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../manifest-diagnostic.html')));
app.get('/test-worker-cache-fix.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../test-worker-cache-fix.html')));
app.get('/test-stackoverflow-fixes.html', serveHTMLWithCacheBust(path.resolve(__dirname, '../test-stackoverflow-fixes.html')));

// Auto cache-bust service worker (critical for cache management)
app.get('/frontend/worker-sw.js', serveHTMLWithCacheBust(path.resolve(__dirname, '../frontend/worker-sw.js')));

// API endpoint to get current cache versions (for debugging)
app.get('/api/cache/versions', getVersionInfo);

// Rate limiting monitoring endpoint (for debugging)
app.get('/api/system/rate-limits', (req, res) => {
  const clientIP = req.ip;
  const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP.includes('192.168.');
  const environment = process.env.NODE_ENV || 'development';
  
  res.json({
    clientIP,
    isLocal,
    environment,
    rateLimits: {
      staticAssets: {
        window: '5 minutes',
        max: 500,
        active: !isLocal || environment === 'production'
      },
      api: {
        window: '15 minutes', 
        max: 200,
        active: !isLocal || environment === 'production'
      },
      auth: {
        window: '15 minutes',
        max: 10,
        active: true // Always active for security
      }
    },
    manifestCache: {
      cached: !!manifestCache,
      cacheAge: manifestCache ? Date.now() - manifestCacheTime : 0,
      cacheDuration: environment === 'production' ? '5 minutes' : '30 seconds'
    }
  });
});

// Smart manifest.json handling with intelligent caching
let manifestCache = null;
let manifestCacheTime = 0;
const MANIFEST_CACHE_DURATION = 30000; // 30 seconds cache in development, 5 minutes in production

app.get('/frontend/manifest.json', (req, res) => {
  const now = Date.now();
  const cacheDuration = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : MANIFEST_CACHE_DURATION;
  
  // Check if we have valid cached content
  if (manifestCache && (now - manifestCacheTime) < cacheDuration) {
    // Serve from cache with appropriate headers
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(cacheDuration/1000)}`);
    res.setHeader('X-Cache-Status', 'HIT');
    
    // CORS headers for manifest (PWA requirement)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    return res.json(manifestCache);
  }
  
  // Read fresh manifest and cache it
  const fs = require('fs');
  const manifestPath = path.resolve(__dirname, '../frontend/manifest.json');
  
  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    manifestCache = JSON.parse(manifestContent);
    manifestCacheTime = now;
    
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(cacheDuration/1000)}`);
    res.setHeader('X-Cache-Status', 'MISS');
    
    // CORS headers for manifest (PWA requirement)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.json(manifestCache);
  } catch (error) {
    console.error('Error reading manifest.json:', error);
    res.status(500).json({ error: 'Failed to load manifest' });
  }
});

// Clear manifest cache when needed (development helper)
app.post('/api/cache/clear-manifest', (req, res) => {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('192.168.');
  
  if (!isLocal && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Cache clearing only allowed in development' });
  }
  
  manifestCache = null;
  manifestCacheTime = 0;
  
  res.json({ 
    success: true, 
    message: 'Manifest cache cleared successfully',
    timestamp: Date.now()
  });
});

// Serve frontend assets with smart cache-busting
app.use('/frontend', express.static(path.resolve(__dirname, '../frontend'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    // Aggressive no-cache headers for all files
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));
app.use('/dev-tools', express.static(path.resolve(__dirname, '../dev-tools')));
app.use('/docs', express.static(path.resolve(__dirname, '../docs')));

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join_admin', () => {
    socket.join('admin_room');
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Health check (before other routes)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Setup routes (no authentication required)
app.use('/api/setup', setupRoutes);

// API Routes (setup check applied globally)
app.use(checkSetupRequired);

app.use('/api/auth', authRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/ppe', ppeRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/staff-ppe', staffPPERoutes);
app.use('/api/staff', require('./routes/staff'));
app.use('/api/ppe-types', require('./routes/ppeTypes'));
app.use('/api/approval', approvalRoutes);
app.use('/api/ppe-requests', require('./routes/ppe-requests'));
app.use('/api/inventory-management', require('./routes/inventoryManagement'));
app.use('/api/super-admin', require('./routes/superAdmin'));
app.use('/api/features', require('./routes/features'));
app.use('/api/license', require('./routes/license'));
// VPS License Validation Routes will be loaded after database initialization
app.use('/api/reports', require('./routes/reports'));
app.use('/api/email-config', require('./routes/emailConfig'));
// Test route removed for production
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/condition-reports', require('./routes/conditionReports'));
app.use('/api/config', require('./routes/config'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/tier-demo', require('./routes/tier-demo'));
app.use('/api/updates', require('./routes/updates'));

// Load scheduled reports routes (must be before catch-all)
try {
    const scheduledReportsRoutes = require('./routes/scheduledReports');
    app.use('/api/scheduled-reports', scheduledReportsRoutes);
    console.log('✅ Scheduled reports routes loaded successfully');
} catch (error) {
    console.error('❌ Failed to load scheduled reports routes:', error.message);
}

// API root endpoint
app.get('/api', (req, res) => {
  res.json({ 
    message: 'PPE Management API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth/*',
      dashboard: '/api/dashboard/*', 
      ppe: '/api/ppe/*',
      qr: '/api/qr/*',
      stations: '/api/stations/*',
      inventory: '/api/inventory/*',
      alerts: '/api/alerts/*',
      audit: '/api/audit/*',
      staffPPE: '/api/staff-ppe/*',
      approval: '/api/approval/*',
      reports: '/api/reports/*',
      scheduledReports: '/api/scheduled-reports/*',
      superAdmin: '/api/super-admin/*'
    }
  });
});

// Protected routes
app.use('/api/admin/*', authenticateToken);

// Route redirects for better UX (must be after API routes)
app.get('/admin*', async (req, res) => {
  // Check if setup is required first
  try {
    const { getDb } = require('./database/init');
    const db = getDb();
    
    // Check if database is initialized and table exists
    if (!db) {
      return res.redirect('/setup.html');
    }

    const adminExists = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE role = 'ADMIN' AND first_login_completed = 1 LIMIT 1`, 
        (err, row) => {
          if (err) {
            // If column doesn't exist yet, assume setup is required
            if (err.message.includes('no such column') || err.message.includes('no such table')) {
              resolve(null);
            } else {
              reject(err);
            }
          } else {
            resolve(row);
          }
        }
      );
    });

    if (!adminExists) {
      // Setup required, redirect to setup page
      return res.redirect('/setup.html');
    }
    
    // Setup completed, redirect to admin page
    res.redirect('/');
  } catch (error) {
    console.error('Admin redirect setup check error:', error);
    res.redirect('/setup.html');
  }
});

// Only redirect specific worker routes, not all files starting with "worker"
app.get('/worker', (req, res) => {
  res.redirect('/worker.html');
});

app.get('/worker/', (req, res) => {
  res.redirect('/worker.html');
});

// Static files (serve from parent directory) - avoid duplicating frontend
app.use(express.static(path.join(__dirname, '..'), {
  index: false, // Don't serve index.html automatically
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.json')) {
      // Aggressive caching prevention for critical files
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Serve frontend (catch-all for SPA)
app.get('*', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'pages', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    console.log('Database initialized successfully');
    
    // Run migrations for existing databases
    runMigrations();
    
    // Run VPS validation columns migration
    try {
      const { addVPSValidationColumns } = require('./database/migrations/add_vps_validation_columns');
      await addVPSValidationColumns();
      console.log('✅ VPS validation columns migration completed');
    } catch (migrationError) {
      console.log('⚠️ VPS validation columns migration skipped:', migrationError.message);
    }
    
    // Load VPS License Validation Routes after database is ready
    try {
      const vpsLicenseRoutes = require('./routes/vps-license');
      app.use('/api/license', vpsLicenseRoutes);
      console.log('✅ VPS License validation routes loaded successfully');
    } catch (vpsRouteError) {
      console.error('❌ Failed to load VPS license routes:', vpsRouteError.message);
    }
    
    // Super admin disabled for customer distribution
    // const superAdminService = require('./services/superAdminService');
    // await superAdminService.initializeSuperAdmin();

// Generate usage summary statistics for notifications
async function generateUsageSummary(period) {
  try {
    const { getDb } = require('./database/init');
    const db = getDb();
    
    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    if (period === 'weekly') {
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    } else {
      startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // Daily fallback
    }
    
    // Get PPE request statistics
    const requestStats = await new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          COUNT(*) as totalRequests,
          SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approvedRequests,
          SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejectedRequests,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pendingRequests
        FROM ppe_requests 
        WHERE created_at >= ?
      `, [startDate.toISOString()], (err, row) => {
        if (err) reject(err);
        else resolve(row || { totalRequests: 0, approvedRequests: 0, rejectedRequests: 0, pendingRequests: 0 });
      });
    });
    
    // Get total items issued
    const itemStats = await new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          COALESCE(SUM(quantity), 0) as totalItems
        FROM ppe_request_items pri
        JOIN ppe_requests pr ON pri.request_id = pr.id
        WHERE pr.created_at >= ? AND pr.status = 'APPROVED'
      `, [startDate.toISOString()], (err, row) => {
        if (err) reject(err);
        else resolve(row || { totalItems: 0 });
      });
    });
    
    // Get active staff count
    const staffStats = await new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(DISTINCT staff_id) as activeStaff
        FROM ppe_requests 
        WHERE created_at >= ?
      `, [startDate.toISOString()], (err, row) => {
        if (err) reject(err);
        else resolve(row || { activeStaff: 0 });
      });
    });
    
    return {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      totalRequests: requestStats.totalRequests || 0,
      approvedRequests: requestStats.approvedRequests || 0,
      rejectedRequests: requestStats.rejectedRequests || 0,
      pendingRequests: requestStats.pendingRequests || 0,
      totalItems: itemStats.totalItems || 0,
      activeStaff: staffStats.activeStaff || 0
    };
    
  } catch (error) {
    console.error(`Generate ${period} usage summary error:`, error);
    return {
      period,
      totalRequests: 0,
      approvedRequests: 0,
      rejectedRequests: 0,
      pendingRequests: 0,
      totalItems: 0,
      activeStaff: 0,
      error: error.message
    };
  }
}
    
    server.listen(PORT, '0.0.0.0', async () => {
      const networkIP = getNetworkIP();
      console.log(`PPE Management Server running on port ${PORT}`);
      console.log(`Frontend: http://localhost:${PORT}`);
      console.log(`Network: http://${networkIP}:${PORT}`);
      console.log(`API: http://${networkIP}:${PORT}/api`);
      console.log(`📱 Mobile Access: http://${networkIP}:${PORT}/worker.html`);
      console.log(`🏢 IT-Friendly: Using port ${PORT} for internal company use`);
      // console.log(`🔑 Super Admin: http://${networkIP}:${PORT}/super-admin.html`);
      
      // Initialize update check service
      try {
        await updateCheckService.initialize();
        console.log('✅ Update check service initialized');
      } catch (error) {
        console.error('❌ Failed to initialize update check service:', error);
      }
    });
    
    // Start background jobs
    cron.schedule('*/5 * * * *', () => {
      checkLowStock(io);
    });
    
    // License expiration check (daily at 8 AM)
    cron.schedule('0 8 * * *', async () => {
      console.log('🔒 Running daily license expiration check...');
      try {
        const licenseService = require('./services/licenseService');
        const notificationHelper = require('./services/notificationHelper');
        
        const licenseStatus = await licenseService.getLicenseStatus();
        
        if (licenseStatus && licenseStatus.expiration_date) {
          const daysRemaining = licenseStatus.days_remaining || 0;
          
          // Send notifications for expiring licenses
          if (daysRemaining <= 30 && daysRemaining >= 0) {
            console.log(`⚠️ License expires in ${daysRemaining} days - sending notification`);
            
            await notificationHelper.sendNotificationIfEnabled('license_expiring', {
              daysRemaining,
              expirationDate: licenseStatus.expiration_date
            });
          } else if (daysRemaining < 0) {
            console.log(`🚨 License expired ${Math.abs(daysRemaining)} days ago - sending urgent notification`);
            
            await notificationHelper.sendNotificationIfEnabled('license_expiring', {
              daysRemaining,
              expirationDate: licenseStatus.expiration_date
            });
          }
        }
      } catch (error) {
        console.error('❌ License expiration check error:', error);
      }
    });
    
    // Weekly summary (Mondays at 9 AM)
    cron.schedule('0 9 * * 1', async () => {
      console.log('📊 Generating weekly summary notifications...');
      try {
        const notificationHelper = require('./services/notificationHelper');
        const summaryStats = await generateUsageSummary('weekly');
        
        await notificationHelper.sendNotificationIfEnabled('weekly_summary', {
          period: 'weekly',
          stats: summaryStats
        });
      } catch (error) {
        console.error('❌ Weekly summary notification error:', error);
      }
    });
    
    // Monthly summary (1st of month at 10 AM)
    cron.schedule('0 10 1 * *', async () => {
      console.log('📊 Generating monthly summary notifications...');
      try {
        const notificationHelper = require('./services/notificationHelper');
        const summaryStats = await generateUsageSummary('monthly');
        
        await notificationHelper.sendNotificationIfEnabled('monthly_summary', {
          period: 'monthly',
          stats: summaryStats
        });
      } catch (error) {
        console.error('❌ Monthly summary notification error:', error);
      }
    });
    
    // Process scheduled notifications (daily at 6 PM)
    cron.schedule('0 18 * * *', async () => {
      console.log('📅 Processing scheduled notifications...');
      try {
        const notificationHelper = require('./services/notificationHelper');
        
        // Initialize scheduled notifications table if needed
        await notificationHelper.initializeScheduledNotificationsTable();
        
        // Process daily batched notifications
        await notificationHelper.processScheduledNotifications('daily');
      } catch (error) {
        console.error('❌ Process scheduled notifications error:', error);
      }
    });
    
    // Process weekly scheduled notifications (Fridays at 6 PM)
    cron.schedule('0 18 * * 5', async () => {
      console.log('📅 Processing weekly scheduled notifications...');
      try {
        const notificationHelper = require('./services/notificationHelper');
        await notificationHelper.processScheduledNotifications('weekly');
      } catch (error) {
        console.error('❌ Process weekly scheduled notifications error:', error);
      }
    });

    // VPS License Validation Check (every 6 hours)
    cron.schedule('0 */6 * * *', async () => {
      console.log('🔒 Running periodic VPS license validation...');
      try {
        const licenseService = require('./services/licenseService');
        const result = await licenseService.validateLicense();
        
        if (result.valid) {
          console.log('✅ Periodic VPS license validation successful');
        } else {
          console.log('⚠️ Periodic VPS license validation failed:', result.error);
        }
      } catch (error) {
        console.error('❌ Periodic VPS license validation error:', error);
      }
    });

    // VPS Grace Period Warning (daily at 9 AM)
    cron.schedule('0 9 * * *', async () => {
      try {
        const licenseService = require('./services/licenseService');
        const graceStatus = await licenseService.checkVPSGracePeriod();
        
        if (graceStatus.inGracePeriod && graceStatus.daysRemaining <= 3) {
          console.log(`⚠️ VPS validation grace period warning: ${graceStatus.daysRemaining} days remaining`);
          
          // Send notification to admin if email is configured
          try {
            const emailService = require('./services/emailService');
            await emailService.sendGracePeriodWarning(graceStatus);
          } catch (emailError) {
            console.log('Note: Could not send grace period warning email:', emailError.message);
          }
        }
      } catch (error) {
        console.error('❌ Grace period check error:', error);
      }
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();