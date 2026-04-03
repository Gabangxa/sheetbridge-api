const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'sheetbridge.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    api_key     TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    tier        TEXT NOT NULL DEFAULT 'free',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'sheets',
    name           TEXT NOT NULL,
    spreadsheet_id TEXT NOT NULL,
    sheet_name     TEXT NOT NULL DEFAULT 'Sheet1',
    access_token   TEXT,
    refresh_token  TEXT NOT NULL,
    token_expiry   INTEGER,
    connected_at   TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS usage (
    api_key    TEXT NOT NULL,
    date       TEXT NOT NULL,
    call_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (api_key, date)
  );
`);

// Tier limits: max records fetched/created per day
const TIER_LIMITS = { free: 500, starter: 20000, pro: 100000, scale: 500000 };

// Rate limits: max requests per minute
const RATE_LIMITS = { free: 200, starter: 200, pro: 2000, scale: 2000 };

function generateId()     { return crypto.randomBytes(8).toString('hex'); }
function generateApiKey() { return 'sk_live_' + crypto.randomBytes(24).toString('hex'); }

// ─── Projects ────────────────────────────────────────────
function createProject(name) {
  const id = generateId();
  const api_key = generateApiKey();
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, api_key, name, tier, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, api_key, name, 'free', created_at);
  return { id, api_key, name, tier: 'free', created_at };
}

function getProjectByApiKey(api_key) {
  return db.prepare('SELECT * FROM projects WHERE api_key = ?').get(api_key) || null;
}

// ─── Sources ─────────────────────────────────────────────
function createSource(projectId, { name, spreadsheetId, sheetName, accessToken, refreshToken, tokenExpiry }) {
  const id = generateId();
  const connected_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO sources
      (id, project_id, type, name, spreadsheet_id, sheet_name,
       access_token, refresh_token, token_expiry, connected_at, status)
    VALUES (?, ?, 'sheets', ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(id, projectId, name, spreadsheetId, sheetName || 'Sheet1',
         accessToken || null, refreshToken, tokenExpiry || null, connected_at);
  return getSourceById(id);
}

function getSourceById(id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) || null;
}

function getSourcesByProjectId(projectId) {
  return db.prepare('SELECT * FROM sources WHERE project_id = ?').all(projectId);
}

function updateSourceTokens(id, accessToken, tokenExpiry) {
  db.prepare('UPDATE sources SET access_token = ?, token_expiry = ? WHERE id = ?')
    .run(accessToken, tokenExpiry, id);
}

// ─── Usage metering ──────────────────────────────────────
function incrementUsage(api_key) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO usage (api_key, date, call_count) VALUES (?, ?, 1)
    ON CONFLICT(api_key, date) DO UPDATE SET call_count = call_count + 1
  `).run(api_key, today);
}

function getTodayUsage(api_key) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT call_count FROM usage WHERE api_key = ? AND date = ?').get(api_key, today);
  return row ? row.call_count : 0;
}

// ─── Plan management ─────────────────────────────────
function activatePlan(projectId, tier) {
  db.prepare('UPDATE projects SET tier = ? WHERE id = ?').run(tier, projectId);
}

module.exports = {
  createProject, getProjectByApiKey,
  activatePlan,
  createSource, getSourceById, getSourcesByProjectId, updateSourceTokens,
  incrementUsage, getTodayUsage,
  TIER_LIMITS, RATE_LIMITS,
};
