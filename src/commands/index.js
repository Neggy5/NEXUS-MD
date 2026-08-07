const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { MENU_IMAGE_URL } = require('../config');
const { getGroupSettings, setGroupSetting, getGlobalSetting, setGlobalSetting } = require('../store');
const { isSenderAdmin } = require('../moderation');

function bareNumber(jid = '') {
  return jid.split('@')[0].split(':')[0];
}
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
const PREFIX = process.env.PREFIX || '.';
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
  NSFW: '🔞'
};

const CATEGORY_ORDER = ['MAIN', 'AI', 'DOWNLOADER', 'INFO', 'TOOLS', 'GROUP-ADMIN', 'GROUP-SECURITY', 'NSFW'];

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
// ==========================================
//               AI COMMANDS
// ==========================================

register({
  name: 'gpt',
  aliases: ['ai', 'chatgpt', 'ask'],
  category: 'AI',
  description: 'Chat with GPT-4 powered AI assistant',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return await sock.sendMessage(from, { 
        text: `🤖 *GPT Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} What is the capital of France?` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Thinking...` });

    try {
      // Use OmegaTech API for GPT
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/ai/gpt?q=${encodeURIComponent(text)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract the response from various possible formats
      let reply = data.result || data.reply || data.message || data.response || data.text;
      
      if (!reply) {
        // Fallback: try to find any text in the response
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        throw new Error("Could not extract response from AI.");
      }

      // Clean up the response (remove extra quotes, escapes)
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"');

      // Truncate if too long (WhatsApp has message limits)
      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      await sock.sendMessage(from, { 
        text: `🤖 *GPT Response:*\n\n${reply}` 
      });

    } catch (error) {
      console.error('GPT error:', error);
      
      // Fallback: try Prince API if OmegaTech fails
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/gpt';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(text)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.result || fallbackData.reply;
        
        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `🤖 *GPT Response (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ GPT Error: ${error.message || 'Unknown error'}` 
      });
    }
  }
});

register({
  name: 'gemini',
  aliases: ['gmini', 'googleai'],
  category: 'AI',
  description: 'Chat with Google Gemini AI',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return await sock.sendMessage(from, { 
        text: `✨ *Gemini AI Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} Write a poem about cats` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Generating response...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/ai/gemini?q=${encodeURIComponent(text)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract response from various formats
      let reply = data.result || data.reply || data.message || data.response || data.text;
      
      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
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

      await sock.sendMessage(from, { 
        text: `✨ *Gemini:*\n\n${reply}` 
      });

    } catch (error) {
      console.error('Gemini error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/gemini';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(text)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.result || fallbackData.reply;
        
        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `✨ *Gemini (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Gemini Error: ${error.message || 'Unknown error'}` 
      });
    }
  }
});

register({
  name: 'blackbox',
  aliases: ['bb', 'codeai', 'codingai'],
  category: 'AI',
  description: 'AI Coding & Logic Assistant (Blackbox AI)',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return await sock.sendMessage(from, { 
        text: `💻 *Blackbox AI Assistant*\n\nUsage: ${prefix}${command} <your question>\n\n*Examples:*\n${prefix}${command} Write a Python function to sort a list\n${prefix}${command} Explain the difference between let and const in JavaScript\n${prefix}${command} Debug this code: ...` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Analyzing code...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/ai/blackbox?q=${encodeURIComponent(text)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract response from various formats
      let reply = data.result || data.reply || data.message || data.response || data.text || data.code;
      
      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/) ||
                          jsonString.match(/"code":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        throw new Error("Could not extract response from Blackbox AI.");
      }

      // Clean up
      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');

      // Truncate if too long
      if (reply.length > 65000) {
        reply = reply.slice(0, 65000) + '\n\n... (truncated)';
      }

      await sock.sendMessage(from, { 
        text: `💻 *Blackbox AI:*\n\n${reply}` 
      });

    } catch (error) {
      console.error('Blackbox error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/blackbox';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(text)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.result || fallbackData.reply || fallbackData.code;
        
        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `💻 *Blackbox AI (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Blackbox Error: ${error.message || 'Unknown error'}` 
      });
    }
  }
});

register({
  name: 'dalle',
  aliases: ['imagine', 'aiimg', 'generate', 'dream'],
  category: 'AI',
  description: 'Generate AI images from text prompts',
  async execute({ sock, from, text, prefix, command }) {
    if (!text) {
      return await sock.sendMessage(from, { 
        text: `🎨 *DALL-E Image Generator*\n\nUsage: ${prefix}${command} <description>\n\n*Examples:*\n${prefix}${command} A futuristic city at sunset, cyberpunk style\n${prefix}${command} A cute cat eating pizza, cartoon style\n${prefix}${command} A realistic portrait of a robot\n\n*Tips:*\n• Be descriptive for better results\n• Include style (realistic, cartoon, anime, etc.)\n• Mention colors, lighting, mood` 
      });
    }

    await sock.sendMessage(from, { text: `🎨 *Creating your masterpiece...*\n⏳ This may take 10-20 seconds...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/ai/dalle?prompt=${encodeURIComponent(text)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract image URL from various formats
      let imageUrl = data.result || data.url || data.image || data.data?.url || data.data?.result;
      
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
        caption: `🎨 *DALL-E Generated Image*\n\n📝 *Prompt:* ${text}\n\n✨ _Generated by NEXUS-MD_`
      });

    } catch (error) {
      console.error('DALL-E error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/ai/dalle';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&prompt=${encodeURIComponent(text)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackImage = fallbackData.result || fallbackData.url || fallbackData.image;
        
        if (fallbackImage) {
          return await sock.sendMessage(from, {
            image: { url: fallbackImage },
            caption: `🎨 *DALL-E Generated Image (fallback)*\n\n📝 *Prompt:* ${text}`
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ DALL-E Error: ${error.message || 'Unknown error'}\n\n💡 Try a different prompt or try again later.` 
      });
    }
  }
});

// ==========================================
//            DOWNLOADER COMMANDS
// ==========================================

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
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/tiktok?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract video URL from various formats
      let videoUrl = data.result?.video || data.result?.download_url || data.result?.url || 
                     data.video || data.download_url || data.url;
      
      // Extract metadata
      let title = data.title || data.result?.title || data.caption || 'TikTok Video';
      let author = data.author || data.result?.author || data.username || 'Unknown';
      let duration = data.duration || data.result?.duration || 'N/A';
      let thumbnail = data.thumbnail || data.result?.thumbnail || data.cover || null;

      if (!videoUrl) {
        // Fallback: try to find any URL in the response
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"',]+\.(mp4|mov)/i);
        if (urlMatch) videoUrl = urlMatch[0];
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from API response.");
      }

      // Send thumbnail first (if available)
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎵 *${title}*\n👤 *Author:* ${author}\n⏱️ *Duration:* ${duration}s\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {
          // Continue even if thumbnail fails
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

      // Send the video
      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          caption: `🎵 *${title}*\n👤 *Author:* ${author}\n⏱️ *Duration:* ${duration}s\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *TikTok Download Success*`
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `tiktok_${author}_${Date.now()}.mp4`,
          caption: `🎵 *${title}*\n👤 *Author:* ${author}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('TikTok download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/tiktok';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();
        
        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.url || 
                            fallbackData.video || fallbackData.url;
        
        if (fallbackVideo) {
          const videoRes = await fetch(fallbackVideo);
          const videoBuf = Buffer.from(await videoRes.arrayBuffer());
          
          return await sock.sendMessage(from, {
            video: videoBuf,
            caption: `🎵 *TikTok Video (fallback)*\n✅ *Download Success*`
          });
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different video link.` 
      });
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
              await sock.sendMessage(from, { video: vBuf, caption: '✅ Instagram Download (fallback)' });
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

register({
  name: 'facebook',
  aliases: ['fb', 'fbdl', 'facebookdl'],
  category: 'DOWNLOADER',
  description: 'Download Facebook Videos',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Facebook Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://www.facebook.com/watch?v=xxxxx\n\n*Supports:*\n• Public videos\n• Watch videos\n• Reels` 
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
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/facebook?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      let videoUrl = data.result?.video || data.result?.download_url || data.result?.url || 
                     data.video || data.download_url || data.url;
      let title = data.result?.title || data.title || data.caption || 'Facebook Video';
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.cover || null;

      if (!videoUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mov)/i);
        if (urlMatch) videoUrl = urlMatch[0];
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from API response.");
      }

      if (thumbnail) {
        try {
          await sock.sendMessage(from, { image: { url: thumbnail }, caption: `🎬 *${title}*\n\n⬇️ *Downloading video...*` });
        } catch (thumbErr) {}
      }

      const videoResponse = await fetch(videoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!videoResponse.ok) {
        throw new Error(`Video download failed: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      if (videoBuffer.length < 5000) {
        throw new Error("Downloaded file is too small.");
      }

      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);

      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Facebook Download Success*`
        });
      } catch (sendErr) {
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `facebook_${Date.now()}.mp4`,
          caption: `🎬 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Facebook download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/facebook';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();
        let fallbackVideo = fallbackData.result?.video || fallbackData.result?.download_url || fallbackData.video;
        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { video: vBuf, caption: '✅ Facebook Download (fallback)' });
          }
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}` 
      });
    }
  }
});

register({
  name: 'twitter',
  aliases: ['x', 'xdl', 'twitterdl', 'tweet'],
  category: 'DOWNLOADER',
  description: 'Download Twitter/X Videos and Images',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `📥 *Twitter/X Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://twitter.com/user/status/xxxxx\n\n*Supports:*\n• Videos\n• Images\n• GIFs` 
      });
    }

    const url = args[0];

    if (!url.includes('twitter.com') && !url.includes('x.com')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Twitter/X link.` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Twitter/X media...` });

    try {
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/twitter?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      let videoUrl = data.result?.video || data.result?.download_url || data.result?.url || 
                     data.video || data.download_url || data.url;
      let imageUrls = data.result?.images || data.images || data.result?.urls || data.urls || [];
      let title = data.result?.title || data.title || data.caption || 'Twitter Post';
      let username = data.result?.username || data.username || data.author || 'Unknown';

      if (!videoUrl && !imageUrls.length) {
        const singleImage = data.result?.image || data.result?.url || data.image || data.url;
        if (singleImage) imageUrls = [singleImage];
      }

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

      await sock.sendMessage(from, { 
        text: `🐦 *${title}*\n👤 *Author:* @${username}\n\n⬇️ *Downloading media...*` 
      });

      if (videoUrl) {
        const videoResponse = await fetch(videoUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (videoResponse.ok) {
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          if (videoBuffer.length > 5000) {
            const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
            try {
              await sock.sendMessage(from, {
                video: videoBuffer,
                caption: `🐦 *${title}*\n👤 *Author:* @${username}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Twitter/X Download Success*`
              });
            } catch (sendErr) {
              await sock.sendMessage(from, {
                document: videoBuffer,
                mimetype: 'video/mp4',
                fileName: `twitter_${Date.now()}.mp4`,
                caption: `🐦 *${title}*\n👤 *Author:* @${username}`
              });
            }
          }
        }
      }

      if (imageUrls.length) {
        const maxImages = Math.min(imageUrls.length, 10);
        for (let i = 0; i < maxImages; i++) {
          try {
            await sock.sendMessage(from, {
              image: { url: imageUrls[i] },
              caption: i === 0 ? `🐦 *${title}*\n👤 *Author:* @${username}\n📷 ${i+1}/${maxImages}` : `📷 ${i+1}/${maxImages}`
            });
            await new Promise(r => setTimeout(r, 500));
          } catch (imgErr) {}
        }
      }

    } catch (error) {
      console.error('Twitter download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/twitter';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();
        let fallbackVideo = fallbackData.result?.video || fallbackData.video;
        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, { video: vBuf, caption: '✅ Twitter/X Download (fallback)' });
          }
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}` 
      });
    }
  }
});

register({
  name: 'spotify',
  aliases: ['sp', 'spotifydl', 'sptdl'],
  category: 'DOWNLOADER',
  description: 'Download songs from Spotify',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎵 *Spotify Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://open.spotify.com/track/xxxxx\n\n*Supports:*\n• Tracks (songs)\n• Playlists (coming soon)\n• Albums (coming soon)` 
      });
    }

    const url = args[0];

    if (!url.includes('spotify.com')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid Spotify link.\nExample: https://open.spotify.com/track/xxxxx` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing Spotify track...` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/spotify?url=${encodeURIComponent(url)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract audio URL and metadata
      let audioUrl = data.result?.download_url || data.result?.url || data.result?.audio || 
                     data.download_url || data.url || data.audio;
      
      let title = data.result?.title || data.title || 'Spotify Track';
      let artist = data.result?.artist || data.artist || data.result?.artists || data.artists || 'Unknown Artist';
      let album = data.result?.album || data.album || 'Unknown Album';
      let duration = data.result?.duration || data.duration || 'N/A';
      let cover = data.result?.cover || data.cover || data.result?.thumbnail || data.thumbnail || null;

      // Try to extract from nested result
      if (!audioUrl && data.result) {
        const result = data.result;
        audioUrl = result.download_url || result.url || result.audio || result.link;
        if (!title && result.title) title = result.title;
        if (!artist && result.artist) artist = result.artist;
      }

      if (!audioUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp3|m4a|ogg|wav)/i);
        if (urlMatch) audioUrl = urlMatch[0];
      }

      if (!audioUrl) {
        throw new Error("Could not extract audio URL from API response.");
      }

      // Send cover art if available
      if (cover) {
        try {
          await sock.sendMessage(from, {
            image: { url: cover },
            caption: `🎵 *${title}*\n👤 *Artist:* ${artist}\n💿 *Album:* ${album}\n⏱️ *Duration:* ${duration}\n\n⬇️ *Downloading audio...*`
          });
        } catch (coverErr) {
          await sock.sendMessage(from, { 
            text: `🎵 *${title}*\n👤 *Artist:* ${artist}\n💿 *Album:* ${album}\n⏱️ *Duration:* ${duration}\n\n⬇️ *Downloading audio...*` 
          });
        }
      } else {
        await sock.sendMessage(from, { 
          text: `🎵 *${title}*\n👤 *Artist:* ${artist}\n💿 *Album:* ${album}\n⏱️ *Duration:* ${duration}\n\n⬇️ *Downloading audio...*` 
        });
      }

      // Download the audio
      const audioResponse = await fetch(audioUrl, {
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

      // Send the audio
      try {
        await sock.sendMessage(from, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${title} - ${artist}.mp3`,
          caption: `🎵 *${title}*\n👤 *Artist:* ${artist}\n💿 *Album:* ${album}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *Spotify Download Success*`
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: `${title} - ${artist}.mp3`,
          caption: `🎵 *${title}*\n👤 *Artist:* ${artist}\n💿 *Album:* ${album}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Spotify download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/spotify';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}`);
        const fallbackData = await fallbackRes.json();
        
        let fallbackAudio = fallbackData.result?.download_url || fallbackData.result?.url || 
                            fallbackData.result?.audio || fallbackData.download_url || fallbackData.url;
        let fallbackTitle = fallbackData.result?.title || fallbackData.title || 'Spotify Track';
        let fallbackArtist = fallbackData.result?.artist || fallbackData.artist || 'Unknown Artist';
        
        if (fallbackAudio) {
          const aRes = await fetch(fallbackAudio);
          const aBuf = Buffer.from(await aRes.arrayBuffer());
          if (aBuf.length > 5000) {
            return await sock.sendMessage(from, {
              audio: aBuf,
              mimetype: 'audio/mpeg',
              fileName: `${fallbackTitle} - ${fallbackArtist}.mp3`,
              caption: '✅ Spotify Download (fallback)'
            });
          }
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Try using yt-search to find the song
      try {
        const searchQuery = `${title} ${artist} audio`;
        const yts = require('yt-search');
        const searchResults = await yts(searchQuery);
        
        if (searchResults && searchResults.videos && searchResults.videos.length > 0) {
          const target = searchResults.videos[0];
          const ytUrl = target.url;
          
          // Try OmegaTech play endpoint
          const playRes = await fetch(`${baseUrl}/api/download/play?url=${encodeURIComponent(ytUrl)}`);
          const playData = await playRes.json();
          let fallbackYtUrl = playData.download_url || playData.download || playData.url;
          
          if (fallbackYtUrl) {
            const ytAudioRes = await fetch(fallbackYtUrl);
            const ytAudioBuf = Buffer.from(await ytAudioRes.arrayBuffer());
            if (ytAudioBuf.length > 5000) {
              return await sock.sendMessage(from, {
                audio: ytAudioBuf,
                mimetype: 'audio/mpeg',
                fileName: `${target.title}.mp3`,
                caption: `🎵 *${target.title}*\n👤 *Artist:* ${artist}\n\n✅ *Spotify Download (YouTube fallback)*`
              });
            }
          }
        }
      } catch (ytErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different link.` 
      });
    }
  }
});

register({
  name: 'ytmp4',
  aliases: ['ytv', 'youtube', 'ytdl', 'youtubedl'],
  category: 'DOWNLOADER',
  description: 'Download YouTube videos',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎬 *YouTube Video Downloader*\n\nUsage: ${prefix}${command} <url>\nExample: ${prefix}${command} https://youtu.be/xxxxx\n\n*Options:*\n${prefix}${command} <url> 720p\n${prefix}${command} <url> 1080p\n\n*Supports:*\n• YouTube URLs\n• YouTube Shorts\n• Quality selection (720p, 1080p)` 
      });
    }

    let url = args[0];
    let quality = '720p';

    // Check if quality is specified
    if (args[1] && ['720', '720p', '1080', '1080p', '480', '480p', '360', '360p'].includes(args[1].toLowerCase())) {
      quality = args[1].toLowerCase().replace('p', '') + 'p';
    }

    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return await sock.sendMessage(from, { 
        text: `❌ Invalid URL. Please provide a valid YouTube link.\nExample: https://youtu.be/xxxxx` 
      });
    }

    await sock.sendMessage(from, { text: `⏳ Processing YouTube video... (${quality})` });

    try {
      // Primary: OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/ytmp4?url=${encodeURIComponent(url)}&quality=${quality}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      
      // Extract video URL and metadata
      let videoUrl = data.result?.download_url || data.result?.url || data.result?.video || 
                     data.download_url || data.url || data.video;
      
      let title = data.result?.title || data.title || 'YouTube Video';
      let thumbnail = data.result?.thumbnail || data.thumbnail || data.cover || null;
      let duration = data.result?.duration || data.duration || 'N/A';
      let qualityReturned = data.result?.quality || data.quality || quality;

      if (!videoUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp4|mkv|webm)/i);
        if (urlMatch) videoUrl = urlMatch[0];
      }

      if (!videoUrl) {
        throw new Error("Could not extract video URL from API response.");
      }

      // Send thumbnail first
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎬 *${title}*\n⏱️ *Duration:* ${duration}\n📊 *Quality:* ${qualityReturned}\n\n⬇️ *Downloading video...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🎬 *${title}*\n⏱️ *Duration:* ${duration}\n📊 *Quality:* ${qualityReturned}\n\n⬇️ *Downloading video...*` 
          });
        }
      }

      // Download the video
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

      // Try to send as video
      try {
        await sock.sendMessage(from, {
          video: videoBuffer,
          caption: `🎬 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Size:* ${fileSizeMB} MB\n\n✅ *YouTube Download Success*`
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`,
          caption: `🎬 *${title}*\n📊 *Quality:* ${qualityReturned}\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('YouTube download error:', error);
      
      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/ytmp4';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(url)}&quality=${quality}`);
        const fallbackData = await fallbackRes.json();
        
        let fallbackVideo = fallbackData.result?.download_url || fallbackData.result?.url || 
                            fallbackData.download_url || fallbackData.url;
        let fallbackTitle = fallbackData.result?.title || fallbackData.title || 'YouTube Video';
        
        if (fallbackVideo) {
          const vRes = await fetch(fallbackVideo);
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 5000) {
            return await sock.sendMessage(from, {
              video: vBuf,
              caption: `🎬 *${fallbackTitle}*\n✅ *YouTube Download (fallback)*`
            });
          }
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Try using yt-search to find the video
      try {
        const searchQuery = url.includes('youtu.be') || url.includes('youtube.com') ? 
          url : (args[0] || '');
        
        if (searchQuery) {
          const yts = require('yt-search');
          const searchResults = await yts(searchQuery);
          
          if (searchResults && searchResults.videos && searchResults.videos.length > 0) {
            const target = searchResults.videos[0];
            const ytUrl = target.url;
            
            // Try OmegaTech play endpoint for audio only
            const playRes = await fetch(`${baseUrl}/api/download/play?url=${encodeURIComponent(ytUrl)}`);
            const playData = await playRes.json();
            let fallbackAudio = playData.download_url || playData.download || playData.url;
            
            if (fallbackAudio) {
              const audioRes = await fetch(fallbackAudio);
              const audioBuf = Buffer.from(await audioRes.arrayBuffer());
              if (audioBuf.length > 5000) {
                // Send audio as a fallback since video might not be available
                return await sock.sendMessage(from, {
                  audio: audioBuf,
                  mimetype: 'audio/mpeg',
                  fileName: `${target.title}.mp3`,
                  caption: `🎵 *${target.title}*\n⏱️ *Duration:* ${target.timestamp || 'N/A'}\n\n✅ *YouTube Audio (video download failed, audio fallback)*`
                });
              }
            }
          }
        }
      } catch (ytErr) {
        // Silent fail
      }

      await sock.sendMessage(from, { 
        text: `⚠️ Download Error: ${error.message || 'Unknown error'}\n\n💡 Try a different quality or URL.` 
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
  name: 'pinterest',
  category: 'INFO',
  description: 'Find images on Pinterest',
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
  name: 'waifu',
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
    const sent = await sock.sendMessage(from, { text: '⚡ *NEXUS-MD: MEASURING...*' });
    
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
      await sock.sendMessage(from, { text: status });
    }
  },
});

