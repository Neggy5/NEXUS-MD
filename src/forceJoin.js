const {
  CHANNEL_LINK,
  GROUP_LINK,
  CHANNEL_CODE,
  GROUP_CODE,
  FORCE_JOIN_ENABLED,
} = require('./config');

// The invite links point to one real channel/group, so once any session resolves the
// group's JID we cache it here and reuse it for membership checks across all sessions.
let resolvedGroupJid = null;

function normalizeNumber(jid = '') {
  // Strips @s.whatsapp.net / @g.us / @lid / device suffixes down to the bare digits,
  // so we can compare a chat sender against a group participant reliably.
  return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

/**
 * Called once a session's socket connects. Makes that WhatsApp account
 * follow the channel and join the force-join group. Failures (e.g. "already
 * a member") are swallowed — this should never crash a session.
 */
async function autoJoin(sock, sessionId) {
  // Follow the channel
  try {
    if (CHANNEL_CODE) {
      const meta = await sock.newsletterMetadata('invite', CHANNEL_CODE);
      if (meta?.id) {
        await sock.newsletterFollow(meta.id);
        console.log(`[session:${sessionId}] following channel ✅`);
      }
    }
  } catch (err) {
    console.log(`[session:${sessionId}] channel follow skipped (${err.message})`);
  }

  // Join the group
  try {
    if (GROUP_CODE) {
      if (!resolvedGroupJid) {
        const info = await sock.groupGetInviteInfo(GROUP_CODE);
        resolvedGroupJid = info?.id || null;
      }
      try {
        await sock.groupAcceptInvite(GROUP_CODE);
        console.log(`[session:${sessionId}] joined group ✅`);
      } catch (joinErr) {
        // Most common case: already a participant — not a real error.
        console.log(`[session:${sessionId}] group join skipped (${joinErr.message})`);
      }
    }
  } catch (err) {
    console.log(`[session:${sessionId}] group resolve failed (${err.message})`);
  }
}

/**
 * Returns true if the message sender is allowed through, false if blocked.
 * When blocked, this also sends the "please join" prompt itself.
 */
async function checkForceJoin(sock, from, sender) {
  if (!FORCE_JOIN_ENABLED) return true;
  if (!resolvedGroupJid) return true; // fail-open if we haven't resolved the group yet

  try {
    const metadata = await sock.groupMetadata(resolvedGroupJid);
    const senderNum = normalizeNumber(sender);
    const isMember = metadata.participants.some((p) => normalizeNumber(p.id) === senderNum);

    if (isMember) return true;

    await sock.sendMessage(from, {
      text:
        `🔒 *Access restricted*\n\n` +
        `Join our group and channel to use this bot:\n\n` +
        `👥 Group: ${GROUP_LINK}\n` +
        `📢 Channel: ${CHANNEL_LINK}\n\n` +
        `Once you've joined the group, send your command again.`,
    });
    return false;
  } catch (err) {
    // If the membership check itself fails (e.g. bot got removed from the group),
    // don't lock everyone out — allow the command through.
    console.log('force-join check failed, allowing through:', err.message);
    return true;
  }
}

module.exports = { autoJoin, checkForceJoin };
