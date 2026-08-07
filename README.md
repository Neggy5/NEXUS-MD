# ⚡ NEXUS-MD

A multi-user WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys), linked via a **web pairing-code page** (no QR scanning needed). Any number of users can visit the same deployed URL, link their own WhatsApp number, and the bot starts working for them automatically and independently.

## How it works

1. You deploy this once to Railway.
2. Anyone visits your Railway URL (`https://your-app.up.railway.app`).
3. They enter their WhatsApp number (with country code).
4. The site shows an 8-character pairing code.
5. On their phone: **WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead**, then they type the code.
6. Once linked, the bot instantly starts responding to that user's chats — commands like `.menu`, `.ping`, `.sticker`, etc.
7. Each linked number runs as its own isolated session (own auth folder, own socket), so many users can be linked at the same time with no interference.

## Local setup

```bash
npm install
cp .env.example .env
npm start
```

Visit `http://localhost:3000`.

## Deploying to Railway

1. Push this project to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → select the repo.
3. Railway auto-detects Node via Nixpacks and runs `npm start` (see `railway.json` / `Procfile`).
4. Set environment variables in Railway's **Variables** tab (see `.env.example`) — at minimum `PORT` is provided automatically by Railway, so you usually don't need to set it.
5. **Important — session persistence:** Railway's filesystem is ephemeral across redeploys. To keep users linked across deploys/restarts, add a **Railway Volume** and mount it at `/app/sessions`. Without a volume, everyone will need to re-link whenever the service redeploys.
6. Deploy. Open the generated Railway URL — that's your pairing page.

## Commands

| Command | Category | Description |
|---|---|---|
| `.menu` / `.help` | MAIN | Shows the full command list |
| `.ping` | MAIN | Latency check |
| `.alive` | MAIN | Bot status |
| `.runtime` | MAIN | Uptime |
| `.jid` | INFO | Get current chat JID |
| `.owner` | INFO | Owner contact |
| `.source` | INFO | About the bot |
| `.sticker` / `.s` | TOOLS | Convert an image/video to a sticker |

Change the prefix with the `PREFIX` env var (default `.`).

## Auto channel-follow & force group-join

When any linked account connects, it automatically:
- Follows the WhatsApp **channel**: `https://whatsapp.com/channel/0029VbCoHP4Id7nGRtKYuA0A`
- Joins the WhatsApp **group**: `https://chat.whatsapp.com/GMHYNRFJhyiFhM5h5tE0FX`

After that, every user who messages the bot must be a member of that group before any command runs. If they're not, the bot replies with both links and blocks the command until they join and re-send it.

- Turn this gate off with `FORCE_JOIN=false` in env vars (channel auto-follow still happens either way).
- Change the links via `FORCE_CHANNEL_LINK` / `FORCE_GROUP_LINK` env vars, or directly in `src/config.js`.
- Logic lives in `src/forceJoin.js` — `autoJoin()` runs on connect, `checkForceJoin()` runs before every command.
- The check "fails open": if the group-membership lookup errors for any reason (e.g. the bot account gets removed from the group), users aren't locked out.

## Adding new commands

Open `src/commands/index.js` and call `register({...})`:

```js
register({
  name: 'hello',
  category: 'MAIN',
  description: 'Say hello',
  async execute({ sock, from }) {
    await sock.sendMessage(from, { text: 'Hello there!' });
  },
});
```

It shows up in `.menu` automatically.

## Project structure

```
nexus-md/
├── index.js                 # Express server + pairing API
├── src/
│   ├── sessionManager.js     # Multi-user Baileys session lifecycle
│   ├── bot.js                 # Incoming message → command dispatch
│   ├── logger.js
│   └── commands/index.js      # Command registry & menu design
├── public/                    # Pairing web UI (HTML/CSS/JS)
├── sessions/                  # Per-user auth state (mount a volume here)
├── railway.json
└── Procfile
```

## Notes

- This uses WhatsApp's official multi-device linking mechanism via Baileys — the same protocol WhatsApp Web/Desktop uses. It is not affiliated with or endorsed by WhatsApp/Meta; use responsibly and in line with WhatsApp's Terms of Service.
- Don't use this for bulk/unsolicited messaging — that risks the linked number being banned.
