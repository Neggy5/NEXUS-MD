const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { MENU_IMAGE_URL } = require('../config');
const { getGroupSettings, setGroupSetting, getGlobalSetting, setGlobalSetting } = require('../store');
const { isSenderAdmin } = require('../moderation');

function bareNumber(jid = '') {
  return jid.split('@')[0].split(':')[0];
}

const BOT_NAME = 'NEXUS-MD';
const PREFIX = process.env.PREFIX || '.';
const START_TIME = Date.now();

// Category display order + icons for the menu.
const CATEGORY_STYLE = {
  MAIN: '🏠',
  INFO: 'ℹ️',
  TOOLS: '🛠️',
  'GROUP-ADMIN': '👥',
  'GROUP-SECURITY': '🛡️',
};
const CATEGORY_ORDER = ['MAIN', 'INFO', 'TOOLS', 'GROUP-ADMIN', 'GROUP-SECURITY'];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up? 🌙';
  if (h < 12) return 'Good morning ☀️';
  if (h < 18) return 'Good afternoon 🌤️';
  return 'Good evening 🌆';
}

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
  async execute({ sock, from, sender, isGroup }) {
    const byCategory = {};
    for (const cmd of new Set(commands.values())) {
      byCategory[cmd.category] = byCategory[cmd.category] || [];
      if (!byCategory[cmd.category].includes(cmd.name)) byCategory[cmd.category].push(cmd.name);
    }

    const totalCommands = new Set(commands.values()).size;
    const uptime = formatUptime(Date.now() - START_TIME);
    const name = sender.split('@')[0];
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

    let menu = '';
    menu += `╭━━━⟪ 🤖 *${BOT_NAME}* ⟫━━━╮\n`;
    menu += `┃ ${greeting()}, *${name}*\n`;
    menu += `┃ 📅 ${date}\n`;
    menu += `┃ ⏱️ Uptime   : ${uptime}\n`;
    menu += `┃ ⚙️ Prefix   : [ ${PREFIX} ]\n`;
    menu += `┃ 📦 Commands : ${totalCommands}\n`;
    menu += `┃ 🌐 Mode     : ${isGroup ? 'Group' : 'Private'}\n`;
    menu += `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

    const orderedCats = [
      ...CATEGORY_ORDER.filter((c) => byCategory[c]),
      ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
    ];

    for (const cat of orderedCats) {
      const names = byCategory[cat];
      const icon = CATEGORY_STYLE[cat] || '📁';
      menu += `┌─❰ ${icon} *${cat}* ❱\n`;
      names.forEach((n, i) => {
        const last = i === names.length - 1;
        menu += `│ ${last ? '└' : '├'}⟢ ${PREFIX}${n}\n`;
      });
      menu += `└──────────────\n\n`;
    }

    menu += `✨ _Powered by ${BOT_NAME} ·Lord zuko_`;

    if (MENU_IMAGE_URL) {
      await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menu });
    } else {
      await sock.sendMessage(from, { text: menu });
    }
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
  name: 'xnxx',
  category: 'NSFW',
  description: 'Search and Download XNXX videos',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `*NEXUS-MD XNXX Tool*\n\n*1. Search:* ${prefix}${command} Naruto\n*2. Download:* ${prefix}${command} <video_link>` 
      });
    }

    const input = args.join(" ");
    const isUrl = input.match(/https?:\/\/(www\.)?xnxx\.(com|health)\/[^\s]+/gi);

    // --- CASE 1: DOWNLOAD VIDEO ---
    if (isUrl) {
      const videoUrl = isUrl[0];
      try {
        await sock.sendMessage(from, { text: '📥 *Downloading video...* Please wait.' });

        const dlApi = `https://api.princetechn.com/api/download/xnxxdl?apikey=prince&url=${encodeURIComponent(videoUrl)}`;
        const response = await fetch(dlApi);
        const data = await response.json();

        // Extracting the high-quality URL from the API response
        const downloadUrl = data.result?.url || data.url;

        if (!downloadUrl) {
          return await sock.sendMessage(from, { text: "❌ Link extraction failed." });
        }

        await sock.sendMessage(from, {
          video: { url: downloadUrl },
          caption: `✅ *Downloaded Successfully*`,
          mimetype: 'video/mp4'
        });
      } catch (e) {
        await sock.sendMessage(from, { text: "⚠️ Download Error: " + e.message });
      }

    // --- CASE 2: SEARCH VIDEOS ---
    } else {
      try {
        await sock.sendMessage(from, { text: `🔍 Searching for: *${input}*...` });

        const searchApi = `https://omegatech-api.dixonomega.tech/api/Porn/Xnxx?action=search&query=${encodeURIComponent(input)}`;
        const response = await fetch(searchApi);
        const data = await response.json();
        
        const results = data.result || data;

        if (!results || results.length === 0) {
          return await sock.sendMessage(from, { text: "❌ No results found." });
        }

        let message = `🔞 *XNXX SEARCH RESULTS*\n\n`;
        
        results.slice(0, 10).forEach((vid, i) => {
          message += `*${i + 1}.* ${vid.title}\n`;
          message += `🔗 ${vid.link}\n\n`;
        });

        message += `💡 *Tip:* Copy a link and send \`${prefix}${command} <link>\` to download it.`;

        await sock.sendMessage(from, { text: message });
      } catch (e) {
        await sock.sendMessage(from, { text: "⚠️ Search Error: " + e.message });
      }
    }
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
    const owner = process.env.OWNER_NUMBER || '2348169946429';
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

