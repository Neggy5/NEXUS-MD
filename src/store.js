/**
 * store.js — SQLite-backed persistence (replaces flat JSON files).
 *
 * Railway note: mount a Volume at /data so this file survives redeploys.
 * Add  DATABASE_PATH=/data/nexus.db  to your Railway env vars (optional —
 * the default is already /data/nexus.db).
 */

const path = require('path');
const { ANTICALL_ENABLED, DEFAULT_PREFIX, DEFAULT_MENU_STYLE } = require('./config');

// ---- Lazy-load better-sqlite3 so the import error is readable ----
let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error(
    '[store] Failed to load better-sqlite3:\n' +
    `        ${err.message}\n` +
    '        If this says "Cannot find module", run:  npm install\n' +
    '        If this mentions an ELF header / architecture / bindings error, the\n' +
    '        native addon was built for a different platform than it is running on —\n' +
    '        on Railway this usually means a stale build cache: redeploy with\n' +
    '        "Clear build cache" (or bump a trivial change) to force a clean rebuild.'
  );
  process.exit(1);
}

const DB_PATH = process.env.DATABASE_PATH || path.join('/data', 'nexus.db');

// Ensure /data directory exists (Railway volume or local dev)
const fs = require('fs');
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for concurrent reads and safer writes
db.pragma('journal_mode = WAL');

// ---- Schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS group_settings (
    jid       TEXT PRIMARY KEY,
    settings  TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS account_settings (
    session_id  TEXT PRIMARY KEY,
    settings    TEXT NOT NULL DEFAULT '{}'
  );
`);

// ---- Prepared statements ----
const stmts = {
  getGroup:    db.prepare('SELECT settings FROM group_settings WHERE jid = ?'),
  setGroup:    db.prepare('INSERT INTO group_settings (jid, settings) VALUES (?, ?) ON CONFLICT(jid) DO UPDATE SET settings = excluded.settings'),
  getAccount:  db.prepare('SELECT settings FROM account_settings WHERE session_id = ?'),
  setAccount:  db.prepare('INSERT INTO account_settings (session_id, settings) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET settings = excluded.settings'),
};

// ---- GROUP DEFAULTS — antidelete & antiedit default OFF (user must enable) ----
const GROUP_DEFAULTS = {
  antidelete:        false,
  antiedit:          false,
  antisticker:       false,
  antigroupmention:  false,
  antilink:          false,
};

function getGroupSettings(jid) {
  const row = stmts.getGroup.get(jid);
  const saved = row ? JSON.parse(row.settings) : {};
  return { ...GROUP_DEFAULTS, ...saved };
}

function setGroupSetting(jid, key, value) {
  const current = getGroupSettings(jid);
  current[key] = value;
  stmts.setGroup.run(jid, JSON.stringify(current));
}

// ---- ACCOUNT DEFAULTS ----
const ACCOUNT_DEFAULTS = {
  mode:      'public',
  anticall:  ANTICALL_ENABLED,
  autoreact: false,
  prefix:    DEFAULT_PREFIX,
  menuStyle: DEFAULT_MENU_STYLE,
};

function getAccountSettings(sessionId) {
  const row = stmts.getAccount.get(sessionId);
  const saved = row ? JSON.parse(row.settings) : {};
  return { ...ACCOUNT_DEFAULTS, ...saved };
}

function getGlobalSetting(sessionId, key) {
  const s = getAccountSettings(sessionId);
  return key ? s[key] : s;
}

function setGlobalSetting(sessionId, key, value) {
  const current = getAccountSettings(sessionId);
  current[key] = value;
  stmts.setAccount.run(sessionId, JSON.stringify(current));
}

// ---- Short-lived in-memory message cache (antidelete / antiedit) ----
const MAX_CACHE = 1500;
const messageCache = new Map();

function cacheMessage(id, data) {
  if (messageCache.size >= MAX_CACHE) {
    const oldestKey = messageCache.keys().next().value;
    messageCache.delete(oldestKey);
  }
  messageCache.set(id, data);
}

function getCachedMessage(id) {
  return messageCache.get(id);
}

module.exports = {
  getGroupSettings,
  setGroupSetting,
  getGlobalSetting,
  setGlobalSetting,
  cacheMessage,
  getCachedMessage,
};
