const { commands, PREFIX } = require('./commands');
const { checkForceJoin } = require('./forceJoin');

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
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');

    const text = extractText(msg.message).trim();
    if (!text.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
    const cmdName = rawCmd.toLowerCase();
    const command = commands.get(cmdName);
    if (!command) return;

    const allowed = await checkForceJoin(sock, from, sender);
    if (!allowed) return;

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
    });
  } catch (err) {
    console.error(`[bot:${sessionId}] handler error:`, err.message);
  }
}

module.exports = { handleMessage };
