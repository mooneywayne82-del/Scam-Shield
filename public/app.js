// node_modules/@pinetwork/pi-sdk-js/dist/index.js
var f = new Error("request for lock canceled");
var v = function(l, e, r, n) {
  function i(o) {
    return o instanceof r ? o : new r(function(a) {
      a(o);
    });
  }
  return new (r || (r = Promise))(function(o, a) {
    function h(s) {
      try {
        c(n.next(s));
      } catch (u) {
        a(u);
      }
    }
    function d(s) {
      try {
        c(n.throw(s));
      } catch (u) {
        a(u);
      }
    }
    function c(s) {
      s.done ? o(s.value) : i(s.value).then(h, d);
    }
    c((n = n.apply(l, e || [])).next());
  });
};
var w = class {
  constructor(e, r = f) {
    this._value = e, this._cancelError = r, this._weightedQueues = [], this._weightedWaiters = [];
  }
  acquire(e = 1) {
    if (e <= 0)
      throw new Error(`invalid weight ${e}: must be positive`);
    return new Promise((r, n) => {
      this._weightedQueues[e - 1] || (this._weightedQueues[e - 1] = []), this._weightedQueues[e - 1].push({ resolve: r, reject: n }), this._dispatch();
    });
  }
  runExclusive(e, r = 1) {
    return v(this, void 0, void 0, function* () {
      const [n, i] = yield this.acquire(r);
      try {
        return yield e(n);
      } finally {
        i();
      }
    });
  }
  waitForUnlock(e = 1) {
    if (e <= 0)
      throw new Error(`invalid weight ${e}: must be positive`);
    return new Promise((r) => {
      this._weightedWaiters[e - 1] || (this._weightedWaiters[e - 1] = []), this._weightedWaiters[e - 1].push(r), this._dispatch();
    });
  }
  isLocked() {
    return this._value <= 0;
  }
  getValue() {
    return this._value;
  }
  setValue(e) {
    this._value = e, this._dispatch();
  }
  release(e = 1) {
    if (e <= 0)
      throw new Error(`invalid weight ${e}: must be positive`);
    this._value += e, this._dispatch();
  }
  cancel() {
    this._weightedQueues.forEach((e) => e.forEach((r) => r.reject(this._cancelError))), this._weightedQueues = [];
  }
  _dispatch() {
    var e;
    for (let r = this._value; r > 0; r--) {
      const n = (e = this._weightedQueues[r - 1]) === null || e === void 0 ? void 0 : e.shift();
      if (!n)
        continue;
      const i = this._value, o = r;
      this._value -= r, r = this._value + 1, n.resolve([i, this._newReleaser(o)]);
    }
    this._drainUnlockWaiters();
  }
  _newReleaser(e) {
    let r = false;
    return () => {
      r || (r = true, this.release(e));
    };
  }
  _drainUnlockWaiters() {
    for (let e = this._value; e > 0; e--)
      this._weightedWaiters[e - 1] && (this._weightedWaiters[e - 1].forEach((r) => r()), this._weightedWaiters[e - 1] = []);
  }
};
var y = function(l, e, r, n) {
  function i(o) {
    return o instanceof r ? o : new r(function(a) {
      a(o);
    });
  }
  return new (r || (r = Promise))(function(o, a) {
    function h(s) {
      try {
        c(n.next(s));
      } catch (u) {
        a(u);
      }
    }
    function d(s) {
      try {
        c(n.throw(s));
      } catch (u) {
        a(u);
      }
    }
    function c(s) {
      s.done ? o(s.value) : i(s.value).then(h, d);
    }
    c((n = n.apply(l, e || [])).next());
  });
};
var m = class {
  constructor(e) {
    this._semaphore = new w(1, e);
  }
  acquire() {
    return y(this, void 0, void 0, function* () {
      const [, e] = yield this._semaphore.acquire();
      return e;
    });
  }
  runExclusive(e) {
    return this._semaphore.runExclusive(() => e());
  }
  isLocked() {
    return this._semaphore.isLocked();
  }
  waitForUnlock() {
    return this._semaphore.waitForUnlock();
  }
  release() {
    this._semaphore.isLocked() && this._semaphore.release();
  }
  cancel() {
    return this._semaphore.cancel();
  }
};
var t = class t2 {
  constructor() {
  }
  static get_connected() {
    return t2.connected;
  }
  static get_user() {
    return t2.user;
  }
  static log(...e) {
    console.log(this.logPrefix, ...e);
  }
  static error(...e) {
    console.error(this.logPrefix, ...e);
  }
  static checkPaymentBasePath() {
    t2.paymentBasePath == "tbd" && (typeof window < "u" && (window.__NEXT_DATA__ || typeof window.next < "u" && window.next.version) ? t2.paymentBasePath = "api/pi_payment" : t2.paymentBasePath = "pi_payment");
  }
  initializePiSdkBase() {
  }
  async connect() {
    const e = await t2.connectMutex.acquire();
    try {
      if (t2.connected && t2.user) {
        typeof this.onConnection == "function" && this.onConnection();
        return;
      }
      if (!window.Pi || typeof window.Pi.init != "function") {
        t2.error("Pi SDK not loaded.");
        return;
      }
      let r = { version: t2.version };
      const n = window.RAILS_ENV || typeof process < "u" && (process.env?.RAILS_ENV || "development") || "development";
      (n === "development" || n === "test") && (r.sandbox = true), await window.Pi.init(r), t2.log("SDK initialized", r), t2.connected = false;
      try {
        const i = await window.Pi.authenticate([
          "payments",
          "username"
        ], t2.onIncompletePaymentFound);
        t2.accessToken = i.accessToken, t2.user = i.user, t2.connected = true, t2.log("Auth OK", i), typeof this.onConnection == "function" && this.onConnection();
      } catch (i) {
        t2.connected = false, t2.error("Auth failed", i);
      }
    } finally {
      e();
    }
  }
  static async postToServer(e, r) {
    t2.checkPaymentBasePath();
    const n = t2.paymentBasePath;
    t2.log(`POST: ${n}/${e}: ${JSON.stringify(r)}`);
    const o = await (await fetch(`${n}/${e}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(r)
    })).text();
    if (!o || o.trim() === "")
      return null;
    try {
      return JSON.parse(o);
    } catch {
      throw t2.error(`Invalid JSON from server (${e}):`, o.slice(0, 100)), new SyntaxError(`Invalid JSON from server: ${o.slice(0, 80)}...`);
    }
  }
  static async onReadyForServerApproval(e, r) {
    if (!e) {
      t2.error("Approval: missing paymentId");
      return;
    }
    if (!r) {
      t2.error("Approval: missing accessToken");
      return;
    }
    try {
      const n = await t2.postToServer("approve", {
        paymentId: e,
        accessToken: r
      });
      t2.log("approve:", n);
    } catch (n) {
      t2.error("approve error", n);
    }
  }
  static async onReadyForServerCompletion(e, r) {
    if (!e || !r) {
      t2.error("Completion: missing ids");
      return;
    }
    try {
      const n = await t2.postToServer("complete", {
        paymentId: e,
        transactionId: r
      });
      t2.log("complete:", n);
    } catch (n) {
      t2.error("complete error", n);
    }
  }
  static async onCancel(e) {
    if (!e) {
      t2.error("Cancel: missing paymentId");
      return;
    }
    try {
      const r = await t2.postToServer("cancel", { paymentId: e });
      t2.log("cancel:", r);
    } catch (r) {
      t2.error("cancel error", r);
    }
  }
  static async onError(e, r) {
    const n = r?.identifier;
    if (!n || !r) {
      t2.error("Error: missing ids", e, r);
      return;
    }
    try {
      const i = await t2.postToServer("error", { paymentId: n, error: e });
      t2.log("error:", i);
    } catch (i) {
      t2.error("error post", i);
    }
  }
  static async onIncompletePaymentFound(e) {
    const r = e?.identifier, n = e?.transaction?.txid || null;
    if (!r) {
      t2.error("Incomplete: missing paymentId");
      return;
    }
    try {
      const i = await t2.postToServer("incomplete", { paymentId: r, transactionId: n });
      t2.log("incomplete:", i);
    } catch (i) {
      t2.error("incomplete post error", i);
    }
  }
  /**
   * Create a new payment request.
   * @param {object} paymentData - Payment details.
   * @param {number} paymentData.amount - Amount in Pi.
   * @param {string} paymentData.memo - Payment memo.
   * @param {object} paymentData.metadata - Optional metadata.
   */
  createPayment(e) {
    if (!t2.connected) {
      t2.error("Not connected to Pi.");
      return;
    }
    const { amount: r, memo: n, metadata: i } = e || {};
    if (typeof r != "number" || !n || typeof n != "string" || !i || typeof i != "object" || Object.keys(i).length === 0) {
      t2.error("Invalid paymentData", e);
      return;
    }
    const o = (a) => {
      t2.onReadyForServerApproval(a, t2.accessToken);
    };
    Pi.createPayment(
      e,
      {
        onReadyForServerApproval: o,
        onReadyForServerCompletion: t2.onReadyForServerCompletion,
        onCancel: t2.onCancel,
        onError: t2.onError,
        onIncompletePaymentFound: t2.onIncompletePaymentFound
      }
    );
  }
};
t.user = null, t.connected = false, t.paymentBasePath = "tbd", t.logPrefix = "[PiSDK]", t.version = "2.0", t.connectMutex = new m(), t.accessToken = null;
var p = t;
typeof window < "u" && (window.PiSdkBase = p);

// client/app.js
var piAuth = null;
var toastTimer = null;
var appConfig = { sandbox: false, donationsEnabled: false, donationsKillSwitch: false, piOnlyLogin: false };
var PI_SDK_URL = "https://sdk.minepi.com/pi-sdk.js";
var piSdk = new p();
function loadPiSDK() {
  return new Promise((resolve, reject) => {
    if (typeof Pi !== "undefined") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = PI_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Pi SDK script"));
    document.head.appendChild(script);
  });
}
async function refreshAppConfig() {
  try {
    const res = await fetch("/api/config", { credentials: "include" });
    if (res.ok) {
      const cfg = await res.json();
      appConfig = {
        sandbox: Boolean(cfg.sandbox),
        donationsEnabled: Boolean(cfg.donationsEnabled),
        donationsKillSwitch: Boolean(cfg.donationsKillSwitch),
        piOnlyLogin: Boolean(cfg.piOnlyLogin)
      };
    }
  } catch {
  }
}
async function applyPiSdkInit() {
  if (typeof Pi === "undefined") return;
  const initResult = Pi.init({ version: "2.0", sandbox: appConfig.sandbox });
  if (initResult && typeof initResult.then === "function") {
    await initResult;
  }
}
function wirePiSdkBaseHandlers() {
  p.onReadyForServerApproval = async (paymentId) => {
    await postJson(`/api/payments/${encodeURIComponent(paymentId)}/approve`, {});
  };
  p.onReadyForServerCompletion = async (paymentId, txid) => {
    await postJson(`/api/payments/${encodeURIComponent(paymentId)}/complete`, { txid });
    showToast("Donation received. Thank you for supporting Scam Shield.", "success");
    const input = document.getElementById("donation-amount-input");
    if (input) input.value = "";
    document.querySelectorAll(".donation-chip").forEach((chip) => chip.classList.remove("active"));
  };
  p.onCancel = async () => {
    showToast("Donation cancelled.", "info");
  };
  p.onError = async (error) => {
    console.error("Pi donation error:", error);
    showToast("Donation failed. Please try again.", "error");
  };
  p.onIncompletePaymentFound = async (payment) => {
    await resolveIncompletePayment(payment);
  };
}
function syncPiSdkAuthFromResult(authResult) {
  p.connected = true;
  p.user = authResult.user;
  p.accessToken = authResult.accessToken;
}
function clearPiSdkAuth() {
  p.connected = false;
  p.user = null;
  p.accessToken = null;
}
async function bootstrapPiClient() {
  await refreshAppConfig();
  updateDonationAvailability();
  try {
    await loadPiSDK();
  } catch (err) {
    console.error("Pi SDK load failed:", err);
    const btn = document.getElementById("login-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Pi SDK failed to load";
    }
    return;
  }
  wirePiSdkBaseHandlers();
  if (typeof Pi === "undefined") {
    const btn = document.getElementById("login-btn");
    if (btn) {
      btn.textContent = "Open in PI Browser";
      btn.disabled = true;
    }
    return;
  }
}
function formatPiLoginError(err) {
  const raw = err instanceof Error ? String(err.message) : "";
  const origin = typeof window !== "undefined" ? window.location.origin || window.location.href : "this site";
  if (raw && (raw === "Authentication failed" || /^Authentication failed\b/i.test(raw))) {
    return appConfig.sandbox ? `Pi login failed in sandbox (${origin}). In Pi Browser: Utilities \u2192 Authorize Sandbox. Production must use SANDBOX=false on the server.` : `Pi login did not finish (${origin}). Open only in Pi Browser via Pi \u2192 Develop \u2192 your app (not Chrome/Safari). This URL must match your Pi Developer Portal app URL. Testnet app? Set SANDBOX=true on the server.`;
  }
  if (raw) return `Login failed: ${raw}`;
  return "Login failed. Please try again.";
}
async function loginWithPi() {
  const btn = document.getElementById("login-btn");
  btn.disabled = true;
  btn.textContent = "Connecting\u2026";
  try {
    await refreshAppConfig();
    await loadPiSDK();
    wirePiSdkBaseHandlers();
    if (typeof Pi === "undefined") {
      showToast(
        "Pi Browser is required. Open this app from Pi \u2192 Develop \u2192 your app (not Chrome or Safari).",
        "error"
      );
      btn.disabled = false;
      btn.textContent = "Login with PI Network";
      return;
    }
    await applyPiSdkInit();
    const authenticateWithTimeout = async (scopes, timeoutMs = 25e3) => {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error("Pi login timed out. Open from Pi \u2192 Develop and try again."));
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          Pi.authenticate(scopes, p.onIncompletePaymentFound),
          timeoutPromise
        ]);
      } finally {
        clearTimeout(timeoutHandle);
      }
    };
    const scopeAttempts = [[], ["username"], ["username", "payments"]];
    let piAuthResult;
    let lastErr;
    for (const scopes of scopeAttempts) {
      try {
        const auth = await authenticateWithTimeout(scopes);
        if (auth?.accessToken && auth?.user?.uid) {
          piAuthResult = auth;
          break;
        }
        lastErr = new Error("Authentication failed. Please try again.");
      } catch (e) {
        lastErr = e;
      }
    }
    if (!piAuthResult?.accessToken || !piAuthResult?.user?.uid) {
      throw lastErr || new Error("Authentication failed. Please try again.");
    }
    if (!appConfig.piOnlyLogin) {
      await postJson("/api/user/signin", { authResult: piAuthResult });
    }
    piAuth = piAuthResult;
    syncPiSdkAuthFromResult(piAuthResult);
    showReportScreen(piAuthResult.user.username);
  } catch (err) {
    console.error("PI authentication error:", err);
    clearPiSdkAuth();
    showToast(formatPiLoginError(err), "error");
    btn.disabled = false;
    btn.textContent = "Login with PI Network";
  }
}
function showReportScreen(username) {
  document.getElementById("login-screen").classList.add("hidden");
  const screen = document.getElementById("report-screen");
  screen.classList.remove("hidden");
  document.getElementById("pioneer-name").textContent = `Pioneer: @${username}`;
  updateDonationAvailability();
}
function updateDonationAvailability() {
  const donateBtn = document.getElementById("donate-btn");
  const note = document.getElementById("donation-note");
  if (!donateBtn || !note) return;
  if (!appConfig.donationsEnabled) {
    donateBtn.disabled = true;
    note.textContent = appConfig.donationsKillSwitch ? "Donations are optional. They are temporarily turned off on this server." : "Donations are optional. They are currently disabled until the Pi Server API key is configured on the server.";
    return;
  }
  if (typeof Pi === "undefined") {
    donateBtn.disabled = true;
    note.textContent = "Donations are optional. Donation testing requires Pi Browser, and the button will activate when opened there.";
    return;
  }
  donateBtn.disabled = false;
  note.textContent = "Donations are optional. If you choose to donate, payments open inside Pi Browser and require the Pi payment permission.";
}
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
async function resolveIncompletePayment(payment) {
  if (!payment?.identifier || !payment?.transaction?.txid) {
    console.warn("Incomplete payment found but missing txid:", payment);
    return;
  }
  try {
    await postJson(`/api/payments/${encodeURIComponent(payment.identifier)}/complete`, {
      txid: payment.transaction.txid
    });
  } catch (err) {
    console.error("Failed to complete previous payment:", err);
  }
}
async function submitReport(e) {
  e.preventDefault();
  if (!piAuth) {
    showToast("You must be logged in to submit a report.", "error");
    return;
  }
  const url = document.getElementById("url-input").value.trim();
  const description = document.getElementById("description-input").value.trim();
  const category = document.getElementById("category-select").value;
  if (!url) {
    showToast("Please enter the suspicious website URL.", "error");
    return;
  }
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Submitting\u2026";
  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accessToken: piAuth.accessToken,
        url,
        description,
        category
      })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      showToast(data.message, "success");
      e.target.reset();
      document.getElementById("char-count").textContent = "0 / 1000";
    } else {
      showToast(data.error || "Failed to submit report. Please try again.", "error");
    }
  } catch {
    showToast("Network error. Check your connection and try again.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
}
function setDonationAmount(amount) {
  const input = document.getElementById("donation-amount-input");
  input.value = amount;
  document.querySelectorAll(".donation-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.amount === String(amount));
  });
}
async function startDonation() {
  if (!piAuth) {
    showToast("Please log in with Pi Network before donating.", "error");
    return;
  }
  if (!appConfig.donationsEnabled) {
    showToast("Donations are not enabled on the server yet.", "error");
    return;
  }
  if (typeof Pi === "undefined" || typeof Pi.createPayment !== "function") {
    showToast("Pi donations require Pi Browser.", "error");
    return;
  }
  if (!p.connected || !p.accessToken) {
    showToast("Pi session is not ready. Please log in again.", "error");
    return;
  }
  const input = document.getElementById("donation-amount-input");
  const amount = Number.parseFloat(input.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid donation amount greater than 0.", "error");
    return;
  }
  const donateBtn = document.getElementById("donate-btn");
  donateBtn.disabled = true;
  donateBtn.textContent = "Opening Pi Wallet\u2026";
  wirePiSdkBaseHandlers();
  try {
    piSdk.createPayment({
      amount,
      memo: "Donation to support Scam Shield community operations",
      metadata: {
        type: "donation",
        source: "scam-shield",
        pioneer: piAuth.user?.username || "unknown",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    console.error("Donation launch error:", err);
    showToast("Could not start the donation flow.", "error");
  } finally {
    donateBtn.disabled = false;
    donateBtn.textContent = "Donate with Pi";
  }
}
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
}
document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("description-input");
  const charCount = document.getElementById("char-count");
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length} / 1000`;
  });
  document.getElementById("login-btn").addEventListener("click", loginWithPi);
  document.getElementById("report-form").addEventListener("submit", submitReport);
  document.getElementById("donate-btn").addEventListener("click", startDonation);
  document.querySelectorAll(".donation-chip").forEach((chip) => {
    chip.addEventListener("click", () => setDonationAmount(chip.dataset.amount));
  });
  document.getElementById("donation-amount-input").addEventListener("input", () => {
    document.querySelectorAll(".donation-chip").forEach((chip) => chip.classList.remove("active"));
  });
  bootstrapPiClient();
});
