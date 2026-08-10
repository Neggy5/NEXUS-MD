const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { startSession, getStatus, sanitizeId } = require('./sessionManager');
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_JOIN_GROUP_1,
  TELEGRAM_JOIN_GROUP_2,
  TELEGRAM_JOIN_CHANNEL,
  TELEGRAM_JOIN_GROUP_1_LINK,
  TELEGRAM_JOIN_GROUP_2_LINK,
  TELEGRAM_JOIN_CHANNEL_LINK,
  TELEGRAM_FORCE_JOIN,
  TELEGRAM_ADMIN_ID,
  CHANNEL_LINK,
  MENU_IMAGE_URL,
} = require('./config');

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

function isAdmin(msg) {
  return Boolean(TELEGRAM_ADMIN_ID) && String(msg.from?.id) === String(TELEGRAM_ADMIN_ID);
}

async function isTelegramMember(bot, chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
  } catch (err) {
    console.error(`[telegram] membership check failed for ${chatId}:`, err.message);
    return false;
  }
}

function membershipKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '👥 JOIN GROUP 1', url: TELEGRAM_JOIN_GROUP_1_LINK, style: 'primary' }],
      [{ text: '📢 JOIN CHANNEL', url: TELEGRAM_JOIN_CHANNEL_LINK, style: 'primary' }],
      [{ text: '👥 JOIN GROUP 2', url: TELEGRAM_JOIN_GROUP_2_LINK, style: 'primary' }],
      [{ text: '✅ CHECK MEMBERSHIP', callback_data: 'check_membership', style: 'success' }],
    ],
  };
}

function membershipMessage(missing = []) {
  const status = missing.length
    ? `\n\nStill missing: ${missing.map((x) => `*${x}*`).join(', ')}.`
    : '';
  return (
    '🔒 *NEXUS-MD ACCESS REQUIRED*\n\n' +
    'Join both groups and the channel below to unlock the bot.\n' +
    'After joining all three, tap *CHECK MEMBERSHIP*.' +
    status
  );
}

async function checkTelegramMembership(bot, msg) {
  if (!TELEGRAM_FORCE_JOIN) return { ok: true };

  const checks = [
    ['GROUP 1', TELEGRAM_JOIN_GROUP_1],
    ['CHANNEL', TELEGRAM_JOIN_CHANNEL],
    ['GROUP 2', TELEGRAM_JOIN_GROUP_2],
  ];

  const missing = [];
  for (const [label, chat] of checks) {
    if (!(await isTelegramMember(bot, chat, msg.from.id))) missing.push(label);
  }

  if (missing.length) {
    return {
      ok: false,
      missing,
      message: membershipMessage(missing),
      reply_markup: membershipKeyboard(),
    };
  }
  return { ok: true };
}

async function requireTelegramMembership(bot, msg) {
  const result = await checkTelegramMembership(bot, msg);
  if (!result.ok) {
    await sendAccessPrompt(bot, msg.chat.id, result);
  }
  return result.ok;
}

function resolveMenuImage() {
  if (!MENU_IMAGE_URL) return null;
  if (/^https?:\/\//i.test(MENU_IMAGE_URL)) return MENU_IMAGE_URL;
  const absolute = path.isAbsolute(MENU_IMAGE_URL)
    ? MENU_IMAGE_URL
    : path.resolve(process.cwd(), MENU_IMAGE_URL);
  if (fs.existsSync(absolute)) return absolute;
  return null;
}

async function sendAccessPrompt(bot, chatId, gate) {
  const image = resolveMenuImage();
  const options = {
    parse_mode: 'Markdown',
    reply_markup: gate.reply_markup,
    disable_web_page_preview: true,
  };

  if (image) {
    try {
      await bot.sendPhoto(chatId, image, { caption: gate.message, ...options });
      return;
    } catch (err) {
      console.error('[telegram] access image send failed, falling back to text:', err.message);
    }
  }
  await bot.sendMessage(chatId, gate.message, options);
}

function deploymentButtons() {
  return {
    inline_keyboard: [
      [{ text: '📢 FOLLOW CHANNEL', url: CHANNEL_LINK, style: 'primary' }],
    ],
  };
}

function watchForLink(bot, chatId, sessionId) {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const { status } = getStatus(sessionId);

    if (status === 'connected') {
      clearInterval(interval);
      bot.sendMessage(chatId, '✅ *Deployment successful!* NEXUS-MD is now running for this account. Send `.menu` in WhatsApp.', {
        parse_mode: 'Markdown',
        reply_markup: deploymentButtons(),
      });
      return;
    }

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      clearInterval(interval);
      bot.sendMessage(chatId, "⌛ Still haven't seen a connection for that code. It may have expired — run /pair again to get a fresh one.");
    }
  }, POLL_INTERVAL_MS);
}

