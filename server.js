require('dotenv').config();

const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const session = require('express-session');
const { MongoClient } = require('mongodb');
const path = require('path');
const FormData = require('form-data');
const puppeteer = require('puppeteer');

const app = express();
const PI_API_BASE_URL = 'https://api.minepi.com/v2';
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET?.trim();
const MONGO_URI = process.env.MONGO_URI?.trim() || null;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME?.trim() || 'scam_shield';
const MONGO_PAYMENTS_COLLECTION =
  process.env.MONGO_PAYMENTS_COLLECTION?.trim() || 'donation_payments';
let mongoClient = null;
let paymentCollection = null;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ── Startup validation ────────────────────────────────────────────────────────
if (!process.env.DISCORD_WEBHOOK_URL) {
  console.error('FATAL: DISCORD_WEBHOOK_URL is not set in your .env file.');
  process.exit(1);
}

// ── Security middleware ───────────────────────────────────────────────────────
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'sdk.minepi.com'],
        connectSrc: ["'self'", 'api.minepi.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameSrc: ["'self'", 'https://*.minepi.com', 'https://*.pinet.com'],
        frameAncestors: ["'self'", 'https://*.minepi.com', 'https://*.pinet.com'],
      },
    },
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(
  session({
    secret: SESSION_SECRET || 'scam-shield-dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

if (IS_PROD && !SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}

// ── Per-Pioneer cooldown (1 report per 15 minutes per UID) ───────────────────

const COOLDOWN_MS = 15 * 60 * 1000;
const cooldownMap = new Map();

function checkCooldown(uid) {
  const last = cooldownMap.get(uid);
  if (!last) return null;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : null;
}

function setCooldown(uid) {
  cooldownMap.set(uid, Date.now());
  setTimeout(() => cooldownMap.delete(uid), COOLDOWN_MS);
}

// ── PI Network helper ─────────────────────────────────────────────────────────
async function verifyPiUser(accessToken) {
  const response = await axios.get('https://api.minepi.com/v2/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 8000,
  });
  return response.data; // { uid, username }
}

function getServerApiKey() {
  return process.env.PI_SERVER_API_KEY?.trim() || null;
}

function getPiServerHeaders() {
  const apiKey = getServerApiKey();
  if (!apiKey) return null;
  return {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function getPiPayment(paymentId) {
  const headers = getPiServerHeaders();
  if (!headers) {
    throw new Error('Pi Server API key is not configured.');
  }
  const response = await axios.get(`${PI_API_BASE_URL}/payments/${encodeURIComponent(paymentId)}`, {
    headers,
    timeout: 10000,
  });
  return response.data;
}

async function callPiPaymentApi(endpoint, body) {
  const headers = getPiServerHeaders();
  if (!headers) {
    throw new Error('Pi Server API key is not configured.');
  }

  const response = await axios.post(`${PI_API_BASE_URL}${endpoint}`, body, {
    headers,
    timeout: 10000,
  });

  return response.data;
}

// ── Donation payment state (idempotency + duplicate protection) ─────────────
const PAYMENT_STATE_TTL_MS = 48 * 60 * 60 * 1000;
const paymentState = new Map();

async function getPaymentRecord(paymentId) {
  if (paymentCollection) {
    return paymentCollection.findOne({ paymentId });
  }
  return paymentState.get(paymentId) || null;
}

async function upsertPaymentRecord(paymentId, updates) {
  if (paymentCollection) {
    const record = { ...updates, paymentId, updatedAt: Date.now() };
    await paymentCollection.updateOne(
      { paymentId },
      {
        $set: record,
        $setOnInsert: {
          createdAt: Date.now(),
        },
      },
      { upsert: true }
    );
    return paymentCollection.findOne({ paymentId });
  }

  const existing = paymentState.get(paymentId) || {};
  const record = { ...existing, ...updates, paymentId, updatedAt: Date.now() };
  paymentState.set(paymentId, record);
  return record;
}

setInterval(() => {
  const now = Date.now();
  for (const [paymentId, record] of paymentState.entries()) {
    if (now - (record.updatedAt || 0) > PAYMENT_STATE_TTL_MS) {
      paymentState.delete(paymentId);
    }
  }
}, 60 * 60 * 1000).unref();

async function initMongo() {
  if (!MONGO_URI) {
    console.warn('[Payments] MONGO_URI not set; using in-memory payment store.');
    return;
  }

  try {
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 10 });
    await mongoClient.connect();
    const db = mongoClient.db(MONGO_DB_NAME);
    paymentCollection = db.collection(MONGO_PAYMENTS_COLLECTION);

    await paymentCollection.createIndex({ paymentId: 1 }, { unique: true });
    await paymentCollection.createIndex({ updatedAt: 1 });
    console.log(`[Payments] Mongo payment store ready (${MONGO_DB_NAME}.${MONGO_PAYMENTS_COLLECTION})`);
  } catch (err) {
    console.error('[Payments] Mongo unavailable; falling back to in-memory store:', err.message);
    paymentCollection = null;
    if (mongoClient) {
      try {
        await mongoClient.close();
      } catch {
        // Ignore close errors; app continues with in-memory storage.
      }
    }
    mongoClient = null;
  }
}

// ── Screenshot helper ────────────────────────────────────────────────────────

async function takeScreenshot(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-first-run', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    // Navigate with a hard 15 s cap; use domcontentloaded so slow resources don't stall us
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Short pause to let above-fold content settle
    await new Promise((r) => setTimeout(r, 1500));
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

// ── RDAP lookup (modern REST replacement for WHOIS) ────────────────────

async function lookupRdap(domain) {
  // rdap.org acts as a free bootstrap proxy to the correct RDAP server for any TLD
  const response = await axios.get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    timeout: 10000,
    headers: { Accept: 'application/rdap+json' },
  });
  return response.data;
}

function formatDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function parseRdapSummary(data) {
  if (!data) return null;
  const lines = [];

  // Registrar
  const registrar = data.entities?.find(e => e.roles?.includes('registrar'));
  if (registrar?.vcardArray) {
    const fn = registrar.vcardArray[1]?.find(v => v[0] === 'fn')?.[3];
    if (fn) lines.push(`**Registrar:** ${fn}`);
  }

  // Dates from events
  const eventLabels = { registration: 'Created', expiration: 'Expires', 'last changed': 'Updated' };
  for (const event of (data.events || [])) {
    const label = eventLabels[event.eventAction];
    if (label) lines.push(`**${label}:** ${formatDate(event.eventDate)}`);
  }

  // Status
  if (data.status?.length) {
    lines.push(`**Status:** ${data.status.slice(0, 3).join(', ')}`);
  }

  // Name servers
  if (data.nameservers?.length) {
    const ns = data.nameservers.map(n => n.ldhName).filter(Boolean).slice(0, 4);
    if (ns.length) lines.push(`**Name Servers:** ${ns.join(', ')}`);
  }

  // Registrant country (from registrant entity)
  const registrant = data.entities?.find(e => e.roles?.includes('registrant'));
  if (registrant?.vcardArray) {
    const country = registrant.vcardArray[1]?.find(v => v[0] === 'adr')?.[1]?.['country-name']
      ?? registrant.vcardArray[1]?.find(v => v[0] === 'adr')?.[3]?.[6];
    if (country) lines.push(`**Country:** ${country}`);
  }

  // DNSSEC
  if (data.secureDNS) {
    const dnssec = data.secureDNS.delegationSigned ? 'signed' : 'unsigned';
    lines.push(`**DNSSEC:** ${dnssec}`);
  }

  if (!lines.length) return null;
  const summary = lines.join('\n');
  return summary.length > 1020 ? summary.slice(0, 1020) + '…' : summary;
}

// ── Discord webhook helper ────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  phishing: '🎣 Phishing',
  fake_app: '📱 Fake PI App',
  scam: '💸 Scam / Fraud',
  malware: '🦠 Malware',
  other: '❓ Other',
};