register({
  name: 'xnxx',
  category: 'NSFW',
  description: 'Search and Download XNXX videos',
  async execute({ sock, from, args }) {
    const prefix = PREFIX;
    const command = 'xnxx';
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `*NEXUS-MD XNXX Tool*\n\n*Search:* ${prefix}${command} Naruto\n*Download:* ${prefix}${command} <link>` 
      });
    }

    const input = args.join(" ");
    const isUrl = input.match(/https?:\/\/(www\.)?xnxx\.(com|health|net|tv)\/[^\s]+/gi);

    try {
      if (isUrl) {
        // --- 📥 DOWNLOAD MODE ---
        await sock.sendMessage(from, { text: '📥 *Downloading video...* This may take a minute for large files.' });
        
        // Exact API provided: https://apis.davidcyril.name.ng/download/xnxx?url=
        const dlApi = `https://apis.davidcyril.name.ng/download/xnxx?url=${encodeURIComponent(isUrl[0])}`;
        const res = await fetch(dlApi);
        const data = await res.json();

        // Deep extraction logic to find the video link in David Cyril's response
        const video = 
          data.result?.files?.high || 
          data.result?.files?.low || 
          data.result?.dl || 
          data.result?.video_url || 
          data.result?.url ||
          (data.result && typeof data.result === 'string' ? data.result : null);

        if (!video) {
          return await sock.sendMessage(from, { 
            text: "❌ *API Error:* The downloader couldn't find a video link for this specific URL. It might be a private video or the API is restricted." 
          });
        }

        await sock.sendMessage(from, {
          video: { url: video },
          caption: `✅ *NEXUS-MD Download*\n📌 *Title:* ${data.result?.title || 'XNXX Video'}\n\n_Powered by David Cyril API_`,
          mimetype: 'video/mp4'
        });

      } else {
        // --- 🔍 SEARCH MODE ---
        await sock.sendMessage(from, { text: `🔍 Searching for: *${input}*...` });
        
        // Exact API provided: https://apis.davidcyril.name.ng/xxx/xnxx?q=
        const searchApi = `https://apis.davidcyril.name.ng/xxx/xnxx?q=${encodeURIComponent(input)}`;
        const res = await fetch(searchApi);
        const data = await res.json();
        
        const results = data.result || data.results || (Array.isArray(data) ? data : []);

        if (!results || results.length === 0) {
          return await sock.sendMessage(from, { text: "❌ No results found. Try different keywords." });
        }

        let msg = `🔞 *XNXX SEARCH RESULTS*\n\n`;
        results.slice(0, 10).forEach((v, i) => {
          const title = v.title || "No Title";
          const link = v.link || v.url;
          msg += `*${i + 1}.* ${title}\n🔗 ${link}\n\n`;
        });
        
        msg += `💡 *Tip:* Copy one of the links above and send \`${prefix}${command} <link>\` to download it.`;
        
        await sock.sendMessage(from, { text: msg });
      }
    } catch (e) {
      console.error("XNXX Command Error:", e);
      await sock.sendMessage(from, { text: "⚠️ *System Error:* The David Cyril API is currently unresponsive. Please try again later." });
    }
  }
});

