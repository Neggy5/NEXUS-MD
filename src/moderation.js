const {
  getGroupSettings,
  cacheMessage,
  getCachedMessage,
  getGlobalSetting,
} = require('./store');

const REACT_EMOJIS = ['😀', '🔥', '👍', '💯', '😎', '✅', '⚡', '🎯', '😄', '👏', '🙌', '🚀'];

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

function bareNumber(jid = '') {
  return jid.split('@')[0].split(':')[0];
}

async function isSenderAdmin(sock, jid, sender) {
  try {
    const meta = await sock.groupMetadata(jid);
    const p = meta.participants.find((x) => bareNumber(x.id) === bareNumber(sender));
    return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
  } catch {
    return false;
  }
}

/**
 * Runs on every incoming message alongside the command handler. Unlike bot.js,
 * this does not require a command prefix — it watches all group traffic for
 * deletions, edits, stickers, mass-mentions, and (optionally) reacts to it.
 */
const LINK_RE = /(https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]+\.(com|net|org|io|me|link|gg|xyz|co|app|dev|tv|to|gl|be|ly)\b\S*/i;

async function handleModeration(sock, m, sessionId) {
  try {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;
    // Skip history-sync replay (m.type === 'append') — only act on live messages,
    // otherwise a fresh connect floods reactions/deletes across old chat history.
    if (m.type && m.type !== 'notify') return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = msg.key.fromMe ? sock.user?.id || from : msg.key.participant || from;
    const proto = msg.message.protocolMessage;

    if (isGroup) {
      const settings = getGroupSettings(from);

      // --- Deleted-for-everyone message (REVOKE) ---
      if (proto && proto.type === 0) {
        if (settings.antidelete) {
          const cached = getCachedMessage(proto.key.id);
          if (cached && cached.jid === from) {
            await sock.sendMessage(from, {
              text:
                `🗑️ *Antidelete*\n` +
                `👤 @${bareNumber(cached.sender)} deleted:\n\n` +
                `${cached.text || '[media message]'}`,
              mentions: [cached.sender],
            });
          }
        }
        return;
      }

      // --- Edited message ---
      if (proto && proto.type === 14 && proto.editedMessage) {
        if (settings.antiedit) {
          const cached = getCachedMessage(proto.key.id);
          const newText = extractText(proto.editedMessage) || '[media]';
          if (cached && cached.jid === from) {
            await sock.sendMessage(from, {
              text:
                `✏️ *Antiedit*\n` +
                `👤 @${bareNumber(cached.sender)} edited a message:\n\n` +
                `*Before:* ${cached.text || '[media]'}\n` +
                `*After:* ${newText}`,
              mentions: [cached.sender],
            });
            cacheMessage(proto.key.id, { ...cached, text: newText });
          }
        }
        return;
      }

      // Cache real (non-protocol) messages so a later delete/edit has something to show.
      const text = extractText(msg.message);
      if (text || msg.message.imageMessage || msg.message.videoMessage || msg.message.stickerMessage) {
        cacheMessage(msg.key.id, { jid: from, sender, text, timestamp: Date.now() });
      }

      if (msg.key.fromMe) return; // never moderate the linked account's own messages

      // --- Antisticker ---
      if (settings.antisticker && msg.message.stickerMessage) {
        const admin = await isSenderAdmin(sock, from, sender);
        if (!admin) {
          await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
        }
        return;
      }

      // --- Antigroupmention (mass @mention spam) ---
      if (settings.antigroupmention) {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length >= 5) {
          const admin = await isSenderAdmin(sock, from, sender);
          if (!admin) {
            await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
            await sock.sendMessage(from, {
              text: `⚠️ @${bareNumber(sender)}'s mass-mention message was removed.`,
              mentions: [sender],
            });
            return;
          }
        }
      }

      // --- Antilink (SILENT delete + kick, no group message) ---
      if (settings.antilink && LINK_RE.test(text)) {
        const admin = await isSenderAdmin(sock, from, sender);
        if (!admin) {
          // Delete the message silently
          await sock.sendMessage(from, { delete: msg.key }).catch(() => {});

          // Kick the user silently
          try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
          } catch (kickErr) {
            console.log(`[antilink] kick failed for ${sender}:`, kickErr.message);
          }

          return;
        }
      }
    }

    if (msg.key.fromMe) return; // never react to the linked account's own messages

    // --- Auto-react (owner-level toggle — applies in DMs and groups alike) ---
    if (getGlobalSetting(sessionId, 'autoreact')) {
      const emoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
      sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
    }
  } catch (err) {
    console.error(`[moderation:${sessionId}] error:`, err.message);
  }
}

/**
 * Auto-rejects incoming voice/video calls to the linked account.
 */
function registerAnticall(sock, sessionId) {
  sock.ev.on('call', async (calls) => {
    if (!getGlobalSetting(sessionId, 'anticall')) return;
    for (const call of calls) {
      if (call.status !== 'offer') continue;
      try {
        await sock.rejectCall(call.id, call.from);
        console.log(`[session:${sessionId}] rejected call from ${call.from}`);
      } catch (err) {
        console.error(`[session:${sessionId}] anticall error:`, err.message);
      }
    }
  });
}

/**
 * Fires on every join/leave/promote/demote in every group the linked account
 * is in. Sends the group's configured welcome/goodbye message (if that toggle
 * is on) for each member who joined or left. Supports @user and @group
 * placeholders in the custom message set via .setwelcome / .setgoodbye.
 */
async function handleGroupParticipantsUpdate(sock, update, sessionId) {
  try {
    const { id: groupJid, participants, action } = update;
    if (action !== 'add' && action !== 'remove') return; // ignore promote/demote here

    const settings = getGroupSettings(groupJid);
    const enabled = action === 'add' ? settings.welcome : settings.goodbye;
    if (!enabled) return;

    let groupName = 'the group';
    try {
      const meta = await sock.groupMetadata(groupJid);
      groupName = meta.subject || groupName;
    } catch {
      // fall back to the generic name above if metadata can't be fetched
    }

    const customTemplate = action === 'add' ? settings.welcomeMessage : settings.goodbyeMessage;
    const defaultTemplate =
      action === 'add' ? '👋 Welcome @user to @group! Glad to have you here.' : '👋 @user has left @group. Goodbye!';
    const template = customTemplate || defaultTemplate;

    for (const participant of participants) {
      const text = template
        .replace(/@group/gi, groupName)
        .replace(/@user/gi, `@${bareNumber(participant)}`);
      await sock.sendMessage(groupJid, { text, mentions: [participant] }).catch(() => {});
    }
  } catch (err) {
    console.error(`[moderation:${sessionId}] group-participants error:`, err.message);
  }
}

module.exports = { handleModeration, registerAnticall, handleGroupParticipantsUpdate, isSenderAdmin };