async function sendDiscordReport({ username, uid, url, description, category, whoisSummary, screenshotBuffer }) {
  const fields = [
    { name: '👤 Pioneer', value: `\`${username}\``, inline: true },
    { name: '🏷️ Category', value: CATEGORY_LABELS[category] ?? '❓ Other', inline: true },
    { name: '🌐 Reported URL', value: url, inline: false },
    {
      name: '📝 Description',
      value: description || '_No description provided_',
      inline: false,
    },
    {
      name: '🔍 WHOIS Info',
      value: whoisSummary || '_No WHOIS data found_',
      inline: false,
    },
  ];

  const embed = {
    title: '🚨 Suspicious Website Reported',
    color: 0xe74c3c,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: `PI Scam Shield • Pioneer UID: ${uid}` },
  };

  if (screenshotBuffer) {
    embed.image = { url: 'attachment://screenshot.png' };
  }

  const payload = { username: 'Scam Shield Bot', embeds: [embed] };

  if (screenshotBuffer) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', screenshotBuffer, { filename: 'screenshot.png', contentType: 'image/png' });
    await axios.post(process.env.DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
      timeout: 20000,
      maxContentLength: Infinity,
    });
  } else {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, payload, { timeout: 8000 });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Frontend config (lets the PI SDK know whether to use sandbox mode)
app.get('/api/config', (req, res) => {
  res.json({
    sandbox: process.env.SANDBOX === 'true',
    donationsEnabled: Boolean(getServerApiKey()),
  });
});

