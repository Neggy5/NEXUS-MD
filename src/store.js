const fs = require('fs');
const path = require('path');
const { ANTICALL_ENABLED, DEFAULT_PREFIX, DEFAULT_MENU_STYLE } = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const SETTINGS_FILE = path.join(DATA_DIR, 'group-settings.json');

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
} catch {
  settings = {};
}

let saveTimer = null;
function persist() {
  // Debounce writes so a burst of toggles doesn't hammer the disk.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), (err) => {
      if (err) console.error('settings save failed:', err.message);
    });
  }, 250);
}

const GROUP_DEFAULTS = {
  antidelete: true,
  antiedit: true,
  antisticker: false,
  antigroupmention: false,
  antilink: false,

  // Welcome / goodbye are group-scoped toggles.
  // They must exist in the defaults; otherwise `undefined` is falsy and
  // the participant-update handler will silently return even after the
  // command files are loaded.
  welcome: false,
  goodbye: false,
  welcomeMessage: '',
  goodbyeMessage: '',
};

function getGroupSettings(jid) {
  if (!settings[jid]) settings[jid] = { ...GROUP_DEFAULTS };
  return settings[jid];
}

function setGroupSetting(jid, key, value) {
  const s = getGroupSettings(jid);
  s[key] = value;
  persist();
}

// ---- Account-level (per-session) toggles, e.g. mode, anticall, autoreact ----
// Keyed by sessionId so each linked account has its own settings — this used
// to be a single flat object shared by every user, which broke multi-user use
// and also crashed `.mode` (called as getGlobalSetting(sessionId, key) against
// a function that only took one argument).
const ACCOUNT_SETTINGS_FILE = path.join(DATA_DIR, 'account-settings.json');
let accountSettings = {};
try {
  accountSettings = JSON.parse(fs.readFileSync(ACCOUNT_SETTINGS_FILE, 'utf8'));
} catch {
  accountSettings = {};
}

let accountSaveTimer = null;
function persistAccount() {
  clearTimeout(accountSaveTimer);
  accountSaveTimer = setTimeout(() => {
    fs.writeFile(ACCOUNT_SETTINGS_FILE, JSON.stringify(accountSettings, null, 2), (err) => {
      if (err) console.error('account settings save failed:', err.message);
    });
  }, 250);
}

const ACCOUNT_DEFAULTS = {
  mode: 'public',
  anticall: ANTICALL_ENABLED,
  autoreact: false,
  prefix: DEFAULT_PREFIX,
  menuStyle: DEFAULT_MENU_STYLE,
};

function getAccountSettings(sessionId) {
  if (!accountSettings[sessionId]) accountSettings[sessionId] = { ...ACCOUNT_DEFAULTS };
  return accountSettings[sessionId];
}

function getGlobalSetting(sessionId, key) {
  const s = getAccountSettings(sessionId);
  return key ? s[key] : s;
}

function setGlobalSetting(sessionId, key, value) {
  const s = getAccountSettings(sessionId);
  s[key] = value;
  persistAccount();
}

// ---- Short-lived cache of recent messages, keyed by message id ----
// Used only to show what a deleted/edited message said. Capped and cleared
// on a rolling basis so it never grows into a permanent message log.
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