register({
  name: 'play',
  aliases: ['song', 'music', 'audio'],
  category: 'DOWNLOADER',
  description: 'Search and play music from YouTube',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `🎵 *Music Player*\n\nUsage: ${prefix}${command} <song name or URL>\nExample: ${prefix}${command} Faded\n\n*Examples:*\n${prefix}${command} Shape of You\n${prefix}${command} https://youtu.be/60ItHLz5WEA\n\n*Options:*\n${prefix}${command} <song name> (plays best match)\n${prefix}${command} <url> (plays specific video)` 
      });
    }

    const query = args.join(" ");
    const isUrl = query.includes('youtube.com') || query.includes('youtu.be');

    await sock.sendMessage(from, { text: `⏳ Searching for "${query}"...` });

    try {
      let videoUrl = query;
      let title = '';
      let thumbnail = '';
      let duration = '';
      let artist = '';

      // If it's not a URL, search for it
      if (!isUrl) {
        const yts = require('yt-search');
        const searchResults = await yts(query);
        
        if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
          return await sock.sendMessage(from, { 
            text: `❌ No results found for "${query}".\n\n💡 Try a different search term.` 
          });
        }

        const target = searchResults.videos[0];
        videoUrl = target.url;
        title = target.title || 'YouTube Audio';
        thumbnail = target.thumbnail || target.image || '';
        duration = target.timestamp || target.duration || '';
        artist = target.author?.name || target.author || '';
      }

      // Try to extract metadata if not already set
      if (!title && !isUrl) {
        const yts = require('yt-search');
        const searchResults = await yts(videoUrl);
        if (searchResults && searchResults.videos && searchResults.videos.length > 0) {
          const target = searchResults.videos[0];
          title = target.title || 'YouTube Audio';
          thumbnail = target.thumbnail || target.image || '';
          duration = target.timestamp || target.duration || '';
          artist = target.author?.name || target.author || '';
        }
      }

      // If still no title, use a default
      if (!title) title = 'YouTube Audio';

      // Send thumbnail if available
      if (thumbnail) {
        try {
          await sock.sendMessage(from, {
            image: { url: thumbnail },
            caption: `🎵 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}${duration ? `⏱️ *Duration:* ${duration}\n` : ''}\n\n⬇️ *Downloading audio...*`
          });
        } catch (thumbErr) {
          await sock.sendMessage(from, { 
            text: `🎵 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}${duration ? `⏱️ *Duration:* ${duration}\n` : ''}\n\n⬇️ *Downloading audio...*` 
          });
        }
      }

      // Download via OmegaTech API
      const baseUrl = 'https://omegatech-api.dixonomega.tech';
      const response = await fetch(`${baseUrl}/api/download/play?url=${encodeURIComponent(videoUrl)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Extract audio URL
      let audioUrl = data.download_url || data.download || data.url || 
                     data.result?.download_url || data.result?.download || data.result?.url ||
                     data.data?.download_url || data.data?.download || data.data?.url;

      if (!audioUrl) {
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"']+\.(mp3|m4a|ogg|wav)/i);
        if (urlMatch) audioUrl = urlMatch[0];
      }

      if (!audioUrl) {
        throw new Error("Could not extract download URL from API response.");
      }

      // Download the audio
      const audioResponse = await fetch(audioUrl, {
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

      // Detect if it's MP3 or needs conversion
      const isMP3 = audioBuffer.toString('ascii', 0, 3) === 'ID3' ||
                    (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0);

      let finalBuffer = audioBuffer;
      if (!isMP3) {
        try {
          const { toAudio } = require('../lib/converter');
          const converted = await toAudio(audioBuffer);
          if (converted && converted.length > 1000) {
            finalBuffer = converted;
          }
        } catch (convErr) {
          console.warn('Conversion skipped:', convErr.message);
        }
      }

      // Send the audio
      const safeTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
      const fileName = `${safeTitle}.mp3`;

      try {
        await sock.sendMessage(from, {
          audio: finalBuffer,
          mimetype: 'audio/mpeg',
          fileName: fileName,
          caption: `🎵 *${title}*\n${artist ? `👤 *Artist:* ${artist}\n` : ''}📦 *Size:* ${fileSizeMB} MB\n\n✅ *Download Success*`
        });
      } catch (sendErr) {
        // Fallback: send as document
        await sock.sendMessage(from, {
          document: finalBuffer,
          mimetype: 'audio/mpeg',
          fileName: fileName,
          caption: `🎵 *${title}*\n📦 *Size:* ${fileSizeMB} MB`
        });
      }

    } catch (error) {
      console.error('Play error:', error);

      // Fallback: Prince API
      try {
        const princeUrl = 'https://api.princetechn.com/api/download/ytmp3';
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();

        let fallbackAudio = fallbackData.result?.download_url || fallbackData.result?.url || 
                            fallbackData.download_url || fallbackData.url;
        let fallbackTitle = fallbackData.result?.title || fallbackData.title || 'YouTube Audio';

        if (fallbackAudio) {
          const aRes = await fetch(fallbackAudio);
          const aBuf = Buffer.from(await aRes.arrayBuffer());
          if (aBuf.length > 5000) {
            return await sock.sendMessage(from, {
              audio: aBuf,
              mimetype: 'audio/mpeg',
              fileName: `${fallbackTitle}.mp3`,
              caption: `🎵 *${fallbackTitle}*\n✅ *Download Success (fallback)*`
            });
          }
        }
      } catch (fallbackErr) {
        // Silent fail
      }

      // Fallback: Try yt-search with Prince API
      try {
        if (!isUrl) {
          const yts = require('yt-search');
          const searchResults = await yts(query);
          if (searchResults && searchResults.videos && searchResults.videos.length > 0) {
            const target = searchResults.videos[0];
            const ytUrl = target.url;
            
            const princeUrl = 'https://api.princetechn.com/api/download/ytmp3';
            const fallbackRes = await fetch(`${princeUrl}?apikey=prince&url=${encodeURIComponent(ytUrl)}`);
            const fallbackData = await fallbackRes.json();
            
            let fallbackAudio = fallbackData.result?.download_url || fallbackData.result?.url || 
                                fallbackData.download_url || fallbackData.url;
            
            if (fallbackAudio) {
              const aRes = await fetch(fallbackAudio);
              const aBuf = Buffer.from(await aRes.arrayBuffer());
              if (aBuf.length > 5000) {
                return await sock.sendMessage(from, {
                  audio: aBuf,
                  mimetype: 'audio/mpeg',
                  fileName: `${target.title}.mp3`,
                  caption: `🎵 *${target.title}*\n✅ *Download Success (search fallback)*`
                });
              }
            }
          }
        }
      } catch (ytErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Play Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different song name.` 
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
