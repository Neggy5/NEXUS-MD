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
  category: 'AI',
  description: 'Chat with ChatGPT',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Please provide a question.' });
    const res = await fetch(`${P_BASE}/ai/gpt?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `🤖 *GPT:* ${data.result || data.reply}` });
  }
});

register({
  name: 'gemini',
  category: 'AI',
  description: 'Google Gemini AI Assistant',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Ask me anything.' });
    const res = await fetch(`${P_BASE}/ai/gemini?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `✨ *Gemini:* ${data.result}` });
  }
});

register({
  name: 'blackbox',
  category: 'AI',
  description: 'AI Coding and Logic Assistant',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ What code should I write?' });
    const res = await fetch(`${P_BASE}/ai/blackbox?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `💻 *Blackbox AI:*\n\n${data.result}` });
  }
});

register({
  name: 'dalle',
  aliases: ['imagine', 'aiimg'],
  category: 'AI',
  description: 'Generate high-quality AI images',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Describe the image you want to create.' });
    await sock.sendMessage(from, { text: '🎨 *Creating your masterpiece...*' });
    const res = await fetch(`${P_BASE}/ai/dalle?apikey=${P_KEY}&prompt=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { image: { url: data.result }, caption: `✨ *Prompt:* ${text}` });
  }
});

// ==========================================
//            DOWNLOADER COMMANDS
// ==========================================

register({
  name: 'tiktok',
  aliases: ['tt', 'ttdl'],
  category: 'DOWNLOADER',
  description: 'Download TikTok video (No Watermark)',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide a TikTok link.' });
    await princeDownload(sock, from, args[0], 'tiktok', 'video');
  }
});

register({
  name: 'ig',
  aliases: ['igdl', 'instagram'],
  category: 'DOWNLOADER',
  description: 'Download Instagram Reels/Videos',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide an Instagram link.' });
    await princeDownload(sock, from, args[0], 'ig', 'video');
  }
});

register({
  name: 'fb',
  aliases: ['fbdl', 'facebook'],
  category: 'DOWNLOADER',
  description: 'Download Facebook Videos',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide a Facebook link.' });
    await princeDownload(sock, from, args[0], 'facebook', 'video');
  }
});

register({
  name: 'twitter',
  aliases: ['x', 'xdl'],
  category: 'DOWNLOADER',
  description: 'Download X (Twitter) Videos',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide an X/Twitter link.' });
    await princeDownload(sock, from, args[0], 'twitter', 'video');
  }
});

register({
  name: 'spotify',
  category: 'DOWNLOADER',
  description: 'Download songs from Spotify',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide a Spotify link.' });
    await princeDownload(sock, from, args[0], 'spotify', 'audio');
  }
});

register({
  name: 'ytmp4',
  category: 'DOWNLOADER',
  description: 'Download YouTube Video',
  async execute({ sock, from, args }) {
    if (!args[0]) return sock.sendMessage(from, { text: '❌ Please provide a YouTube link.' });
    await princeDownload(sock, from, args[0], 'ytmp4', 'video');
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
    const res = await fetch(`${P_BASE}/search/google?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    let msg = `🔎 *Google Search:* ${text}\n\n`;
    data.result.slice(0, 5).forEach(v => msg += `*${v.title}*\n🔗 ${v.link}\n\n`);
    await sock.sendMessage(from, { text: msg });
  }
});

register({
  name: 'pinterest',
  category: 'INFO',
  description: 'Find images on Pinterest',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Search query?' });
    const res = await fetch(`${P_BASE}/search/pinterest?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    const img = data.result[0];
    await sock.sendMessage(from, { image: { url: img }, caption: `📌 Result for: ${text}` });
  }
});

register({
  name: 'lyrics',
  category: 'INFO',
  description: 'Find song lyrics',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Song name?' });
    const res = await fetch(`${P_BASE}/search/lyrics?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `🎶 *Lyrics:* ${text}\n\n${data.result}` });
  }
});

register({
  name: 'wikipedia',
  category: 'INFO',
  description: 'Search Wikipedia',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Search query?' });
    const res = await fetch(`${P_BASE}/search/wiki?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `📖 *Wikipedia:* ${text}\n\n${data.result}` });
  }
});

