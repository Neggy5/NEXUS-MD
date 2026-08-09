const { commands } = require('./commands');
const { checkForceJoin } = require('./forceJoin');
const { getGlobalSetting } = require('./store');
const { DEFAULT_PREFIX } = require('./config');

function extractText(message) {
  if (!message) return '';

  // Native-flow replies (list rows / quick-reply buttons from an
  // interactiveMessage, e.g. the .richmenu command) come back as a JSON
  // string on nativeFlowResponseMessage.paramsJson, not as plain text.
  const nativeFlow = message.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (nativeFlow?.paramsJson) {
    try {
      const params = JSON.parse(nativeFlow.paramsJson);
      if (params.id) return params.id;
    } catch {
      // fall through to the plain-text checks below
    }
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    // Older-style list/button messages, for compatibility.
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.buttonsResponseMessage?.selectedButtonId ||
    ''
  );
}

async function handleMessage(sock, m, sessionId) {
  // messages.upsert can carry more than one message in a single event
  // (e.g. catching up after a reconnect) — handle every one, not just the first.
  for (const msg of m.messages || []) {
    await handleSingleMessage(sock, msg, sessionId);
  }
}

async function handleSingleMessage(sock, msg, sessionId) {
  try {
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
