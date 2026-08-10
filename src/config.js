// Links the bot auto-follows / requires users to join.
// Override via env vars if you ever want to change them without editing code.

const CHANNEL_LINK = process.env.FORCE_CHANNEL_LINK || 'https://whatsapp.com/channel/0029VbCoHP4Id7nGRtKYuA0A';
const GROUP_LINK = process.env.FORCE_GROUP_LINK || 'https://chat.whatsapp.com/GMHYNRFJhyiFhM5h5tE0FX?s=cl&p=a&ilr=0';

// FORCE_JOIN=false disables the group-membership gate entirely (channel auto-follow still happens).
const FORCE_JOIN_ENABLED = process.env.FORCE_JOIN !== 'false';

// Optional image shown as the menu's thumbnail. Leave unset to fall back to a text-only menu.
const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || 'https://files.catbox.moe/bev5nx.png';

// Display name used in the "forwarded from channel" context tag on menu/ping.
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'NEXUS-MD Updates';

// Automatic call rejection — can also be flipped at runtime by the owner with .anticall on/off
const ANTICALL_ENABLED = process.env.ANTICALL !== 'false';

// Default command prefix — can be changed per-account at runtime with .setprefix
const DEFAULT_PREFIX = process.env.PREFIX || '.';

// Default menu layout — can be changed per-account at runtime with .setmenustyle
const DEFAULT_MENU_STYLE = process.env.MENU_STYLE || 'classic';

// Telegram pairing bot. Optional — leave unset and only web pairing runs.
// Create a bot with @BotFather on Telegram to get a token.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8607752844:AAE7C42gGlm5_FAumLN7uRL6xJfM5s8VAMU';
// Telegram access gate — intentionally kept in source, not .env.
// Users must join both groups and the channel before using the Telegram bot.
const TELEGRAM_JOIN_GROUP_1 = '@zukky445';
const TELEGRAM_JOIN_CHANNEL = '@zukoxmd1';
const TELEGRAM_JOIN_GROUP_2 = '@zukoxmd';
const TELEGRAM_JOIN_GROUP_1_LINK = 'https://t.me/zukoxmd';
const TELEGRAM_JOIN_CHANNEL_LINK = 'https://t.me/zukoxmd1';
const TELEGRAM_JOIN_GROUP_2_LINK = 'https://t.me/zukky445';
const TELEGRAM_FORCE_JOIN = true;
// Set the owner/admin Telegram ID here after running /adminid.
const TELEGRAM_ADMIN_ID = '8361355527';

function extractChannelCode(link) {
  const m = link.match(/channel\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function extractGroupCode(link) {
  const m = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

module.exports = {
  CHANNEL_LINK,
  GROUP_LINK,
  FORCE_JOIN_ENABLED,
  MENU_IMAGE_URL,
  CHANNEL_NAME,
  ANTICALL_ENABLED,
  DEFAULT_PREFIX,
  DEFAULT_MENU_STYLE,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_JOIN_GROUP_1,
  TELEGRAM_JOIN_GROUP_2,
  TELEGRAM_JOIN_CHANNEL,
  TELEGRAM_JOIN_GROUP_1_LINK,
  TELEGRAM_JOIN_GROUP_2_LINK,
  TELEGRAM_JOIN_CHANNEL_LINK,
  TELEGRAM_FORCE_JOIN,
  TELEGRAM_ADMIN_ID,
  CHANNEL_CODE: extractChannelCode(CHANNEL_LINK),
  GROUP_CODE: extractGroupCode(GROUP_LINK),
};
