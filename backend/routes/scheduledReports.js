const express = require('express');
const reportSchedulerService = require('../services/reportSchedulerService');

// Import middleware only when needed
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Test route to verify routing works
router.get('/test', (req, res) => {
  res.json({ message: 'Scheduled reports routing works!', timestamp: new Date() });
});

// Test endpoint to check next scheduled run times
router.get('/test-schedules', async (req, res) => {
  try {
    const reports = await reportSchedulerService.getScheduledReports();
    const scheduleInfo = reports.map(report => ({
      id: report.id,
      name: report.name,
      cron: report.schedule_cron,
      nextRun: reportSchedulerService.getNextRunTime(report.schedule_cron),
      enabled: report.enabled
    }));
    
    res.json({ 
      success: true, 
      schedules: scheduleInfo,
      currentTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get schedule info', details: error.message });
  }
});

// Get all scheduled reports
router.get('/', authenticateToken, async (req, res) => {
  try {
    const reports = await reportSchedulerService.getScheduledReports();
    res.json({
      success: true,
      reports,
      count: reports.length
    });
  } catch (error) {
    console.error('Get scheduled reports error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled reports' });
  }
});

// Add new scheduled report
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      description,
      reportType,
      scheduleCron,
      recipients,
      parameters,
      enabled
    } = req.body;

    // Validate required fields
    if (!name || !reportType || !scheduleCron || !recipients) {
      return res.status(400).json({
        error: 'Name, report type, schedule, and recipients are required'
      });
    }

    // Validate cron expression (basic validation)
    const cronPattern = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
    if (!cronPattern.test(scheduleCron)) {
      return res.status(400).json({
        error: 'Invalid cron expression format'
      });
    }

    // Validate recipients (basic email format check)
    const emailList = recipients.split(',').map(email => email.trim());
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailList.filter(email => !emailPattern.test(email));
    
    if (invalidEmails.length > 0) {
      return res.status(400).json({
        error: `Invalid email addresses: ${invalidEmails.join(', ')}`
      });
    }

    const result = await reportSchedulerService.addScheduledReport({
      name,
      description,
      reportType,
      scheduleCron,
      recipients,
      parameters,
      enabled
    });

    res.status(201).json({
      success: true,
      message: `Scheduled report "${name}" created successfully`,
      id: result.id
    });

  } catch (error) {
    console.error('Add scheduled report error:', error);
    res.status(500).json({ error: 'Failed to create scheduled report' });
  }
});

// Update scheduled report
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Implementation would update the scheduled report
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Scheduled report update functionality coming soon'
    });

  } catch (error) {
    console.error('Update scheduled report error:', error);
    res.status(500).json({ error: 'Failed to update scheduled report' });
  }
});

// Delete scheduled report
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Implementation would delete the scheduled report and stop the cron job
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Scheduled report deletion functionality coming soon'
    });

  } catch (error) {
    console.error('Delete scheduled report error:', error);
    res.status(500).json({ error: 'Failed to delete scheduled report' });
  }
});

// Test report generation (for immediate execution)
router.post('/test/:reportType', authenticateToken, async (req, res) => {
  try {
    const { reportType } = req.params;
    const { recipients } = req.body;

    if (!recipients) {
      return res.status(400).json({ error: 'Recipients are required for test report' });
    }

    // Generate test report
    const reportData = await reportSchedulerService.generateReportData(reportType, null);
    const pdfPath = await reportSchedulerService.generateReportPDF(
      reportData,
      reportType,
      `Test_${reportType}`
    );

    // Send test email
    await reportSchedulerService.sendReportEmail(
      recipients,
      `Test ${reportType}`,
      reportType,
      pdfPath,
      reportData
    );

    res.json({
      success: true,
      message: `Test ${reportType} report generated and sent successfully`
    });

  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ 
      error: `Failed to generate test report: ${error.message}` 
    });
  }
});

// Get available report types (public endpoint for frontend)
router.get('/types', async (req, res) => {
  try {
    const reportTypes = [
      {
        id: 'daily_summary',
        name: 'Daily Summary',
        description: 'Daily overview of PPE requests, approvals, and usage statistics',
        recommendedSchedule: '0 9 * * *', // 9 AM daily
        category: 'Operations'
      },
      {
        id: 'weekly_analytics',
        name: 'Weekly Analytics',
        description: 'Weekly trends and analytics for PPE usage and patterns',
        recommendedSchedule: '0 9 * * 1', // 9 AM every Monday
        category: 'Analytics'
      },
      {
        id: 'monthly_compliance',
        name: 'Monthly Compliance',
        description: 'Monthly compliance report for safety regulations and audit trails',
        recommendedSchedule: '0 9 1 * *', // 9 AM on 1st of each month
        category: 'Compliance'
      },
      {
        id: 'inventory_status',
        name: 'Inventory Status',
        description: 'Current inventory levels, low stock alerts, and replenishment needs',
        recommendedSchedule: '0 8 * * 1,4', // 8 AM on Monday and Thursday
        category: 'Inventory'
      },
      {
        id: 'staff_usage',
        name: 'Staff Usage Report',
        description: 'Individual staff PPE usage patterns and compliance tracking',
        recommendedSchedule: '0 9 1 * *', // 9 AM on 1st of each month
        category: 'HR'
      }
    ];

    res.json({
      success: true,
      reportTypes,
      count: reportTypes.length
    });

  } catch (error) {
    console.error('Get report types error:', error);
    res.status(500).json({ error: 'Failed to fetch report types' });
  }
});

// Get cron schedule presets (public endpoint for frontend)
router.get('/schedules', async (req, res) => {
  try {
    const schedulePresets = [
      {
        id: 'daily_9am',
        name: 'Daily at 9:00 AM',
        cron: '0 9 * * *',
        description: 'Every day at 9:00 AM'
      },
      {
        id: 'weekly_monday',
        name: 'Weekly on Monday',
        cron: '0 9 * * 1',
        description: 'Every Monday at 9:00 AM'
      },
      {
        id: 'monthly_1st',
        name: 'Monthly on 1st',
        cron: '0 9 1 * *',
        description: '1st of every month at 9:00 AM'
      },
      {
        id: 'twice_weekly',
        name: 'Twice Weekly',
        cron: '0 9 * * 1,4',
        description: 'Monday and Thursday at 9:00 AM'
      },
      {
        id: 'daily_evening',
        name: 'Daily at 6:00 PM',
        cron: '0 18 * * *',
        description: 'Every day at 6:00 PM'
      }
    ];

    res.json({
      success: true,
      schedulePresets,
      count: schedulePresets.length
    });

  } catch (error) {
    console.error('Get schedule presets error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule presets' });
  }
});

module.exports = router;