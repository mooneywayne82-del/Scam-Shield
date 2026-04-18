'use strict';

/** Holds the PI auth result after login. */
let piAuth = null;

/** Toast timer handle. */
let toastTimer = null;

/** Runtime app config loaded from backend. */
let appConfig = { sandbox: false, donationsEnabled: false, piOnlyLogin: false };

/** Same SDK URL as passphrase-secure `PI_NETWORK_CONFIG.SDK_URL`. */
const PI_SDK_URL = 'https://sdk.minepi.com/pi-sdk.js';

// ── PI SDK (matches passphrase-secure `loadPiSDK` + init/authenticate sequence) ─

function loadPiSDK() {
  return new Promise((resolve, reject) => {
    if (typeof Pi !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = PI_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Pi SDK script'));
    document.head.appendChild(script);
  });
}

async function refreshAppConfig() {
  try {
    const res = await fetch('/api/config', { credentials: 'include' });
    if (res.ok) {
      const cfg = await res.json();
      appConfig = {
        sandbox: Boolean(cfg.sandbox),
        donationsEnabled: Boolean(cfg.donationsEnabled),
        piOnlyLogin: Boolean(cfg.piOnlyLogin),
      };
    }
  } catch {
    // Non-fatal — keep defaults
  }
}

/** Pi.init may return a Promise; always await before authenticate. */
async function applyPiSdkInit() {
  if (typeof Pi === 'undefined') return;
  const initResult = Pi.init({ version: '2.0', sandbox: appConfig.sandbox });
  if (initResult && typeof initResult.then === 'function') {
    await initResult;
  }
}

async function bootstrapPiClient() {
  await refreshAppConfig();
  updateDonationAvailability();

  try {
    await loadPiSDK();
  } catch (err) {
    console.error('Pi SDK load failed:', err);
    const btn = document.getElementById('login-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Pi SDK failed to load';
    }
    return;
  }

  if (typeof Pi === 'undefined') {
    const btn = document.getElementById('login-btn');
    if (btn) {
      btn.textContent = 'Open in PI Browser';
      btn.disabled = true;
    }
    return;
  }
}

// ── Authentication ────────────────────────────────────────────────────────────

async function loginWithPi() {
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  try {
    await refreshAppConfig();
    await loadPiSDK();

    if (typeof Pi === 'undefined') {
      throw new Error('Pi SDK not available. Please open this app inside the Pi Browser.');
    }

    await applyPiSdkInit();

    const piAuthResult = await Pi.authenticate(['username', 'payments']);

    if (!piAuthResult?.accessToken || !piAuthResult?.user?.uid) {
      throw new Error('Authentication failed. Please try again.');
    }

    if (!appConfig.piOnlyLogin) {
      await postJson('/api/user/signin', { authResult: piAuthResult });
    }
    piAuth = piAuthResult;
    showReportScreen(piAuthResult.user.username);
  } catch (err) {
    console.error('Pi Network initialization failed:', err);
    const msg =
      err instanceof Error
        ? `Authentication error: ${err.message}`
        : 'Failed to authenticate. Please refresh and try again.';
    showToast(msg, 'error');
    btn.disabled = false;
    btn.textContent = 'Login with PI Network';
  }
}

// ── UI transitions ────────────────────────────────────────────────────────────

function showReportScreen(username) {
  document.getElementById('login-screen').classList.add('hidden');
  const screen = document.getElementById('report-screen');
  screen.classList.remove('hidden');
  document.getElementById('pioneer-name').textContent = `Pioneer: @${username}`;
  updateDonationAvailability();
}

function updateDonationAvailability() {
  const donateBtn = document.getElementById('donate-btn');
  const note = document.getElementById('donation-note');
  if (!donateBtn || !note) return;

  if (!appConfig.donationsEnabled) {
    donateBtn.disabled = true;
    note.textContent = 'Donations are optional. They are currently disabled until the Pi Server API key is configured on the server.';
    return;
  }

  if (typeof Pi === 'undefined') {
    donateBtn.disabled = true;
    note.textContent = 'Donations are optional. Donation testing requires Pi Browser, and the button will activate when opened there.';
    return;
  }

  donateBtn.disabled = false;
  note.textContent = 'Donations are optional. If you choose to donate, payments open inside Pi Browser and require the Pi payment permission.';
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

// ── Report submission ─────────────────────────────────────────────────────────

async function submitReport(e) {
  e.preventDefault();

  if (!piAuth) {
    showToast('You must be logged in to submit a report.', 'error');
    return;
  }

  const url = document.getElementById('url-input').value.trim();
  const description = document.getElementById('description-input').value.trim();
  const category = document.getElementById('category-select').value;

  if (!url) {
    showToast('Please enter the suspicious website URL.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const response = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        accessToken: piAuth.accessToken,
        url,
        description,
        category,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast(data.message, 'success');
      // Reset the form for another report
      e.target.reset();
      document.getElementById('char-count').textContent = '0 / 1000';
    } else {
      showToast(data.error || 'Failed to submit report. Please try again.', 'error');
    }
  } catch {
    showToast('Network error. Check your connection and try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Report';
  }
}

function setDonationAmount(amount) {
  const input = document.getElementById('donation-amount-input');
  input.value = amount;

  document.querySelectorAll('.donation-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.amount === String(amount));
  });
}

async function startDonation() {
  if (!piAuth) {
    showToast('Please log in with Pi Network before donating.', 'error');
    return;
  }

  if (!appConfig.donationsEnabled) {
    showToast('Donations are not enabled on the server yet.', 'error');
    return;
  }

  if (typeof Pi === 'undefined' || typeof Pi.createPayment !== 'function') {
    showToast('Pi donations require Pi Browser.', 'error');
    return;
  }

  const input = document.getElementById('donation-amount-input');
  const amount = Number.parseFloat(input.value);

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Enter a valid donation amount greater than 0.', 'error');
    return;
  }

  const donateBtn = document.getElementById('donate-btn');
  donateBtn.disabled = true;
  donateBtn.textContent = 'Opening Pi Wallet…';

  try {
    Pi.createPayment(
      {
        amount,
        memo: 'Donation to support Scam Shield community operations',
        metadata: {
          type: 'donation',
          source: 'scam-shield',
          pioneer: piAuth.user?.username || 'unknown',
          createdAt: new Date().toISOString(),
        },
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          await postJson(`/api/payments/${encodeURIComponent(paymentId)}/approve`, {});
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          await postJson(`/api/payments/${encodeURIComponent(paymentId)}/complete`, { txid });
          showToast('Donation received. Thank you for supporting Scam Shield.', 'success');
          input.value = '';
          document.querySelectorAll('.donation-chip').forEach((chip) => chip.classList.remove('active'));
        },
        onCancel: () => {
          showToast('Donation cancelled.', 'info');
        },
        onError: (error) => {
          console.error('Pi donation error:', error);
          showToast('Donation failed. Please try again.', 'error');
        },
      }
    );
  } catch (err) {
    console.error('Donation launch error:', err);
    showToast('Could not start the donation flow.', 'error');
  } finally {
    donateBtn.disabled = false;
    donateBtn.textContent = 'Donate with Pi';
  }
}

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`; // clears 'hidden' and sets type class
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4500);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Character counter for description textarea
  const textarea = document.getElementById('description-input');
  const charCount = document.getElementById('char-count');
  textarea.addEventListener('input', () => {
    charCount.textContent = `${textarea.value.length} / 1000`;
  });

  // Button / form listeners
  document.getElementById('login-btn').addEventListener('click', loginWithPi);
  document.getElementById('report-form').addEventListener('submit', submitReport);
  document.getElementById('donate-btn').addEventListener('click', startDonation);
  document.querySelectorAll('.donation-chip').forEach((chip) => {
    chip.addEventListener('click', () => setDonationAmount(chip.dataset.amount));
  });
  document.getElementById('donation-amount-input').addEventListener('input', () => {
    document.querySelectorAll('.donation-chip').forEach((chip) => chip.classList.remove('active'));
  });

  bootstrapPiClient();
});