register({
  name: 'weather',
  category: 'INFO',
  description: 'Check weather of any city',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Provide city name.' });
    const res = await fetch(`${P_BASE}/search/weather?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    const w = data.result;
    await sock.sendMessage(from, { text: `🌡️ *Weather: ${text}*\n\n☁️ Condition: ${w.condition}\n🌡️ Temp: ${w.temp}°C\n💧 Humidity: ${w.humidity}` });
  }
});

register({
  name: 'github',
  category: 'INFO',
  description: 'Search GitHub user profiles',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ GitHub username?' });
    const res = await fetch(`${P_BASE}/search/github?apikey=${P_KEY}&query=${encodeURIComponent(text)}`);
    const data = await res.json();
    const v = data.result;
    const info = `👤 *User:* ${v.login}\n📂 *Repos:* ${v.public_repos}\n👥 *Followers:* ${v.followers}\n🔗 *Link:* ${v.html_url}`;
    await sock.sendMessage(from, { image: { url: v.avatar_url }, caption: info });
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
    const res = await fetch(`${P_BASE}/tools/tinyurl?apikey=${P_KEY}&url=${args[0]}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `🔗 *Shortened:* ${data.result}` });
  }
});

register({
  name: 'translate',
  category: 'TOOLS',
  description: 'Translate text to English',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Text to translate?' });
    const res = await fetch(`${P_BASE}/tools/translate?apikey=${P_KEY}&query=${encodeURIComponent(text)}&lang=en`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `🌍 *Translation:* ${data.result}` });
  }
});

register({
  name: 'meme',
  category: 'TOOLS',
  description: 'Get a random meme',
  async execute({ sock, from }) {
    await sock.sendMessage(from, { image: { url: `${P_BASE}/tools/meme?apikey=${P_KEY}` }, caption: '😂' });
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
  category: 'TOOLS',
  description: 'Get a random interesting fact',
  async execute({ sock, from }) {
    const res = await fetch(`${P_BASE}/tools/fact?apikey=${P_KEY}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `💡 *Did you know?*\n\n${data.result}` });
  }
});

register({
  name: 'quote',
  category: 'TOOLS',
  description: 'Get a random motivational quote',
  async execute({ sock, from }) {
    const res = await fetch(`${P_BASE}/tools/quote?apikey=${P_KEY}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `💬 "${data.result.quote}"\n\n— *${data.result.author}*` });
  }
});

register({
  name: 'define',
  category: 'INFO',
  description: 'Dictionary definition',
  async execute({ sock, from, text }) {
    if (!text) return sock.sendMessage(from, { text: '❓ Word to define?' });
    const res = await fetch(`${P_BASE}/search/dictionary?apikey=${P_KEY}&query=${text}`);
    const data = await res.json();
    await sock.sendMessage(from, { text: `📖 *Definition:* ${text}\n\n${data.result}` });
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

    // Send the detailed status as an edit or a new message quoting the first one
    await sock.sendMessage(from, { 
      text: status, 
      edit: sent.key 
    });
  },
});