// Pi Developer Portal domain ownership verification endpoint.
// Expected path: https://your-domain/validation-key.txt
app.get('/validation-key.txt', (req, res) => {
  const key = process.env.DOMAIN_VALIDATION_KEY?.trim();
  if (!key) {
    return res.status(404).type('text/plain').send('DOMAIN_VALIDATION_KEY is not configured');
  }
  return res.type('text/plain').send(key);
});

app.post('/api/payments/:paymentId/approve', async (req, res) => {
  if (!getServerApiKey()) {
    return res.status(503).json({ error: 'Donations are not configured on the server yet.' });
  }

  const paymentId = req.params.paymentId;
  const sessionUser = req.session.currentUser || null;
  if (!sessionUser?.uid) {
    return res.status(401).json({ error: 'Please sign in with Pi before donating.' });
  }

  const existing = await getPaymentRecord(paymentId);
  if (existing?.status === 'completed') {
    return res.json({ success: true, payment: existing.remotePayment || null, alreadyCompleted: true });
  }
  if (existing?.uid && existing.uid !== sessionUser.uid) {
    return res.status(403).json({ error: 'This payment belongs to a different user session.' });
  }

  try {
    const remotePayment = await getPiPayment(paymentId);
    const metadataPioneer = remotePayment?.metadata?.pioneer;
    if (metadataPioneer && metadataPioneer !== sessionUser.username) {
      return res.status(403).json({ error: 'Payment metadata does not match current Pi user.' });
    }

    const payment = await callPiPaymentApi(`/payments/${encodeURIComponent(paymentId)}/approve`, {});
    await upsertPaymentRecord(paymentId, {
      uid: sessionUser.uid,
      username: sessionUser.username,
      status: 'approved',
      approvedAt: Date.now(),
      remotePayment: payment,
    });
    return res.json({ success: true, payment, alreadyCompleted: false });
  } catch (err) {
    console.error('Pi approve payment error:', err.response?.data || err.message);
    return res.status(502).json({ error: 'Failed to approve Pi payment.' });
  }
});

app.post('/api/payments/:paymentId/complete', async (req, res) => {
  if (!getServerApiKey()) {
    return res.status(503).json({ error: 'Donations are not configured on the server yet.' });
  }

  const paymentId = req.params.paymentId;
  const { txid } = req.body;
  if (!txid || typeof txid !== 'string') {
    return res.status(400).json({ error: 'A transaction id is required.' });
  }

  const existing = await getPaymentRecord(paymentId);
  if (existing?.status === 'completed') {
    if (existing.txid === txid) {
      return res.json({ success: true, payment: existing.remotePayment || null, alreadyCompleted: true });
    }
    return res.status(409).json({ error: 'Payment already completed with a different transaction id.' });
  }

  if (!existing) {
    return res.status(409).json({ error: 'Payment is not approved yet. Please retry donation from Pi Browser.' });
  }

  const sessionUser = req.session.currentUser || null;
  if (sessionUser?.uid && existing.uid && sessionUser.uid !== existing.uid) {
    return res.status(403).json({ error: 'This payment belongs to a different user session.' });
  }

  if (existing.status === 'completing') {
    return res.status(409).json({ error: 'Payment completion is already in progress.' });
  }

  await upsertPaymentRecord(paymentId, { status: 'completing', txid });

  try {
    const payment = await callPiPaymentApi(
      `/payments/${encodeURIComponent(paymentId)}/complete`,
      { txid }
    );
    await upsertPaymentRecord(paymentId, {
      status: 'completed',
      txid,
      completedAt: Date.now(),
      remotePayment: payment,
    });
    return res.json({ success: true, payment, alreadyCompleted: false });
  } catch (err) {
    await upsertPaymentRecord(paymentId, { status: 'approved' });
    console.error('Pi complete payment error:', err.response?.data || err.message);
    return res.status(502).json({ error: 'Failed to complete Pi payment.' });
  }
});

app.post('/api/user/signin', async (req, res) => {
  const auth = req.body?.authResult;
  if (!auth || typeof auth !== 'object') {
    return res.status(400).json({ error: 'Authentication payload is required.' });
  }

  const accessToken = auth.accessToken;
  const declaredUser = auth.user;
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'A valid access token is required.' });
  }

  try {
    const verifiedUser = await verifyPiUser(accessToken);
    if (!declaredUser || declaredUser.uid !== verifiedUser.uid) {
      return res.status(401).json({ error: 'PI user mismatch. Please authenticate again.' });
    }

    req.session.currentUser = {
      uid: verifiedUser.uid,
      username: verifiedUser.username,
      accessToken,
    };

    return res.json({ success: true, user: { uid: verifiedUser.uid, username: verifiedUser.username } });
  } catch (err) {
    console.error('PI signin error:', err.response?.data || err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid PI access token.' });
    }
    return res.status(502).json({ error: 'Could not verify PI identity.' });
  }
});