// ---------- GROUP-SECURITY ----------

async function requireAdminOrOwner({ sock, from, sender, isGroup, msg }) {
  if (msg.key.fromMe) return true; // the linked account itself
  if (!isGroup) {
    await sock.sendMessage(from, { text: '⚠️ This setting only applies inside groups.' });
    return false;
  }
  const admin = await isSenderAdmin(sock, from, sender);
  if (!admin) {
    await sock.sendMessage(from, { text: '❌ Only group admins or the bot owner can change this.' });
    return false;
  }
  return true;
}

function toggleCommand({ name, aliases, settingKey, label, emoji }) {
  register({
    name,
    aliases,
    category: 'GROUP-SECURITY',
    description: `${label} — on/off`,
    async execute(ctx) {
      const { sock, from, args, isGroup } = ctx;
      const ok = await requireAdminOrOwner(ctx);
      if (!ok) return;

      const state = getGroupSettings(from);
      const arg = (args[0] || '').toLowerCase();

      if (!arg || !['on', 'off'].includes(arg)) {
        await sock.sendMessage(from, {
          text: `${emoji} *${label}* is currently *${state[settingKey] ? 'ON' : 'OFF'}*.\nUse: ${PREFIX}${name} on | ${PREFIX}${name} off`,
        });
        return;
      }

      const enabled = arg === 'on';
      setGroupSetting(from, settingKey, enabled);
      await sock.sendMessage(from, {
        text: `${emoji} *${label}* turned *${enabled ? 'ON ✅' : 'OFF ❌'}* for this group.`,
      });
    },
  });
}

toggleCommand({
  name: 'antidelete',
  settingKey: 'antidelete',
  label: 'Antidelete',
  emoji: '🗑️',
});

toggleCommand({
  name: 'antiedit',
  settingKey: 'antiedit',
  label: 'Antiedit',
  emoji: '✏️',
});

toggleCommand({
  name: 'antisticker',
  settingKey: 'antisticker',
  label: 'Antisticker',
  emoji: '🎴',
});

toggleCommand({
  name: 'antigroupmention',
  aliases: ['antitag'],
  settingKey: 'antigroupmention',
  label: 'Antigroupmention',
  emoji: '🚫',
});

toggleCommand({
  name: 'antilink',
  settingKey: 'antilink',
  label: 'Antilink',
  emoji: '🔗',
});

// Auto-react is owner-level (not per-group) so it works in DMs too, not just groups.
register({
  name: 'autoreact',
  category: 'GROUP-SECURITY',
  description: 'React to every incoming message with a random emoji, in DMs and groups (owner only) — on/off',
  async execute({ sock, from, args, msg, sessionId }) {
    if (!msg.key.fromMe) {
      await sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
      return;
    }
    const arg = (args[0] || '').toLowerCase();
    if (!arg || !['on', 'off'].includes(arg)) {
      await sock.sendMessage(from, {
        text: `😄 *Auto-react* is currently *${getGlobalSetting(sessionId, 'autoreact') ? 'ON' : 'OFF'}*.\nUse: ${PREFIX}autoreact on | ${PREFIX}autoreact off`,
      });
      return;
    }
    setGlobalSetting(sessionId, 'autoreact', arg === 'on');
    await sock.sendMessage(from, {
      text: `😄 *Auto-react* turned *${arg === 'on' ? 'ON ✅' : 'OFF ❌'}* — applies to DMs and groups.`,
    });
  },
});

register({
  name: 'anticall',
  category: 'GROUP-SECURITY',
  description: 'Auto-reject incoming calls to this bot (owner only) — on/off',
  async execute({ sock, from, args, msg, sessionId }) {
    if (!msg.key.fromMe) {
      await sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
      return;
    }
    const arg = (args[0] || '').toLowerCase();
    if (!arg || !['on', 'off'].includes(arg)) {
      await sock.sendMessage(from, {
        text: `📵 *Anticall* is currently *${getGlobalSetting(sessionId, 'anticall') ? 'ON' : 'OFF'}*.\nUse: ${PREFIX}anticall on | ${PREFIX}anticall off`,
      });
      return;
    }
    setGlobalSetting(sessionId, 'anticall', arg === 'on');
    await sock.sendMessage(from, { text: `📵 *Anticall* turned *${arg === 'on' ? 'ON ✅' : 'OFF ❌'}*.` });
  },
});

