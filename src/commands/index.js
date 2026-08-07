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





    const text = args.join(" ");

    // Unicode character maps for different styles
    const styles = {
      // Bold
      bold: text.split('').map(c => {
        const map = {
          'A':'𝗔','B':'𝗕','C':'𝗖','D':'𝗗','E':'𝗘','F':'𝗙','G':'𝗚','H':'𝗛','I':'𝗜','J':'𝗝','K':'𝗞','L':'𝗟','M':'𝗠','N':'𝗡','O':'𝗢','P':'𝗣','Q':'𝗤','R':'𝗥','S':'𝗦','T':'𝗧','U':'𝗨','V':'𝗩','W':'𝗪','X':'𝗫','Y':'𝗬','Z':'𝗭',
          'a':'𝗮','b':'𝗯','c':'𝗰','d':'𝗱','e':'𝗲','f':'𝗳','g':'𝗴','h':'𝗵','i':'𝗶','j':'𝗷','k':'𝗸','l':'𝗹','m':'𝗺','n':'𝗻','o':'𝗼','p':'𝗽','q':'𝗾','r':'𝗿','s':'𝘀','t':'𝘁','u':'𝘂','v':'𝘃','w':'𝘄','x':'𝘅','y':'𝘆','z':'𝘇',
          '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'
        };
        return map[c] || c;
      }).join(''),

      // Italic
      italic: text.split('').map(c => {
        const map = {
          'A':'𝘈','B':'𝘉','C':'𝘊','D':'𝘋','E':'𝘌','F':'𝘍','G':'𝘎','H':'𝘏','I':'𝘐','J':'𝘑','K':'𝘒','L':'𝘓','M':'𝘔','N':'𝘕','O':'𝘖','P':'𝘗','Q':'𝘘','R':'𝘙','S':'𝘚','T':'𝘛','U':'𝘜','V':'𝘝','W':'𝘞','X':'𝘟','Y':'𝘠','Z':'𝘡',
          'a':'𝘢','b':'𝘣','c':'𝘤','d':'𝘥','e':'𝘦','f':'𝘧','g':'𝘨','h':'𝘩','i':'𝘪','j':'𝘫','k':'𝘬','l':'𝘭','m':'𝘮','n':'𝘯','o':'𝘰','p':'𝘱','q':'𝘲','r':'𝘳','s':'𝘴','t':'𝘵','u':'𝘶','v':'𝘷','w':'𝘸','x':'𝘹','y':'𝘺','z':'𝘻'
        };
        return map[c] || c;
      }).join(''),

      // Bold Italic
      bolditalic: text.split('').map(c => {
        const map = {
          'A':'𝙰','B':'𝙱','C':'𝙲','D':'𝙳','E':'𝙴','F':'𝙵','G':'𝙶','H':'𝙷','I':'𝙸','J':'𝙹','K':'𝙺','L':'𝙻','M':'𝙼','N':'𝙽','O':'𝙾','P':'𝙿','Q':'𝚀','R':'𝚁','S':'𝚂','T':'𝚃','U':'𝚄','V':'𝚅','W':'𝚆','X':'𝚇','Y':'𝚈','Z':'𝚉',
          'a':'𝚊','b':'𝚋','c':'𝚌','d':'𝚍','e':'𝚎','f':'𝚏','g':'𝚐','h':'𝚑','i':'𝚒','j':'𝚓','k':'𝚔','l':'𝚕','m':'𝚖','n':'𝚗','o':'𝚘','p':'𝚙','q':'𝚚','r':'𝚛','s':'𝚜','t':'𝚝','u':'𝚞','v':'𝚟','w':'𝚠','x':'𝚡','y':'𝚢','z':'𝚣'
        };
        return map[c] || c;
      }).join(''),

      // Sans-Serif
      sans: text.split('').map(c => {
        const map = {
          'A':'𝖠','B':'𝖡','C':'𝖢','D':'𝖣','E':'𝖤','F':'𝖥','G':'𝖦','H':'𝖧','I':'𝖨','J':'𝖩','K':'𝖪','L':'𝖫','M':'𝖬','N':'𝖭','O':'𝖮','P':'𝖯','Q':'𝖰','R':'𝖱','S':'𝖲','T':'𝖳','U':'𝖴','V':'𝖵','W':'𝖶','X':'𝖷','Y':'𝖸','Z':'𝖹',
          'a':'𝖺','b':'𝖻','c':'𝖼','d':'𝖽','e':'𝖾','f':'𝖿','g':'𝗀','h':'𝗁','i':'𝗂','j':'𝗃','k':'𝗄','l':'𝗅','m':'𝗆','n':'𝗇','o':'𝗈','p':'𝗉','q':'𝗊','r':'𝗋','s':'𝗌','t':'𝗍','u':'𝗎','v':'𝗏','w':'𝗐','x':'𝗑','y':'𝗒','z':'𝗓'
        };
        return map[c] || c;
      }).join(''),

      // Script
      script: text.split('').map(c => {
        const map = {
          'A':'𝒜','B':'ℬ','C':'𝒞','D':'𝒟','E':'ℰ','F':'ℱ','G':'𝒢','H':'ℋ','I':'ℐ','J':'𝒥','K':'𝒦','L':'ℒ','M':'ℳ','N':'𝒩','O':'𝒪','P':'𝒫','Q':'𝒬','R':'ℛ','S':'𝒮','T':'𝒯','U':'𝒰','V':'𝒱','W':'𝒲','X':'𝒳','Y':'𝒴','Z':'𝒵',
          'a':'𝒶','b':'𝒷','c':'𝒸','d':'𝒹','e':'ℯ','f':'𝒻','g':'ℊ','h':'𝒽','i':'𝒾','j':'𝒿','k':'𝓀','l':'𝓁','m':'𝓂','n':'𝓃','o':'ℴ','p':'𝓅','q':'𝓆','r':'𝓇','s':'𝓈','t':'𝓉','u':'𝓊','v':'𝓋','w':'𝓌','x':'𝓍','y':'𝓎','z':'𝓏'
        };
        return map[c] || c;
      }).join(''),

      // Gothic
      gothic: text.split('').map(c => {
        const map = {
          'A':'𝔄','B':'𝔅','C':'ℭ','D':'𝔇','E':'𝔈','F':'𝔉','G':'𝔊','H':'ℌ','I':'ℑ','J':'𝔍','K':'𝔎','L':'𝔏','M':'𝔐','N':'𝔑','O':'𝔒','P':'𝔓','Q':'𝔔','R':'ℜ','S':'𝔖','T':'𝔗','U':'𝔘','V':'𝔙','W':'𝔚','X':'𝔛','Y':'𝔜','Z':'ℨ',
          'a':'𝔞','b':'𝔟','c':'𝔠','d':'𝔡','e':'𝔢','f':'𝔣','g':'𝔤','h':'𝔥','i':'𝔦','j':'𝔧','k':'𝔨','l':'𝔩','m':'𝔪','n':'𝔫','o':'𝔬','p':'𝔭','q':'𝔮','r':'𝔯','s':'𝔰','t':'𝔱','u':'𝔲','v':'𝔳','w':'𝔴','x':'𝔵','y':'𝔶','z':'𝔷'
        };
        return map[c] || c;
      }).join(''),

      // Monospace
      mono: text.split('').map(c => {
        const map = {
          'A':'𝙰','B':'𝙱','C':'𝙲','D':'𝙳','E':'𝙴','F':'𝙵','G':'𝙶','H':'𝙷','I':'𝙸','J':'𝙹','K':'𝙺','L':'𝙻','M':'𝙼','N':'𝙽','O':'𝙾','P':'𝙿','Q':'𝚀','R':'𝚁','S':'𝚂','T':'𝚃','U':'𝚄','V':'𝚅','W':'𝚆','X':'𝚇','Y':'𝚈','Z':'𝚉',
          'a':'𝚊','b':'𝚋','c':'𝚌','d':'𝚍','e':'𝚎','f':'𝚏','g':'𝚐','h':'𝚑','i':'𝚒','j':'𝚓','k':'𝚔','l':'𝚕','m':'𝚖','n':'𝚗','o':'𝚘','p':'𝚙','q':'𝚚','r':'𝚛','s':'𝚜','t':'𝚝','u':'𝚞','v':'𝚟','w':'𝚠','x':'𝚡','y':'𝚢','z':'𝚣'
        };
        return map[c] || c;
      }).join(''),

      // Fraktur
      fraktur: text.split('').map(c => {
        const map = {
          'A':'𝕬','B':'𝕭','C':'𝕮','D':'𝕯','E':'𝕰','F':'𝕱','G':'𝕲','H':'𝕳','I':'𝕴','J':'𝕵','K':'𝕶','L':'𝕷','M':'𝕸','N':'𝕹','O':'𝕺','P':'𝕻','Q':'𝕼','R':'𝕽','S':'𝕾','T':'𝕿','U':'𝖀','V':'𝖁','W':'𝖂','X':'𝖃','Y':'𝖄','Z':'𝖅',
          'a':'𝖆','b':'𝖇','c':'𝖈','d':'𝖉','e':'𝖊','f':'𝖋','g':'𝖌','h':'𝖍','i':'𝖎','j':'𝖏','k':'𝖐','l':'𝖑','m':'𝖒','n':'𝖓','o':'𝖔','p':'𝖕','q':'𝖖','r':'𝖗','s':'𝖘','t':'𝖙','u':'𝖚','v':'𝖛','w':'𝖜','x':'𝖝','y':'𝖞','z':'𝖟'
        };
        return map[c] || c;
      }).join(''),

      // Bubble (circled)
      bubble: text.split('').map(c => {
        const map = {
          'A':'🅰','B':'🅱','C':'🅲','D':'🅳','E':'🅴','F':'🅵','G':'🅶','H':'🅷','I':'🅸','J':'🅹','K':'🅺','L':'🅻','M':'🅼','N':'🅽','O':'🅾','P':'🅿','Q':'🆀','R':'🆁','S':'🆂','T':'🆃','U':'🆄','V':'🆅','W':'🆆','X':'🆇','Y':'🆈','Z':'🆉',
          'a':'🅰','b':'🅱','c':'🅲','d':'🅳','e':'🅴','f':'🅵','g':'🅶','h':'🅷','i':'🅸','j':'🅹','k':'🅺','l':'🅻','m':'🅼','n':'🅽','o':'🅾','p':'🅿','q':'🆀','r':'🆁','s':'🆂','t':'🆃','u':'🆄','v':'🆅','w':'🆆','x':'🆇','y':'🆈','z':'🆉',
          '0':'0️⃣','1':'1️⃣','2':'2️⃣','3':'3️⃣','4':'4️⃣','5':'5️⃣','6':'6️⃣','7':'7️⃣','8':'8️⃣','9':'9️⃣'
        };
        return map[c] || c;
      }).join(''),

      // Square
      square: text.split('').map(c => {
        const map = {
          'A':'🄰','B':'🄱','C':'🄲','D':'🄳','E':'🄴','F':'🄵','G':'🄶','H':'🄷','I':'🄸','J':'🄹','K':'🄺','L':'🄻','M':'🄼','N':'🄽','O':'🄾','P':'🄿','Q':'🅀','R':'🅁','S':'🅂','T':'🅃','U':'🅄','V':'🅅','W':'🅆','X':'🅇','Y':'🅈','Z':'🅉'
        };
        return map[c] || c;
      }).join(''),

      // Double-struck
      double: text.split('').map(c => {
        const map = {
          'A':'𝔸','B':'𝔹','C':'ℂ','D':'𝔻','E':'𝔼','F':'𝔽','G':'𝔾','H':'ℍ','I':'𝕀','J':'𝕁','K':'𝕂','L':'𝕃','M':'𝕄','N':'ℕ','O':'𝕆','P':'ℙ','Q':'ℚ','R':'ℝ','S':'𝕊','T':'𝕋','U':'𝕌','V':'𝕍','W':'𝕎','X':'𝕏','Y':'𝕐','Z':'ℤ',
          'a':'𝕒','b':'𝕓','c':'𝕔','d':'𝕕','e':'𝕖','f':'𝕗','g':'𝕘','h':'𝕙','i':'𝕚','j':'𝕛','k':'𝕜','l':'𝕝','m':'𝕞','n':'𝕟','o':'𝕠','p':'𝕡','q':'𝕢','r':'𝕣','s':'𝕤','t':'𝕥','u':'𝕦','v':'𝕧','w':'𝕨','x':'𝕩','y':'𝕪','z':'𝕫',
          '0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'
        };
        return map[c] || c;
      }).join(''),

      // Slashed
      slashed: text.split('').map(c => {
        const map = {
          'A':'Ⱥ','B':'Ƀ','C':'Ȼ','D':'Đ','E':'Ɇ','F':'Ƒ','G':'Ǥ','H':'Ħ','I':'Ɨ','J':'Ɉ','K':'Ꝁ','L':'Ł','M':'Ɱ','N':'Ŋ','O':'Ø','P':'Ᵽ','Q':'Ꝗ','R':'Ɍ','S':'Ꞩ','T':'Ŧ','U':'Ʉ','V':'V̸','W':'W̸','X':'X̸','Y':'Ɏ','Z':'Ƶ'
        };
        return map[c] || c;
      }).join(''),

      // Cursive
      cursive: text.split('').map(c => {
        const map = {
          'A':'𝓐','B':'𝓑','C':'𝓒','D':'𝓓','E':'𝓔','F':'𝓕','G':'𝓖','H':'𝓗','I':'𝓘','J':'𝓙','K':'𝓚','L':'𝓛','M':'𝓜','N':'𝓝','O':'𝓞','P':'𝓟','Q':'𝓠','R':'𝓡','S':'𝓢','T':'𝓣','U':'𝓤','V':'𝓥','W':'𝓦','X':'𝓧','Y':'𝓨','Z':'𝓩',
          'a':'𝓪','b':'𝓫','c':'𝓬','d':'𝓭','e':'𝓮','f':'𝓯','g':'𝓰','h':'𝓱','i':'𝓲','j':'𝓳','k':'𝓴','l':'𝓵','m':'𝓶','n':'𝓷','o':'𝓸','p':'𝓹','q':'𝓺','r':'𝓻','s':'𝓼','t':'𝓽','u':'𝓾','v':'𝓿','w':'𝔀','x':'𝔁','y':'𝔂','z':'𝔃'
        };
        return map[c] || c;
      }).join('')
    };

    // Build the response
    let msg = `✨ *Fancy Text Generator*\n📝 *Original:* ${text}\n\n`;
    msg += `*1. Bold:* ${styles.bold}\n`;
    msg += `*2. Italic:* ${styles.italic}\n`;
    msg += `*3. Bold Italic:* ${styles.bolditalic}\n`;
    msg += `*4. Sans-Serif:* ${styles.sans}\n`;
    msg += `*5. Script:* ${styles.script}\n`;
    msg += `*6. Gothic:* ${styles.gothic}\n`;
    msg += `*7. Monospace:* ${styles.mono}\n`;
    msg += `*8. Fraktur:* ${styles.fraktur}\n`;
    msg += `*9. Bubble:* ${styles.bubble}\n`;
    msg += `*10. Square:* ${styles.square}\n`;
    msg += `*11. Double-struck:* ${styles.double}\n`;
    msg += `*12. Slashed:* ${styles.slashed}\n`;
    msg += `*13. Cursive:* ${styles.cursive}`;

    await sock.sendMessage(from, { text: msg });

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
  name: 'blackbox',
  aliases: ['bb', 'codeai', 'codingai'],
  category: 'AI',
  description: 'AI Coding & Logic Assistant (Blackbox AI)',
  async execute({ sock, from, args, prefix, command }) {
    if (!args[0]) {
      return await sock.sendMessage(from, { 
        text: `💻 *Blackbox AI Assistant*\n\nUsage: ${prefix}${command} <your question>\nExample: ${prefix}${command} Write a Python function to sort a list\n\n*Examples:*\n${prefix}${command} Explain closures in JavaScript\n${prefix}${command} Debug this code: console.log('hello'\n${prefix}${command} Create a React component for a button` 
      });
    }

    const query = args.join(" ");

    await sock.sendMessage(from, { text: `⏳ Analyzing code...` });

    try {
      // Use the correct endpoint: /blackbox
      const response = await fetch(
        `https://apis.davidcyril.name.ng/blackbox?query=${encodeURIComponent(query)}`,
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

      // Extract response from various formats
      let reply = data.result || data.reply || data.message || data.response || data.text || data.code || data.data || data.answer;

      if (!reply) {
        const jsonString = JSON.stringify(data);
        const textMatch = jsonString.match(/"result":"([^"]+)"/) || 
                          jsonString.match(/"reply":"([^"]+)"/) ||
                          jsonString.match(/"message":"([^"]+)"/) ||
                          jsonString.match(/"code":"([^"]+)"/) ||
                          jsonString.match(/"answer":"([^"]+)"/);
        if (textMatch) reply = textMatch[1];
      }

      if (!reply) {
        throw new Error("Could not extract response from Blackbox AI.");
      }

      reply = reply.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '  ');

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
        const fallbackRes = await fetch(`${princeUrl}?apikey=prince&query=${encodeURIComponent(query)}`);
        const fallbackData = await fallbackRes.json();
        const fallbackReply = fallbackData.result || fallbackData.reply || fallbackData.code;
        
        if (fallbackReply) {
          return await sock.sendMessage(from, { 
            text: `💻 *Blackbox AI (fallback):*\n\n${fallbackReply}` 
          });
        }
      } catch (fallbackErr) {}

      await sock.sendMessage(from, { 
        text: `⚠️ Blackbox Error: ${error.message || 'Unknown error'}\n\n💡 Try again or use a different question.` 
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
