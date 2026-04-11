'use strict';

/** Holds the PI auth result after login. */
let piAuth = null;

/** Toast timer handle. */
let toastTimer = null;

/** Runtime app config loaded from backend. */
let appConfig = { sandbox: false, donationsEnabled: false };

const PI_COMMUNICATION_REQUEST_TYPE = '@pi:app:sdk:communication_information_request';

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'SecurityError' ||
        error.code === DOMException.SECURITY_ERR ||
        error.code === 18)
    ) {
      return true;
    }

    if (error instanceof Error && /Permission denied/i.test(error.message)) {
      return true;
    }

    throw error;
  }
}

function parseJsonSafely(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && value !== null ? value : null;
}

function requestParentCredentials() {
  if (!isInIframe()) {
    return Promise.resolve(null);
  }

  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const timeoutMs = 1500;

  return new Promise((resolve) => {
    let timeoutId = null;

    const cleanup = (listener) => {
      window.removeEventListener('message', listener);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };

    const messageListener = (event) => {
      if (event.source !== window.parent) return;

      const data = parseJsonSafely(event.data);
      if (!data || data.type !== PI_COMMUNICATION_REQUEST_TYPE || data.id !== requestId) {
        return;
      }

      cleanup(messageListener);

      const payload = typeof data.payload === 'object' && data.payload !== null ? data.payload : {};
      const accessToken = typeof payload.accessToken === 'string' ? payload.accessToken : null;
      const appId = typeof payload.appId === 'string' ? payload.appId : null;

      resolve(accessToken ? { accessToken, appId } : null);
    };

    timeoutId = setTimeout(() => {
      cleanup(messageListener);
      resolve(null);
    }, timeoutMs);

    window.addEventListener('message', messageListener);

    window.parent.postMessage(
      JSON.stringify({
        type: PI_COMMUNICATION_REQUEST_TYPE,
        id: requestId,
      }),
      '*'
    );
  });
}

function loadPiSdkScript() {
  if (typeof Pi !== 'undefined') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pi-sdk="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Pi SDK script.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.minepi.com/pi-sdk.js';
    script.async = true;
    script.dataset.piSdk = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Pi SDK script.'));
    document.head.appendChild(script);
  });
}

async function fetchPiProfile(accessToken) {
  const data = await postJson('/api/me', { accessToken });
  return data.user;
}

// ── PI SDK initialisation ─────────────────────────────────────────────────────

async function initPiSdk() {
  // Fetch runtime flags from server so env controls client behavior too
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      appConfig = {
        sandbox: Boolean(cfg.sandbox),
        donationsEnabled: Boolean(cfg.donationsEnabled),
      };
    }
  } catch {
    // Non-fatal — keep defaults
  }

  updateDonationAvailability();

  // Support App Studio/iframe preview credential handoff.
  try {
    const parentCredentials = await requestParentCredentials();
    if (parentCredentials?.accessToken) {
      const user = await fetchPiProfile(parentCredentials.accessToken);
      piAuth = {
        accessToken: parentCredentials.accessToken,
        user,
      };
      showReportScreen(user.username);
      showToast('Authenticated via Pi host session.', 'info');
      return;
    }
  } catch (err) {
    console.warn('Parent credential handoff failed (falling back to Pi SDK):', err);
  }

  if (typeof Pi === 'undefined') {
    try {
      await loadPiSdkScript();
    } catch (err) {
      console.warn('Dynamic Pi SDK load failed:', err);
    }
  }

  if (typeof Pi === 'undefined') {
    // SDK still unavailable — likely opened outside PI Browser
    const btn = document.getElementById('login-btn');
    btn.textContent = 'Open in PI Browser';
    btn.disabled = true;

    // In sandbox/dev mode, show a bypass button so the UI can be previewed
    if (appConfig.sandbox) {
      const devBtn = document.getElementById('dev-bypass-btn');
      devBtn.classList.remove('hidden');
    }
    return;
  }

  try {
    await Pi.init({ version: '2.0', sandbox: appConfig.sandbox });
  } catch (err) {
    console.error('Failed to initialize Pi SDK:', err);
    showToast('Failed to initialize PI Network SDK. Please refresh the page.', 'error');
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'SDK Error — Please Refresh';
  }
}

// ── Authentication ────────────────────────────────────────────────────────────

async function loginWithPi() {
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  try {
    if (typeof Pi === 'undefined') {
      throw new Error('Pi SDK not available. Please open in PI Browser.');
    }

    // Ask for the minimum permission by default for broader project compatibility.
    const scopes = appConfig.donationsEnabled ? ['username', 'payments'] : ['username'];

    const auth = await Pi.authenticate(
      scopes,
      async function onIncompletePaymentFound(payment) {
        // This callback is relevant when payments scope is enabled.
        if (!appConfig.donationsEnabled) return;
        console.log('Incomplete payment found:', payment);
        await resolveIncompletePayment(payment);
      }
    );

    if (!auth || !auth.accessToken || !auth.user || !auth.user.username) {
      throw new Error('Invalid authentication response: missing user data');
    }

    piAuth = auth;
    showReportScreen(auth.user.username);
  } catch (err) {
    console.error('PI authentication error:', err);
    const errorMsg = err?.message || 'Authentication failed. Please try again.';
    showToast(errorMsg, 'error');
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

async function resolveIncompletePayment(payment) {
  if (!payment?.identifier || !payment?.transaction?.txid) {
    console.warn('Incomplete payment found but missing txid:', payment);
    return;
  }

  try {
    await postJson(`/api/payments/${encodeURIComponent(payment.identifier)}/complete`, {
      txid: payment.transaction.txid,
    });
  } catch (err) {
    console.error('Failed to complete previous payment:', err);
  }
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

// ── Dev bypass ───────────────────────────────────────────────────────────────

function loginAsDev() {
  // Use a sentinel token; the server will substitute a mock user
  piAuth = {
    accessToken: '__dev__',
    user: { uid: 'dev-uid-000', username: 'DevPioneer' },
  };
  showReportScreen('DevPioneer');
  showToast('Dev bypass active — reports go to Discord as @DevPioneer', 'info');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Character counter for description textarea
  const textarea = document.getElementById('description-input');
  const charCount = document.getElementById('char-count');
  textarea.addEventListener('input', () => {
    charCount.textContent = `${textarea.value.length} / 1000`;
  });

  // Button / form listeners
  document.getElementById('login-btn').addEventListener('click', loginWithPi);
  document.getElementById('dev-bypass-btn').addEventListener('click', loginAsDev);
  document.getElementById('report-form').addEventListener('submit', submitReport);
  document.getElementById('donate-btn').addEventListener('click', startDonation);
  document.querySelectorAll('.donation-chip').forEach((chip) => {
    chip.addEventListener('click', () => setDonationAmount(chip.dataset.amount));
  });
  document.getElementById('donation-amount-input').addEventListener('input', () => {
    document.querySelectorAll('.donation-chip').forEach((chip) => chip.classList.remove('active'));
  });

  // Initialise PI SDK
  await initPiSdk();
});