register({
  name: 'mode',
  aliases: ['private', 'public'],
  category: 'GROUP-SECURITY',
  description: 'Switch the bot between public and private mode (owner only)',
  async execute({ sock, from, args, msg, sessionId, text }) {
    if (!msg.key.fromMe) {
      await sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
      return;
    }
    // Support both ".mode private" and the bare ".private" / ".public" aliases.
    const invoked = text.slice(PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
    const arg = ['private', 'public'].includes(invoked) ? invoked : (args[0] || '').toLowerCase();

    if (!arg || !['public', 'private'].includes(arg)) {
      const current = getGlobalSetting(sessionId, 'mode');
      await sock.sendMessage(from, {
        text: `⚙️ Bot is currently in *${current.toUpperCase()}* mode.\nUse: ${PREFIX}mode public | ${PREFIX}mode private`,
      });
      return;
    }

    setGlobalSetting(sessionId, 'mode', arg);
    await sock.sendMessage(from, {
      text:
        arg === 'private'
          ? '🔒 *Private mode* enabled — only the owner can use commands now.'
          : '🌐 *Public mode* enabled — everyone can use commands.',
    });
  },
});

register({
  name: 'security',
  aliases: ['groupsettings'],
  category: 'GROUP-SECURITY',
  description: 'View all group-security toggles at a glance',
  async execute({ sock, from, isGroup, sessionId }) {
    if (!isGroup) {
      await sock.sendMessage(from, { text: '⚠️ This only applies inside groups.' });
      return;
    }
    const s = getGroupSettings(from);
    const flag = (v) => (v ? '✅ ON' : '❌ OFF');
    const text =
      `🛡️ *Group Security Status*\n\n` +
      `🗑️ Antidelete        : ${flag(s.antidelete)}\n` +
      `✏️ Antiedit          : ${flag(s.antiedit)}\n` +
      `🎴 Antisticker       : ${flag(s.antisticker)}\n` +
      `🚫 Antigroupmention  : ${flag(s.antigroupmention)}\n` +
      `🔗 Antilink          : ${flag(s.antilink)}\n\n` +
      `😄 Auto-react (all chats) : ${flag(getGlobalSetting(sessionId, 'autoreact'))}\n` +
      `📵 Anticall (all chats)   : ${flag(getGlobalSetting(sessionId, 'anticall'))}\n\n` +
      `_Group toggles: ${PREFIX}<name> on/off. Auto-react/anticall are owner-only and apply everywhere._`;
    await sock.sendMessage(from, { text });
  },
});

// ---------- GROUP-ADMIN ----------

// Resolves a target JID from a mention, a quoted message's sender, or a raw
// number passed as an argument — in that order of preference.
function getTargetJid({ msg, quoted, args }) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned && mentioned.length) return mentioned[0];
  if (quoted?.key?.participant) return quoted.key.participant;
  const num = (args[0] || '').replace(/[^0-9]/g, '');
  if (num) return `${num}@s.whatsapp.net`;
  return null;
}

function requireGroup({ sock, from, isGroup }) {
  if (!isGroup) {
    sock.sendMessage(from, { text: '⚠️ This command only works inside groups.' });
    return false;
  }
  return true;
}

register({
  name: 'tagall',
  category: 'GROUP-ADMIN',
  description: 'Mention every member in the group',
  async execute(ctx) {
    const { sock, from, isGroup, args } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;

    const meta = await sock.groupMetadata(from);
    const mentions = meta.participants.map((p) => p.id);
    const note = args.join(' ');

    let text = `📢 *Tag All* (${mentions.length} members)\n\n`;
    mentions.forEach((jid) => {
      text += `• @${bareNumber(jid)}\n`;
    });
    if (note) text += `\n💬 ${note}`;

    await sock.sendMessage(from, { text, mentions });
  },
});

register({
  name: 'hidetag',
  category: 'GROUP-ADMIN',
  description: 'Notify everyone without listing numbers — add a message or reply to one',
  async execute(ctx) {
    const { sock, from, args, quoted } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;

    const meta = await sock.groupMetadata(from);
    const mentions = meta.participants.map((p) => p.id);
    const quotedText = quoted?.message?.conversation || quoted?.message?.extendedTextMessage?.text;
    const text = args.join(' ') || quotedText || '📢';

    await sock.sendMessage(from, { text, mentions });
  },
});

