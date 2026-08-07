const fs = require('fs');
const path = require('path');
const { ANTICALL_ENABLED } = require('./config');

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
  autoreact: false,
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

// ---- Global (account-level) toggles, e.g. anticall ----
const globalSettings = { anticall: ANTICALL_ENABLED };
function getGlobalSetting(key) {
  return globalSettings[key];
}
function setGlobalSetting(key, value) {
  globalSettings[key] = value;
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