function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN not set — Telegram pairing disabled (web pairing still works).');
    return null;
  }

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  bot.on('polling_error', (err) => console.error('[telegram] polling error:', err.message));

  bot.onText(/^\/start$/, async (msg) => {
    const gate = await checkTelegramMembership(bot, msg);
    if (!gate.ok) return sendAccessPrompt(bot, msg.chat.id, gate);

    const welcome = [
      '⚡ *NEXUS-MD* — link your WhatsApp right here, no QR needed.',
      '',
      '`/pair <number>` — e.g. `/pair 15551234567`',
      '`/status <number>` — check whether a number is currently linked',
      '`/ping` — bot latency',
      '`/runtime` — bot uptime',
      '`/listpair` — admin session list',
      '`/adminid` — show your Telegram ID',
      '',
      'You can also pair from the website — either way works, and both stay in sync.',
    ].join('\n');

    const image = resolveMenuImage();
    if (image) {
      try {
        return await bot.sendPhoto(msg.chat.id, image, { caption: welcome, parse_mode: 'Markdown' });
      } catch (err) {
        console.error('[telegram] start image send failed:', err.message);
      }
    }
    return bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/pair(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await requireTelegramMembership(bot, msg))) return;
    const raw = (match[1] || '').trim();
    const phone = raw.replace(/[^0-9]/g, '');

    if (!phone || phone.length < 7 || phone.length > 15) {
      return bot.sendMessage(chatId, 'Usage: `/pair <number>` — country code + number, digits only. Example: `/pair 15551234567`', { parse_mode: 'Markdown' });
    }

    try {
      await bot.sendMessage(chatId, '🚀 Requesting a pairing code…');
      const result = await startSession(phone);
      const sessionId = result.sessionId || sanitizeId(phone);

      if (result.alreadyLinked) {
        return bot.sendMessage(chatId, '✅ *Deployment successful!* Your WhatsApp account is already linked. Send `.menu` in WhatsApp to confirm.', {
          parse_mode: 'Markdown',
          reply_markup: deploymentButtons(),
        });
      }

      await bot.sendMessage(chatId, [
        `Your pairing code: *${result.pairingCode}*`,
        '',
        'On your phone: *WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead*, then enter this code.',
        '',
        "I'll message you here once it's linked.",
      ].join('\n'), { parse_mode: 'Markdown' });

      watchForLink(bot, chatId, sessionId);
    } catch (err) {
      console.error('[telegram] /pair failed:', err.message);
      bot.sendMessage(chatId, `Couldn't generate a pairing code (${err.message}). Try again in a moment.`);
    }
  });

  bot.onText(/^\/status(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await requireTelegramMembership(bot, msg))) return;
    const raw = (match[1] || '').trim();
    const phone = raw.replace(/[^0-9]/g, '');
    if (!phone) return bot.sendMessage(chatId, 'Usage: `/status <number>`', { parse_mode: 'Markdown' });

    const sessionId = sanitizeId(phone);
    const { status } = getStatus(sessionId);
    const labels = {
      connected: '🟢 Connected',
      pairing: '🟡 Waiting for you to enter the code',
      disconnected: '🔴 Disconnected',
      none: '⚪ No session found for that number — run /pair first',
    };
    bot.sendMessage(chatId, labels[status] || `Status: ${status}`);
  });

  bot.on('callback_query', async (query) => {
    if (query.data !== 'check_membership') return;
    const msg = query.message;
    const gate = await checkTelegramMembership(bot, {
      from: query.from,
      chat: msg.chat,
    });

    await bot.answerCallbackQuery(query.id, {
      text: gate.ok ? '✅ Membership confirmed.' : '❌ Join all three first.',
    });

    if (gate.ok) {
      await bot.sendMessage(msg.chat.id, '✅ *Access granted!* You can now use /pair, /status, /ping, /runtime and /listpair.', { parse_mode: 'Markdown' });
    } else {
      await sendAccessPrompt(bot, msg.chat.id, gate);
    }
  });

  bot.onText(/^\/ping$/, async (msg) => {
    if (!(await requireTelegramMembership(bot, msg))) return;
    const start = Date.now();
    const sent = await bot.sendMessage(msg.chat.id, '⚡ Pinging…');
    await bot.editMessageText(`🏓 *Pong!*\n⚡ Telegram latency: \`${Date.now() - start}ms\``, {
      chat_id: msg.chat.id,
      message_id: sent.message_id,
      parse_mode: 'Markdown',
    }).catch(() => {});
  });

  bot.onText(/^\/runtime$/, async (msg) => {
    if (!(await requireTelegramMembership(bot, msg))) return;
    const ms = Date.now() - global.__NEXUS_START_TIME;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    await bot.sendMessage(msg.chat.id, `⏱ *Runtime:* \`${h}h ${m}m ${sec}s\``, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/adminid$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 *Your Telegram user ID:* \`${msg.from.id}\`\n💬 *Chat ID:* \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/listpair$/, async (msg) => {
    if (!(await requireTelegramMembership(bot, msg))) return;
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
    const { listSessions } = require('./sessionManager');
    const sessions = listSessions();
    if (!sessions.length) return bot.sendMessage(msg.chat.id, '📋 No paired sessions.');
    const lines = sessions.map((x, i) => `${i + 1}. \`${x.phone || x.id}\` — ${x.status}`);
    await bot.sendMessage(msg.chat.id, `📋 *Paired sessions:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  console.log('Telegram pairing bot started (polling).');
  return bot;
}

module.exports = { startTelegramBot };