register({
  name: 'mute',
  category: 'GROUP-ADMIN',
  description: 'Only admins can send messages in this group',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      await sock.groupSettingUpdate(from, 'announcement');
      await sock.sendMessage(from, { text: '🔇 Group muted — only admins can send messages now.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not mute — is the bot an admin here?' });
    }
  },
});

register({
  name: 'unmute',
  category: 'GROUP-ADMIN',
  description: 'Everyone can send messages again',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      await sock.groupSettingUpdate(from, 'not_announcement');
      await sock.sendMessage(from, { text: '🔊 Group unmuted — everyone can send messages.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not unmute — is the bot an admin here?' });
    }
  },
});

register({
  name: 'setgcname',
  category: 'GROUP-ADMIN',
  description: 'Change the group name',
  async execute(ctx) {
    const { sock, from, args } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    const name = args.join(' ');
    if (!name) {
      await sock.sendMessage(from, { text: `📝 Use: ${PREFIX}setgcname <new name>` });
      return;
    }
    try {
      await sock.groupUpdateSubject(from, name);
      await sock.sendMessage(from, { text: `✅ Group name updated to *${name}*.` });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not update the group name — is the bot an admin here?' });
    }
  },
});

register({
  name: 'setgcpic',
  category: 'GROUP-ADMIN',
  description: 'Reply to an image with this to set it as the group photo',
  async execute(ctx) {
    const { sock, from, quoted, msg } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;

    const target = quoted || msg;
    const imageMsg = target?.message?.imageMessage;
    if (!imageMsg) {
      await sock.sendMessage(from, { text: `📎 Reply to an image with *${PREFIX}setgcpic*` });
      return;
    }

    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      await sock.updateProfilePicture(from, buffer);
      await sock.sendMessage(from, { text: '✅ Group photo updated.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not update the group photo — is the bot an admin here?' });
    }
  },
});

register({
  name: 'getpp',
  aliases: ['pp'],
  category: 'GROUP-ADMIN',
  description: "Get someone's profile picture — reply, mention, or give a number",
  async execute(ctx) {
    const { sock, from, sender } = ctx;
    const target = getTargetJid(ctx) || sender;
    try {
      const url = await sock.profilePictureUrl(target, 'image');
      await sock.sendMessage(from, {
        image: { url },
        caption: `🖼️ Profile photo of @${bareNumber(target)}`,
        mentions: [target],
      });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not fetch a profile photo (it may be private or unset).' });
    }
  },
});

register({
  name: 'setpp',
  category: 'GROUP-ADMIN',
  description: "Reply to an image to set it as the bot's own profile picture (owner only)",
  async execute({ sock, from, quoted, msg }) {
    if (!msg.key.fromMe) {
      await sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
      return;
    }
    const target = quoted || msg;
    const imageMsg = target?.message?.imageMessage;
    if (!imageMsg) {
      await sock.sendMessage(from, { text: `📎 Reply to an image with *${PREFIX}setpp*` });
      return;
    }
    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(imageMsg, 'image');
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      await sock.updateProfilePicture(sock.user.id, buffer);
      await sock.sendMessage(from, { text: '✅ Bot profile photo updated.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not update the profile photo.' });
    }
  },
});

function memberActionCommand({ name, action, verb, pastTense, emoji }) {
  register({
    name,
    category: 'GROUP-ADMIN',
    description: `${verb} a member — reply, mention, or give a number`,
    async execute(ctx) {
      const { sock, from } = ctx;
      if (!requireGroup(ctx)) return;
      const ok = await requireAdminOrOwner(ctx);
      if (!ok) return;

      const target = getTargetJid(ctx);
      if (!target) {
        await sock.sendMessage(from, { text: `👤 Reply to, mention, or give a number: ${PREFIX}${name} @user` });
        return;
      }

      try {
        await sock.groupParticipantsUpdate(from, [target], action);
        await sock.sendMessage(from, {
          text: `${emoji} @${bareNumber(target)} — ${pastTense}.`,
          mentions: [target],
        });
      } catch {
        await sock.sendMessage(from, { text: `❌ Could not ${verb.toLowerCase()} — is the bot an admin here?` });
      }
    },
  });
}

memberActionCommand({ name: 'promote', action: 'promote', verb: 'Promote', pastTense: 'promoted to admin', emoji: '⬆️' });
memberActionCommand({ name: 'demote', action: 'demote', verb: 'Demote', pastTense: 'demoted to member', emoji: '⬇️' });
memberActionCommand({ name: 'kick', action: 'remove', verb: 'Kick', pastTense: 'removed from the group', emoji: '👢' });

module.exports = { commands, PREFIX, BOT_NAME };
