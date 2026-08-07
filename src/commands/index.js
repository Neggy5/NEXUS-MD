const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const BOT_NAME = 'NEXUS-MD';
const PREFIX = process.env.PREFIX || '.';
const START_TIME = Date.now();

/**
 * Each command: { name, aliases, category, description, execute(ctx) }
 * ctx = { sock, msg, from, sender, args, text, isGroup, sessionId, quoted }
 */
const commands = new Map();

function register(cmd) {
  commands.set(cmd.name, cmd);
  (cmd.aliases || []).forEach((a) => commands.set(a, cmd));
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

// ---------- MAIN ----------

register({
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'MAIN',
  description: 'Show the command menu',
  async execute({ sock, from, sender }) {
    const byCategory = {};
    for (const cmd of new Set(commands.values())) {
      byCategory[cmd.category] = byCategory[cmd.category] || [];
      if (!byCategory[cmd.category].includes(cmd.name)) byCategory[cmd.category].push(cmd.name);
    }

    const uptime = formatUptime(Date.now() - START_TIME);
    const name = sender.split('@')[0];

    let menu = '';
    menu += `╭───「 *${BOT_NAME}* 」\n`;
    menu += `│ 👤 User    : wa:${name}\n`;
    menu += `│ ⏱ Uptime  : ${uptime}\n`;
    menu += `│ ⚙ Prefix  : ${PREFIX}\n`;
    menu += `╰────────────────\n\n`;

    for (const [cat, names] of Object.entries(byCategory)) {
      menu += `╭─「 *${cat}* 」\n`;
      names.forEach((n, i) => {
        const last = i === names.length - 1;
        menu += `│ ${last ? '╰' : '├'}✦ ${PREFIX}${n}\n`;
      });
      menu += `╰────────────────\n\n`;
    }

    menu += `_Powered by ${BOT_NAME} · Baileys_`;

    await sock.sendMessage(from, { text: menu });
  },
});

register({
  name: 'ping',
  category: 'MAIN',
  description: 'Check bot responsiveness',
  async execute({ sock, from }) {
    const start = Date.now();
    const sent = await sock.sendMessage(from, { text: '🏓 Pinging...' });
    const ms = Date.now() - start;
    await sock.sendMessage(from, { text: `🏓 Pong! *${ms}ms*` }, { quoted: sent });
  },
});

register({
  name: 'alive',
  category: 'MAIN',
  description: 'Check if the bot is online',
  async execute({ sock, from }) {
    await sock.sendMessage(from, {
      text: `✅ *${BOT_NAME}* is alive and running.\nUptime: ${formatUptime(Date.now() - START_TIME)}`,
    });
  },
});

register({
  name: 'runtime',
  category: 'MAIN',
  description: 'Show bot uptime',
  async execute({ sock, from }) {
    await sock.sendMessage(from, { text: `⏱ Uptime: ${formatUptime(Date.now() - START_TIME)}` });
  },
});

// ---------- INFO ----------

register({
  name: 'jid',
  category: 'INFO',
  description: 'Get the JID of this chat',
  async execute({ sock, from }) {
    await sock.sendMessage(from, { text: `\`\`\`${from}\`\`\`` });
  },
});

register({
  name: 'owner',
  category: 'INFO',
  description: 'Get owner contact',
  async execute({ sock, from }) {
    const owner = process.env.OWNER_NUMBER || 'not set';
    await sock.sendMessage(from, { text: `👑 Owner: wa.me/${owner.replace(/[^0-9]/g, '')}` });
  },
});

register({
  name: 'source',
  category: 'INFO',
  description: 'About this bot',
  async execute({ sock, from }) {
    await sock.sendMessage(from, {
      text: `${BOT_NAME} — a multi-user WhatsApp bot built with Baileys, deployed on Railway.`,
    });
  },
});

// ---------- TOOLS ----------

register({
  name: 'sticker',
  aliases: ['s'],
  category: 'TOOLS',
  description: 'Reply to / send an image or short video to make a sticker',
  async execute({ sock, msg, from, quoted }) {
    const target = quoted || msg;
    const imageMsg = target?.message?.imageMessage;
    const videoMsg = target?.message?.videoMessage;

    if (!imageMsg && !videoMsg) {
      await sock.sendMessage(from, { text: `📎 Send or reply to an image/video with *${PREFIX}sticker*` });
      return;
    }

    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
    const stream = await downloadContentFromMessage(imageMsg || videoMsg, imageMsg ? 'image' : 'video');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const sticker = new Sticker(buffer, {
      pack: BOT_NAME,
      author: 'nexus-md',
      type: StickerTypes.FULL,
      quality: 70,
    });

    const stickerBuffer = await sticker.toBuffer();
    await sock.sendMessage(from, { sticker: stickerBuffer });
  },
});

module.exports = { commands, PREFIX, BOT_NAME };
