const { commands } = require('./commands');
const { checkForceJoin } = require('./forceJoin');
const { getGlobalSetting } = require('./store');
const { DEFAULT_PREFIX } = require('./config');

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

async function handleMessage(sock, m, sessionId) {
  try {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.fromMe
      ? sock.user?.id || from
      : msg.key.participant || from;
    const isGroup = from.endsWith('@g.us');

    // Each linked account can set its own prefix with .setprefix — falls back
    // to the global default until they do.
    const prefix = getGlobalSetting(sessionId, 'prefix') || DEFAULT_PREFIX;

    const text = extractText(msg.message).trim();
    if (!text.startsWith(prefix)) return;

    // We only reach here if the text starts with the command prefix — the bot's own
    // replies never do, so allowing fromMe through can't create a self-reply loop.
    // This is what makes ".ping" etc. work from "Message yourself".

    const [rawCmd, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const cmdName = rawCmd.toLowerCase();
    const command = commands.get(cmdName);
    if (!command) return;

    // The linked account itself (you) is always treated as the owner — never gated.
    if (!msg.key.fromMe) {
      // Private mode: only the owner (fromMe) can trigger commands at all.
      if (getGlobalSetting(sessionId, 'mode') === 'private') return;

      const allowed = await checkForceJoin(sock, from, sender);
      if (!allowed) return;
    }

    const quotedCtx = msg.message.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage
      ? { message: quotedCtx.quotedMessage, key: { remoteJid: from, id: quotedCtx.stanzaId, participant: quotedCtx.participant } }
      : null;

    await sock.sendPresenceUpdate('composing', from);

    await command.execute({
      sock,
      msg,
      from,
      sender,
      args,
      text,
      isGroup,
      sessionId,
      quoted,
      prefix,
      command: cmdName,
    });
  } catch (err) {
    console.error(`[bot:${sessionId}] handler error:`, err.message);
  }
}

module.exports = { handleMessage };
