const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const emailService = require('./emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class ReportSchedulerService {
  constructor() {
    this.scheduledJobs = new Map();
    // Note: initializeScheduler() called lazily when database is ready
  }

  // Lazy database connection - only get when needed
  getDatabase() {
    return getDb();
  }

  /**
   * Initialize the scheduler and load existing scheduled reports
   */
  async initializeScheduler() {
    try {
      console.log('📊 Initializing Report Scheduler Service...');
      
      // Create scheduled_reports table if it doesn't exist
      await this.createReportScheduleTable();
      
      // Load and start existing scheduled reports
      await this.loadScheduledReports();
      
      console.log('📊 Report Scheduler Service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Report Scheduler Service:', error);
    }
  }

  /**
   * Create the scheduled_reports table
   */
  async createReportScheduleTable() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS scheduled_reports (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          report_type TEXT NOT NULL,
          schedule_cron TEXT NOT NULL,
          recipients TEXT NOT NULL,
          parameters TEXT,
          enabled INTEGER DEFAULT 1,
          last_run DATETIME,
          next_run DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      this.getDatabase().run(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Load and start all enabled scheduled reports
   */
  async loadScheduledReports() {
    return new Promise((resolve, reject) => {
      this.getDatabase().all(
        'SELECT * FROM scheduled_reports WHERE enabled = 1',
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            rows.forEach(report => {
              this.scheduleReport(report);
            });
            console.log(`📊 Loaded ${rows.length} scheduled reports`);
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Schedule a report using cron
   */
  scheduleReport(reportConfig) {
    const { id, name, schedule_cron, report_type, recipients, parameters } = reportConfig;

    // Stop existing job if it exists
    if (this.scheduledJobs.has(id)) {
      this.scheduledJobs.get(id).stop();
    }

    // Create new scheduled job
    const job = cron.schedule(schedule_cron, async () => {
      console.log(`📊 Executing scheduled report: ${name}`);
      await this.executeScheduledReport(reportConfig);
    }, {
      scheduled: true,
      timezone: 'America/New_York' // Adjust timezone as needed
    });

    this.scheduledJobs.set(id, job);
    console.log(`📊 Scheduled report "${name}" with cron: ${schedule_cron}`);
  }

  /**
   * Execute a scheduled report
   */
  async executeScheduledReport(reportConfig) {
    try {
      const { id, name, report_type, recipients, parameters } = reportConfig;
      
      // Update last run time
      await this.updateLastRunTime(id);

      // Generate report data
      const reportData = await this.generateReportData(report_type, parameters);

      // Generate PDF
      const pdfPath = await this.generateReportPDF(reportData, report_type, name);

      // Send email with PDF attachment
      await this.sendReportEmail(recipients, name, report_type, pdfPath, reportData);

      console.log(`📊 Successfully executed scheduled report: ${name}`);

    } catch (error) {
      console.error(`Failed to execute scheduled report ${reportConfig.name}:`, error);
    }
  }

  /**
   * Generate report data based on type
   */
  async generateReportData(reportType, parameters) {
    const params = parameters ? JSON.parse(parameters) : {};
    
    switch (reportType) {
      case 'daily_summary':
        return await this.generateDailySummaryReport();
      
      case 'weekly_analytics':
        return await this.generateWeeklyAnalyticsReport();
      
      case 'monthly_compliance':
        return await this.generateMonthlyComplianceReport();
      
      case 'inventory_status':
        return await this.generateInventoryStatusReport();
      
      case 'staff_usage':
        return await this.generateStaffUsageReport(params);
      
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  /**
   * Generate daily summary report data
   */
  async generateDailySummaryReport() {
    return new Promise((resolve, reject) => {
      const today = new Date().toISOString().split('T')[0];
      
      this.getDatabase().get(`
        SELECT 
          COUNT(DISTINCT pr.id) as total_requests,
          COUNT(DISTINCT CASE WHEN pr.status = 'APPROVED' THEN pr.id END) as approved_requests,
          COUNT(DISTINCT CASE WHEN pr.status = 'PENDING' THEN pr.id END) as pending_requests,
          SUM(CASE WHEN pr.status = 'APPROVED' THEN pri.quantity ELSE 0 END) as total_items_issued,
          COUNT(DISTINCT pr.station_id) as active_stations
        FROM ppe_requests pr
        LEFT JOIN ppe_request_items pri ON pr.id = pri.request_id
        WHERE DATE(pr.created_at) = ?
      `, [today], (err, summary) => {
        if (err) {
          reject(err);
        } else {
          // Get top requested items
          this.getDatabase().all(`
            SELECT 
              pi.name,
              pi.symbol,
              SUM(pri.quantity) as total_quantity
            FROM ppe_request_items pri
            JOIN ppe_items pi ON pri.ppe_item_id = pi.id
            JOIN ppe_requests pr ON pri.request_id = pr.id
            WHERE DATE(pr.created_at) = ? AND pr.status = 'APPROVED'
            GROUP BY pi.id, pi.name, pi.symbol
            ORDER BY total_quantity DESC
            LIMIT 5
          `, [today], (err, topItems) => {
            if (err) {
              reject(err);
            } else {
              resolve({
                reportType: 'Daily Summary',
                date: today,
                summary: summary || {},
                topItems: topItems || [],
                generatedAt: new Date()
              });
            }
          });
        }
      });
    });
  }

  /**
   * Generate weekly analytics report data
   */
  async generateWeeklyAnalyticsReport() {
    return new Promise((resolve, reject) => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      this.getDatabase().all(`
        SELECT 
          DATE(pr.created_at) as date,
          COUNT(DISTINCT pr.id) as requests,
          SUM(pri.quantity) as items_issued
        FROM ppe_requests pr
        JOIN ppe_request_items pri ON pr.id = pri.request_id
        WHERE pr.created_at >= ? AND pr.created_at <= ? 
          AND pr.status = 'APPROVED'
        GROUP BY DATE(pr.created_at)
        ORDER BY date ASC
      `, [startDate.toISOString(), endDate.toISOString()], (err, dailyStats) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            reportType: 'Weekly Analytics',
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            dailyStats: dailyStats || [],
            generatedAt: new Date()
          });
        }
      });
    });
  }

  /**
   * Generate inventory status report
   */
  async generateInventoryStatusReport() {
    return new Promise((resolve, reject) => {
      this.getDatabase().all(`
        SELECT 
          pi.name,
          pi.symbol,
          si.current_stock,
          si.min_threshold,
          si.critical_threshold,
          si.max_capacity,
          s.name as station_name,
          CASE 
            WHEN si.current_stock <= si.critical_threshold THEN 'CRITICAL'
            WHEN si.current_stock <= si.min_threshold THEN 'LOW'
            ELSE 'NORMAL'
          END as stock_status
        FROM station_inventory si
        JOIN ppe_items pi ON si.ppe_item_id = pi.id
        JOIN stations s ON si.station_id = s.id
        ORDER BY stock_status DESC, si.current_stock ASC
      `, [], (err, inventory) => {
        if (err) {
          reject(err);
        } else {
          const criticalCount = inventory.filter(item => item.stock_status === 'CRITICAL').length;
          const lowCount = inventory.filter(item => item.stock_status === 'LOW').length;
          const normalCount = inventory.filter(item => item.stock_status === 'NORMAL').length;

          resolve({
            reportType: 'Inventory Status',
            summary: { criticalCount, lowCount, normalCount },
            inventory: inventory || [],
            generatedAt: new Date()
          });
        }
      });
    });
  }

  /**
   * Generate PDF report
   */
  async generateReportPDF(reportData, reportType, reportName) {
    return new Promise((resolve, reject) => {
      try {
        const fileName = `${reportName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
        const filePath = path.join(__dirname, '../temp', fileName);

        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const doc = new PDFDocument();
        doc.pipe(fs.createWriteStream(filePath));

        // Register standard font to avoid encoding issues
        doc.registerFont('Helvetica', 'Helvetica');
        doc.font('Helvetica');

        // Header - using simple text without emojis to avoid encoding issues
        doc.fontSize(20).text('PPE Management Report', 50, 50);
        doc.fontSize(16).text(reportData.reportType, 50, 80);
        doc.fontSize(12).text(`Generated: ${reportData.generatedAt.toLocaleString()}`, 50, 100);

        let yPosition = 140;

        // Report-specific content
        switch (reportType) {
          case 'daily_summary':
            this.addDailySummaryToPDF(doc, reportData, yPosition);
            break;
          case 'weekly_analytics':
            this.addWeeklyAnalyticsToPDF(doc, reportData, yPosition);
            break;
          case 'inventory_status':
            this.addInventoryStatusToPDF(doc, reportData, yPosition);
            break;
        }

        doc.end();

        doc.on('end', () => {
          resolve(filePath);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Add daily summary content to PDF
   */
  addDailySummaryToPDF(doc, reportData, yPos) {
    const { summary, topItems } = reportData;

    doc.fontSize(14).text('Daily Summary', 50, yPos);
    yPos += 30;

    doc.fontSize(12)
      .text(`Total Requests: ${summary.total_requests || 0}`, 50, yPos)
      .text(`Approved: ${summary.approved_requests || 0}`, 50, yPos + 20)
      .text(`Pending: ${summary.pending_requests || 0}`, 50, yPos + 40)
      .text(`Items Issued: ${summary.total_items_issued || 0}`, 50, yPos + 60)
      .text(`Active Stations: ${summary.active_stations || 0}`, 50, yPos + 80);

    yPos += 120;

    if (topItems.length > 0) {
      doc.fontSize(14).text('Top Requested Items', 50, yPos);
      yPos += 30;

      topItems.forEach((item, index) => {
        // Clean the text to avoid encoding issues
        const itemName = (item.name || '').toString().replace(/[^\x20-\x7E]/g, '');
        const itemSymbol = (item.symbol || '').toString().replace(/[^\x20-\x7E]/g, '');
        doc.fontSize(12).text(
          `${index + 1}. ${itemSymbol} ${itemName}: ${item.total_quantity}`,
          50, yPos
        );
        yPos += 20;
      });
    }
  }

  /**
   * Send report email with attachment
   */
  async sendReportEmail(recipients, reportName, reportType, pdfPath, reportData) {
    try {
      const recipientList = recipients.split(',').map(email => email.trim());
      
      const subject = `Scheduled Report: ${reportName}`;
      const htmlContent = this.generateReportEmailHTML(reportData, reportType);

      console.log(`📧 Sending report email to: ${recipientList.join(', ')}`);
      console.log(`📎 PDF attachment: ${pdfPath}`);

      // Send email using emailService with PDF attachment
      try {
        await emailService.sendEmailWithAttachment({
          to: recipientList,
          subject: subject,
          html: htmlContent,
          attachments: [{
            filename: `${reportName.replace(/\s+/g, '_')}_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`,
            path: pdfPath,
            contentType: 'application/pdf'
          }]
        });

        console.log(`✅ Successfully sent report email to: ${recipientList.join(', ')}`);

      } catch (emailError) {
        console.error('❌ Failed to send report email:', emailError);
        throw emailError;
      }

      // Clean up temp file after sending
      setTimeout(() => {
        if (fs.existsSync(pdfPath)) {
          fs.unlinkSync(pdfPath);
          console.log(`🗑️ Cleaned up temp file: ${pdfPath}`);
        }
      }, 60000); // Delete after 1 minute

    } catch (error) {
      console.error('Failed to send report email:', error);
      throw error;
    }
  }

  /**
   * Generate HTML content for report email
   */
  generateReportEmailHTML(reportData, reportType) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #27AE60; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="margin: 0;">PPE Management Report</h2>
          <p style="margin: 8px 0 0 0;">${reportData.reportType}</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px;">
          <p>Your scheduled ${reportType.replace('_', ' ')} report has been generated and is attached to this email.</p>
          <p><strong>Generated:</strong> ${reportData.generatedAt.toLocaleString()}</p>
          <p>Please find the detailed report in the PDF attachment.</p>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #e8f5e8; border-radius: 6px;">
          <p style="margin: 0; color: #2d5a2d; font-size: 14px;">
            <strong>Note:</strong> This is an automated report. Please review the attached PDF for complete details.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Update last run time for a scheduled report
   */
  async updateLastRunTime(reportId) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      this.getDatabase().run(
        'UPDATE scheduled_reports SET last_run = ?, updated_at = ? WHERE id = ?',
        [now, now, reportId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Add a new scheduled report
   */
  async addScheduledReport(reportConfig) {
    const id = uuidv4();
    const {
      name,
      description,
      reportType,
      scheduleCron,
      recipients,
      parameters,
      enabled = true
    } = reportConfig;

    return new Promise((resolve, reject) => {
      this.getDatabase().run(`
        INSERT INTO scheduled_reports (
          id, name, description, report_type, schedule_cron, 
          recipients, parameters, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, name, description, reportType, scheduleCron,
        recipients, JSON.stringify(parameters || {}), enabled ? 1 : 0
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          // Schedule the report if enabled
          if (enabled) {
            const fullConfig = {
              id, name, description, report_type: reportType,
              schedule_cron: scheduleCron, recipients, parameters: JSON.stringify(parameters || {})
            };
            this.scheduleReport(fullConfig);
          }
          
          resolve({ id, success: true });
        }
      }.bind(this));
    });
  }

  /**
   * Get all scheduled reports
   */
  async getScheduledReports() {
    return new Promise((resolve, reject) => {
      this.getDatabase().all('SELECT * FROM scheduled_reports ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Get next run time for a cron schedule
   */
  getNextRunTime(cronExpression) {
    try {
      const cronParts = cronExpression.split(' ');
      if (cronParts.length !== 5) {
        return 'Invalid cron expression';
      }

      const [minute, hour, dayOfMonth, month, dayOfWeek] = cronParts;
      const now = new Date();
      const next = new Date(now);

      // Simple next run calculation for common patterns
      if (cronExpression === '0 9 * * *') { // Daily at 9 AM
        next.setHours(9, 0, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
      } else if (cronExpression === '0 9 * * 1') { // Weekly Monday at 9 AM
        next.setHours(9, 0, 0, 0);
        const daysUntilMonday = (1 + 7 - next.getDay()) % 7;
        if (daysUntilMonday === 0 && next <= now) {
          next.setDate(next.getDate() + 7);
        } else {
          next.setDate(next.getDate() + daysUntilMonday);
        }
      } else if (cronExpression === '0 9 1 * *') { // Monthly on 1st at 9 AM
        next.setDate(1);
        next.setHours(9, 0, 0, 0);
        if (next <= now) {
          next.setMonth(next.getMonth() + 1);
        }
      } else if (cronExpression === '0 9 * * 1,4') { // Mon & Thu at 9 AM
        next.setHours(9, 0, 0, 0);
        const currentDay = next.getDay();
        let daysToAdd = 0;
        
        if (currentDay === 1) { // Monday
          daysToAdd = next <= now ? 3 : 0; // Next Thursday or today if before 9 AM
        } else if (currentDay === 4) { // Thursday
          daysToAdd = next <= now ? 4 : 0; // Next Monday or today if before 9 AM
        } else if (currentDay < 1) { // Sunday
          daysToAdd = 1; // Next Monday
        } else if (currentDay < 4) { // Tue/Wed
          daysToAdd = 4 - currentDay; // Next Thursday
        } else { // Fri/Sat
          daysToAdd = 8 - currentDay; // Next Monday
        }
        
        next.setDate(next.getDate() + daysToAdd);
      } else {
        // For other patterns, show a generic next hour calculation
        next.setHours(parseInt(hour) || 9, parseInt(minute) || 0, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
      }

      return next.toLocaleString();
    } catch (error) {
      return 'Error calculating next run';
    }
  }
}

module.exports = new ReportSchedulerService();