register({
  name: 'xnxx',
  category: 'NSFW',
  description: 'Search and Download XNXX videos',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `*NEXUS-MD XNXX Tool*\n\n*Search:* ${prefix}${command} Naruto\n*Download:* ${prefix}${command} <link>` 
      });
    }

    const input = args.join(" ");
    // Regular expression to detect if the input is an XNXX link
    const isUrl = input.match(/https?:\/\/(www\.)?xnxx\.(com|health|net)\/[^\s]+/gi);

    try {
      if (isUrl) {
        // --- DOWNLOAD MODE (using davidcyril.name.ng/download/xnxx) ---
        await sock.sendMessage(from, { text: '📥 *Downloading video...* Please wait.' });
        
        const dlApi = `https://apis.davidcyril.name.ng/download/xnxx?url=${encodeURIComponent(isUrl[0])}`;
        const res = await fetch(dlApi);
        const data = await res.json();

        // David Cyril API usually returns link in result.dl or result.video_url
        const video = data.result?.dl || data.result?.video_url || data.result?.url;

        if (!video) throw new Error("Could not find download link. The video might be too large or private.");

        await sock.sendMessage(from, {
          video: { url: video },
          caption: `✅ *NEXUS-MD Success*`,
          mimetype: 'video/mp4'
        });

      } else {
        // --- SEARCH MODE (using davidcyril.name.ng/xxx/xnxx) ---
        await sock.sendMessage(from, { text: `🔍 Searching for: *${input}*...` });
        
        const searchApi = `https://apis.davidcyril.name.ng/xxx/xnxx?query=${encodeURIComponent(input)}`;
        const res = await fetch(searchApi);
        const data = await res.json();
        
        // Find the array in the response (result or results)
        const results = data.result || data.results || (Array.isArray(data) ? data : []);

        if (!results.length) return await sock.sendMessage(from, { text: "❌ No results found for your query." });

        let msg = `🔞 *XNXX SEARCH RESULTS*\n\n`;
        results.slice(0, 10).forEach((v, i) => {
          const title = v.title || "No Title";
          const link = v.link || v.url;
          msg += `*${i + 1}.* ${title}\n🔗 ${link}\n\n`;
        });
        
        msg += `💡 *Tip:* Copy one of the links above and send \`${prefix}${command} <link>\` to download the video file.`;
        
        await sock.sendMessage(from, { text: msg });
      }
    } catch (e) {
      console.error("XNXX Error:", e);
      await sock.sendMessage(from, { text: "⚠️ API Error: " + (e.message || "Request failed") });
    }
  }
});

register({
  name: 'play',
  category: 'DOWNLOADER',
  description: 'Play audio from YouTube',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) return await sock.sendMessage(from, { text: `*Example:* ${prefix}${command} Faded` });

    const query = args.join(" ");
    const baseUrl = 'https://omegatech-api.dixonomega.tech';

    try {
      await sock.sendMessage(from, { text: `🎧 Processing: *${query}*...` });

      // 1. Search for the video using yt-search (local)
      const yts = require('yt-search');
      const searchResults = await yts(query);
      
      if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
        return await sock.sendMessage(from, { text: "❌ No results found." });
      }

      const target = searchResults.videos[0];
      const videoUrl = target.url;

      // 2. Download audio via OmegaTech API
      const apiUrl = `${baseUrl}/api/download/play?url=${encodeURIComponent(videoUrl)}`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);

      const data = await res.json();
      
      // Extract download URL (handle different response structures)
      let audioUrl = data.download_url || data.download || data.url || 
                     data.result?.download_url || data.result?.download || data.result?.url;

      if (!audioUrl) {
        // Fallback: try to find any URL in the response
        const jsonString = JSON.stringify(data);
        const urlMatch = jsonString.match(/https?:\/\/[^\s"',]+\.(mp3|m4a|ogg|wav)/i);
        if (urlMatch) audioUrl = urlMatch[0];
      }

      if (!audioUrl) {
        throw new Error("Could not extract download URL from API response.");
      }

      // 3. Send thumbnail first
      if (target.thumbnail) {
        await sock.sendMessage(from, {
          image: { url: target.thumbnail },
          caption: `🎵 *${target.title}*\n⏱️ *Duration:* ${target.timestamp || 'N/A'}`
        });
      }

      // 4. Download and send audio
      const audioRes = await fetch(audioUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`);

      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      if (audioBuffer.length < 10000) {
        throw new Error("Downloaded file is too small. The link may be invalid.");
      }

      // Detect if it's MP3 or needs conversion
      const isMP3 = audioBuffer.toString('ascii', 0, 3) === 'ID3' ||
                    (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0);

      if (!isMP3) {
        // Try to convert using the existing converter if available
        try {
          const { toAudio } = require('../lib/converter');
          const converted = await toAudio(audioBuffer);
          if (converted && converted.length > 1000) {
            await sock.sendMessage(from, {
              audio: converted,
              mimetype: 'audio/mpeg',
              fileName: `${target.title}.mp3`
            });
            return;
          }
        } catch (convErr) {
          console.warn('Conversion skipped:', convErr.message);
        }
      }

      await sock.sendMessage(from, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        fileName: `${target.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
      });

    } catch (e) {
      console.error('Play error:', e);
      await sock.sendMessage(from, { 
        text: `⚠️ API Error: ${e.message || 'Unknown error'}` 
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
