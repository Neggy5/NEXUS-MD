const express = require('express');
const path = require('path');
const { startSession, getStatus, listSessions, sanitizeId, resumeAllSessions } = require('./src/sessionManager');
const { CHANNEL_LINK, GROUP_LINK } = require('./src/config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Request a pairing code for a phone number (e.g. "15551234567", no + or spaces)
app.post('/api/pair', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^\d{7,15}$/.test(phone.replace(/[^0-9]/g, ''))) {
      return res.status(400).json({ error: 'Enter a valid phone number with country code, digits only.' });
    }
    const result = await startSession(phone);
    res.json(result);
  } catch (err) {
    console.error('pair error:', err);
    res.status(500).json({ error: 'Could not generate a pairing code. Try again in a moment.' });
  }
});

// Community links shown on the frontend (also used for the force-join gate).
app.get('/api/links', (_req, res) => {
  res.json({ channel: CHANNEL_LINK, group: GROUP_LINK });
});

// Poll connection status for a session
app.get('/api/status/:sessionId', (req, res) => {
  res.json(getStatus(req.params.sessionId));
});

// Admin: list all active sessions
app.get('/api/sessions', (_req, res) => {
  res.json(listSessions());
});

app.listen(PORT, () => {
  console.log(`NEXUS-MD web server listening on port ${PORT}`);
  resumeAllSessions().catch((e) => console.error('resumeAllSessions error:', e.message));
});
