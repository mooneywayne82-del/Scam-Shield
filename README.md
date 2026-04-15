# PI Scam Shield

A web app that lets PI Network Pioneers report suspicious websites to your community's moderation team via Discord. Pioneers authenticate with their PI Network account inside the PI Browser, so every report is tied to a verified Pioneer username.

---

## Release notes

See [`CHANGELOG.md`](./CHANGELOG.md) for release checkpoints and troubleshooting-focused updates.

---

## Features

- **PI Network login** — Pioneers authenticate via the PI Browser; identity is verified server-side against the PI Platform API
- **Categorised reports** — Phishing, Fake PI App, Scam/Fraud, Malware, Other
- **Discord embed** — Reports arrive in your moderation channel as rich embeds with the Pioneer's username, category, URL, and description
- **Rate limiting** — 5 reports per IP per 15 minutes to prevent spam
- **Secure by default** — Helmet security headers, strict input validation, HTTPS-only URL enforcement

---

## Requirements

| Requirement | Notes |
|---|---|
| Node.js 18+ | [nodejs.org](https://nodejs.org) |
| PI Developer account | [developers.minepi.com](https://developers.minepi.com) |
| Discord webhook URL | See setup below |
| Public HTTPS host | Required for the PI Browser to open your app |

---

## Setup

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment variables

```bash
copy .env.example .env
```

Open `.env` and set your values:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
PORT=3000
SANDBOX=false
```

#### Getting your Discord webhook URL

1. Go to your Discord server → **Server Settings → Integrations → Webhooks**
2. Click **New Webhook**, give it a name (e.g. `Scam Shield Bot`), and choose a channel (e.g. `#scam-reports`)
3. Click **Copy Webhook URL** and paste it into `.env`

### 3 — Register your app in the PI Developer Portal

1. Log in at [developers.minepi.com](https://developers.minepi.com)
2. Create a new app (or use an existing one)
3. Set the **App URL** to your deployed HTTPS URL

### 4 — Deploy to a public HTTPS host

The PI Browser requires HTTPS. Some zero-cost options:

| Platform | Notes |
|---|---|
| [Render](https://render.com) | Free tier, auto-HTTPS |
| [Railway](https://railway.app) | Simple Node.js deploy |
| [Fly.io](https://fly.io) | Free tier available |

Push your code, set the environment variables in the platform dashboard, and copy the public URL into the PI Developer Portal.

### 5 — Run locally (development)

```bash
npm run dev
```

For local desktop testing, set `SANDBOX=true` in `.env` so the PI SDK runs in sandbox mode.

---

## Project structure

```
Scam Shield/
├── public/
│   ├── index.html   — App UI (login + report form)
│   ├── style.css    — Styles
│   └── app.js       — PI SDK auth + form logic
├── server.js        — Express backend (PI verify + Discord webhook)
├── package.json
├── .env.example     — Template for environment variables
└── README.md
```

---

## How it works

```
Pioneer (PI Browser)
  │
  ├─ 1. Clicks "Login with PI Network"
  │       PI SDK → Pi.authenticate(['username'])
  │       Returns: { user: { uid, username }, accessToken }
  │
  ├─ 2. Fills in report form (URL, category, description)
  │       POST /api/report  { accessToken, url, category, description }
  │
  └─ 3. Server verifies token
          GET https://api.minepi.com/v2/me
          Authorization: Bearer <accessToken>
          ↓
          Discord Webhook POST → #scam-reports channel
```

The PI access token is **verified server-side** on every submission — a user cannot spoof another Pioneer's identity.
