const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'income_engine.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

function initialize() {
  db.exec(`
    -- Track all earnings
    CREATE TABLE IF NOT EXISTS earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'pending',
      description TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_out BOOLEAN DEFAULT 0
    );

    -- Track content created
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT,
      url TEXT,
      status TEXT DEFAULT 'draft',
      views INTEGER DEFAULT 0,
      earnings REAL DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Track tasks completed
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engine TEXT NOT NULL,
      task_type TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      earnings REAL DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    -- System logs
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      engine TEXT,
      message TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Withdrawal history
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      amount REAL NOT NULL,
      destination TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      transaction_id TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    -- Daily stats
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_earned REAL DEFAULT 0,
      articles_written INTEGER DEFAULT 0,
      designs_created INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      api_calls_made INTEGER DEFAULT 0,
      api_cost REAL DEFAULT 0
    );

    -- Engine configuration
    CREATE TABLE IF NOT EXISTS engine_config (
      engine TEXT PRIMARY KEY,
      enabled BOOLEAN DEFAULT 1,
      config TEXT,
      last_run DATETIME,
      total_earned REAL DEFAULT 0
    );
  `);

  // Insert default engine configs
  const engines = [
    'content-writer', 'affiliate-blog', 'micro-tasks',
    'print-on-demand', 'social-media', 'freelance-bidder'
  ];

  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO engine_config (engine, enabled, config) VALUES (?, 1, '{}')
  `);

  engines.forEach(e => insertConfig.run(e));

  console.log('✅ Database initialized');
}

// Helper functions
const dbHelpers = {
  logEarning(source, amount, description, metadata = {}) {
    return db.prepare(`
      INSERT INTO earnings (source, amount, description, metadata) 
      VALUES (?, ?, ?, ?)
    `).run(source, amount, description, JSON.stringify(metadata));
  },

  logContent(type, platform, title, url, metadata = {}) {
    return db.prepare(`
      INSERT INTO content (type, platform, title, url, metadata) 
      VALUES (?, ?, ?, ?, ?)
    `).run(type, platform, title, url, JSON.stringify(metadata));
  },

  logTask(engine, taskType, status, result, earnings = 0) {
    return db.prepare(`
      INSERT INTO tasks (engine, task_type, status, result, earnings, completed_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(engine, taskType, status, result, earnings);
  },

  log(level, engine, message, data = {}) {
    return db.prepare(`
      INSERT INTO logs (level, engine, message, data) VALUES (?, ?, ?, ?)
    `).run(level, engine, message, JSON.stringify(data));
  },

  getTotalEarnings() {
    return db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM earnings').get().total;
  },

  getTodayEarnings() {
    return db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM earnings 
      WHERE date(created_at) = date('now')
    `).get().total;
  },

  getEarningsBySource() {
    return db.prepare(`
      SELECT source, SUM(amount) as total, COUNT(*) as count 
      FROM earnings GROUP BY source ORDER BY total DESC
    `).all();
  },

  getRecentEarnings(limit = 50) {
    return db.prepare(`
      SELECT * FROM earnings ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  getRecentLogs(limit = 100) {
    return db.prepare(`
      SELECT * FROM logs ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  getEngineConfigs() {
    return db.prepare('SELECT * FROM engine_config').all();
  },

  getContentStats() {
    return db.prepare(`
      SELECT platform, COUNT(*) as count, SUM(views) as total_views, 
             SUM(earnings) as total_earnings
      FROM content GROUP BY platform
    `).all();
  },

  getDailyEarnings(days = 30) {
    return db.prepare(`
      SELECT date(created_at) as date, SUM(amount) as total 
      FROM earnings 
      WHERE created_at >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at) ORDER BY date ASC
    `).all(days);
  },

  getWithdrawals() {
    return db.prepare('SELECT * FROM withdrawals ORDER BY requested_at DESC').all();
  },

  updateEngineRun(engine, earned = 0) {
    return db.prepare(`
      UPDATE engine_config SET last_run = CURRENT_TIMESTAMP, 
      total_earned = total_earned + ? WHERE engine = ?
    `).run(earned, engine);
  },

  toggleEngine(engine, enabled) {
    return db.prepare('UPDATE engine_config SET enabled = ? WHERE engine = ?').run(enabled ? 1 : 0, engine);
  }
};

module.exports = { db, initialize, ...dbHelpers };