app.get('/api/user/me', (req, res) => {
  const currentUser = req.session.currentUser;
  if (!currentUser) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  return res.json({
    success: true,
    user: { uid: currentUser.uid, username: currentUser.username },
  });
});

app.get('/api/user/signout', (req, res) => {
  req.session.currentUser = null;
  return res.json({ success: true });
});

const VALID_CATEGORIES = ['phishing', 'fake_app', 'scam', 'malware', 'other'];

app.post('/api/report', async (req, res) => {
  const { accessToken, url, description, category } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A URL is required.' });
  }

  if (url.length > 2048) {
    return res.status(400).json({ error: 'URL is too long.' });
  }

  if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
    return res.status(400).json({ error: 'Description must be under 1000 characters.' });
  }

  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category.' });
  }

  // Normalise URL — prepend https:// if the user omitted the protocol
  let parsedUrl;
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parsedUrl = new URL(normalized);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are accepted.' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Please enter a domain or full URL.' });
  }

  // ── Verify PI identity server-side ────────────────────────────────────────
  let piUser;
  const sessionUser = req.session.currentUser || null;
  const tokenToVerify =
    (sessionUser && typeof sessionUser.accessToken === 'string' && sessionUser.accessToken) ||
    (typeof accessToken === 'string' ? accessToken : null);

  if (!tokenToVerify) {
    return res.status(401).json({ error: 'Authentication required. Please log in with Pi Network.' });
  }

  // Dev bypass: only allowed when SANDBOX=true
  if (tokenToVerify === '__dev__') {
    if (process.env.SANDBOX !== 'true') {
      return res.status(401).json({ error: 'Dev bypass is only available in sandbox mode.' });
    }
    piUser = { uid: 'dev-uid-000', username: 'DevPioneer' };
  } else {
    try {
      piUser = await verifyPiUser(tokenToVerify);
      if (sessionUser && sessionUser.uid && sessionUser.uid !== piUser.uid) {
        return res.status(401).json({ error: 'Session user mismatch. Please log in again.' });
      }
    } catch (err) {
      if (err.response?.status === 401) {
        return res
          .status(401)
          .json({ error: 'PI Network authentication failed. Please log in again.' });
      }
      return res
        .status(502)
        .json({ error: 'Could not reach PI Network servers. Please try again.' });
    }
  }

  // ── Per-Pioneer cooldown check ───────────────────────────────────────────
  const remainingMs = checkCooldown(piUser.uid);
  if (remainingMs !== null) {
    const remainingMins = Math.ceil(remainingMs / 60000);
    return res.status(429).json({
      error: `You’ve already submitted a report recently. Please wait ${remainingMins} more minute${remainingMins === 1 ? '' : 's'} before submitting again.`,
    });
  }

  // ── RDAP lookup + screenshot (run in parallel; neither blocks the report) ──
  let whoisSummary = null;
  let screenshotBuffer = null;

  await Promise.allSettled([
    (async () => {
      try {
        console.log(`[RDAP] Looking up: ${parsedUrl.hostname}`);
        const rdapData = await lookupRdap(parsedUrl.hostname);
        whoisSummary = parseRdapSummary(rdapData);
        console.log(`[RDAP] Summary: ${whoisSummary ?? 'null'}`);
      } catch (err) {
        console.warn('[RDAP] Lookup failed (non-fatal):', err.message);
      }
    })(),
    (async () => {
      try {
        console.log(`[Screenshot] Capturing: ${parsedUrl.href}`);
        screenshotBuffer = await takeScreenshot(parsedUrl.href);
        console.log(`[Screenshot] Captured ${screenshotBuffer.length} bytes`);
      } catch (err) {
        console.warn('[Screenshot] Failed (non-fatal):', err.message);
      }
    })(),
  ]);

  // ── Send to Discord ───────────────────────────────────────────────────────
  try {
    await sendDiscordReport({
      username: piUser.username,
      uid: piUser.uid,
      url: parsedUrl.href,
      description: description?.trim(),
      category: category || 'other',
      whoisSummary,
      screenshotBuffer,
    });
  } catch (err) {
    console.error('Discord webhook error:', err.message);
    return res
      .status(502)
      .json({ error: 'Failed to deliver report to moderators. Please try again.' });
  }

  // Start cooldown only after a successful report
  setCooldown(piUser.uid);

  return res.json({
    success: true,
    message: 'Report submitted! Thank you for keeping the PI community safe. 🛡️',
  });
});

// Fallback — serve the SPA for any other GET
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
async function startServer() {
  await initMongo();
  app.listen(PORT, () => {
    console.log(`Scam Shield running → http://localhost:${PORT}`);
  });
}

startServer();
