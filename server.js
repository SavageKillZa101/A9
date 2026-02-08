require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const cors = require('cors');
const database = require('./database');

// Income Engines
const ContentWriter = require('./income-engines/content-writer');
const AffiliateBlog = require('./income-engines/affiliate-blog');
const MicroTasks = require('./income-engines/micro-tasks');
const PrintOnDemand = require('./income-engines/print-on-demand');
const SocialMediaBot = require('./income-engines/social-media-bot');
const FreelanceBidder = require('./income-engines/freelance-bidder');

// Payment
const PayPalManager = require('./payment/paypal');
const CashAppManager = require('./payment/cashapp');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard')));

// Initialize
database.initialize();

// Engine instances
const engines = {
  'content-writer': new ContentWriter(),
  'affiliate-blog': new AffiliateBlog(),
  'micro-tasks': new MicroTasks(),
  'print-on-demand': new PrintOnDemand(),
  'social-media': new SocialMediaBot(),
  'freelance-bidder': new FreelanceBidder()
};

const paypal = new PayPalManager();
const cashapp = new CashAppManager();

// ========== CRON JOBS ==========

// Content Writer: Every 6 hours
cron.schedule('0 */6 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('content-writer');
  if (config?.enabled) {
    console.log('🖊️  Running Content Writer...');
    await engines['content-writer'].run();
  }
});

// Affiliate Blog: Every 8 hours
cron.schedule('0 */8 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('affiliate-blog');
  if (config?.enabled) {
    console.log('🔗 Running Affiliate Blog...');
    await engines['affiliate-blog'].run();
  }
});

// Micro Tasks: Every 4 hours
cron.schedule('0 */4 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('micro-tasks');
  if (config?.enabled) {
    console.log('📋 Running Micro Tasks...');
    await engines['micro-tasks'].run();
  }
});

// Print on Demand: Twice daily
cron.schedule('0 9,21 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('print-on-demand');
  if (config?.enabled) {
    console.log('🎨 Running Print on Demand...');
    await engines['print-on-demand'].run();
  }
});

// Social Media: 3 times daily
cron.schedule('0 8,14,20 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('social-media');
  if (config?.enabled) {
    console.log('📱 Running Social Media...');
    await engines['social-media'].run();
  }
});

// Freelance Bidder: Every 12 hours
cron.schedule('0 */12 * * *', async () => {
  const config = database.db.prepare('SELECT * FROM engine_config WHERE engine = ?').get('freelance-bidder');
  if (config?.enabled) {
    console.log('💼 Running Freelance Bidder...');
    await engines['freelance-bidder'].run();
  }
});

// Daily summary email: 9 PM
cron.schedule('0 21 * * *', async () => {
  await sendDailySummary();
});

// ========== API ROUTES ==========

// Dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    const totalEarnings = database.getTotalEarnings();
    const todayEarnings = database.getTodayEarnings();
    const earningsBySource = database.getEarningsBySource();
    const dailyEarnings = database.getDailyEarnings(30);
    const recentEarnings = database.getRecentEarnings(20);
    const engineConfigs = database.getEngineConfigs();
    const contentStats = database.getContentStats();
    const withdrawals = database.getWithdrawals();

    // Calculate projections
    const last7Days = database.getDailyEarnings(7);
    const avgDaily = last7Days.length > 0
      ? last7Days.reduce((sum, d) => sum + d.total, 0) / last7Days.length
      : 0;

    let paypalBalance = { available: 0, pending: 0 };
    try {
      paypalBalance = await paypal.getBalance();
    } catch (e) { }

    res.json({
      overview: {
        totalEarnings,
        todayEarnings,
        weeklyProjection: avgDaily * 7,
        monthlyProjection: avgDaily * 30,
        yearlyProjection: avgDaily * 365
      },
      earningsBySource,
      dailyEarnings,
      recentEarnings,
      engines: engineConfigs,
      contentStats,
      withdrawals,
      balances: {
        paypal: paypalBalance,
        cashapp: { cashtag: process.env.CASHAPP_CASHTAG }
      },
      systemStatus: {
        uptime: process.uptime(),
        lastUpdated: new Date().toISOString(),
        activeEngines: engineConfigs.filter(e => e.enabled).length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Engine control
app.post('/api/engine/:name/toggle', (req, res) => {
  const { name } = req.params;
  const { enabled } = req.body;
  database.toggleEngine(name, enabled);
  res.json({ success: true, engine: name, enabled });
});

// Manual engine run
app.post('/api/engine/:name/run', async (req, res) => {
  const { name } = req.params;
  if (!engines[name]) return res.status(404).json({ error: 'Engine not found' });

  try {
    const earned = await engines[name].run();
    res.json({ success: true, engine: name, earned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logs
app.get('/api/logs', (req, res) => {
  const { limit = 100, level, engine } = req.query;
  let query = 'SELECT * FROM logs WHERE 1=1';
  const params = [];

  if (level) { query += ' AND level = ?'; params.push(level); }
  if (engine) { query += ' AND engine = ?'; params.push(engine); }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const logs = database.db.prepare(query).all(...params);
  res.json(logs);
});

// Earnings
app.get('/api/earnings', (req, res) => {
  const { days = 30 } = req.query;
  const earnings = database.getDailyEarnings(parseInt(days));
  const bySource = database.getEarningsBySource();
  const recent = database.getRecentEarnings(50);
  res.json({ daily: earnings, bySource, recent });
});

// Withdrawal
app.post('/api/withdraw', async (req, res) => {
  const { amount, destination } = req.body; // destination: 'paypal' or 'cashapp'

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const totalEarnings = database.getTotalEarnings();
  const totalWithdrawn = database.db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status != 'failed'"
  ).get().total;

  const available = totalEarnings - totalWithdrawn;

  if (amount > available) {
    return res.status(400).json({ error: `Insufficient funds. Available: $${available.toFixed(2)}` });
  }

  try {
    let result;
    if (destination === 'paypal') {
      result = await paypal.withdraw(amount, process.env.PAYPAL_EMAIL);
    } else if (destination === 'cashapp') {
      result = await cashapp.requestWithdrawal(amount);
    } else {
      return res.status(400).json({ error: 'Invalid destination. Use "paypal" or "cashapp"' });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Content
app.get('/api/content', (req, res) => {
  const content = database.db.prepare(
    'SELECT * FROM content ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json(content);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    engines: Object.keys(engines).length,
    timestamp: new Date().toISOString()
  });
});

// 
