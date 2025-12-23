// /api/levpay.js — FINAL (Single-file router, GH DB, Monthly promo must use CODE, Unlimited = GLOBAL TOGGLE)
// Actions:
//  - GET  /api/levpay?action=ping|help
//  - POST /api/levpay?action=discount.apply        (public)
//  - POST /api/levpay?action=discount.commit       (public)
//  - POST /api/levpay?action=discount.release      (public)
//  - GET  /api/levpay?action=voucher.list          (ADMIN)
//  - GET  /api/levpay?action=voucher.get&code=...  (ADMIN)
//  - POST /api/levpay?action=voucher.upsert        (ADMIN)
//  - POST /api/levpay?action=voucher.disable       (ADMIN)
//  - GET  /api/levpay?action=monthly.get           (ADMIN)
//  - POST /api/levpay?action=monthly.set           (ADMIN)
//
// ENV (WAJIB):
//  - ADMIN_KEY
//  - DEVICE_PEPPER (boleh kosong, ada fallback hardcoded)
//  - GH_TOKEN, GH_OWNER, GH_REPO, GH_DB_PATH (recommended) + optional GH_BRANCH, GH_API_BASE
//
// Notes:
//  - Monthly promo SELALU wajib input KODE (monthly.code).
//  - Unlimited devices diset di DB/backend (monthly.unlimited map). Admin page TIDAK input sha/device.
//  - Unlimited MODE = toggle global (monthly.unlimitedEnabled). OFF => semua device dianggap normal 1×/bulan.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// ===== ENV =====
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim(); // jangan hardcode
const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim(); // optional

// Pepper (fallback biar ga ke 0/undefined kalau env gagal kebaca)
const DEVICE_PEPPER =
  String(process.env.DEVICE_PEPPER || "").trim() ||
  "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4";

// ===== GH ENV =====
const GH_API_BASE = String(process.env.GH_API_BASE || "https://api.github.com").trim();
const GH_TOKEN = String(process.env.GH_TOKEN || "").trim();
const GH_OWNER = String(process.env.GH_OWNER || "").trim();
const GH_REPO = String(process.env.GH_REPO || "").trim();
const GH_BRANCH = String(process.env.GH_BRANCH || "main").trim();
const GH_DB_PATH = String(process.env.GH_DB_PATH || "db/levpay-db.json").trim();

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Key, X-Callback-Secret"
  );
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end("");
    return true;
  }
  return false;
}

function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const got =
    String(req.headers["x-admin-key"] || "").trim() ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return !!(got && got === ADMIN_KEY);
}

function checkCallbackSecret(req) {
  if (!CALLBACK_SECRET) return true;
  const got =
    String(req.headers["x-callback-secret"] || "").trim() ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return !!(got && got === CALLBACK_SECRET);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function token() {
  return crypto.randomBytes(12).toString("hex");
}

function yyyymm(d = new Date()) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function getDeviceKey(deviceId) {
  return sha256Hex(`${String(deviceId || "")}|${DEVICE_PEPPER}`);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // vercel bisa auto-parse
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ===== GH helpers =====
function ghConfigured() {
  return !!(GH_TOKEN && GH_OWNER && GH_REPO && GH_DB_PATH);
}

function ghHeaders() {
  return {
    Authorization: `token ${GH_TOKEN}`,
    "User-Agent": "levpay-api",
    Accept: "application/vnd.github+json",
  };
}

async function ghGetFile() {
  const url =
    `${GH_API_BASE}/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
      GH_REPO
    )}/contents/${GH_DB_PATH}` + `?ref=${encodeURIComponent(GH_BRANCH)}`;

  const r = await fetch(url, { method: "GET", headers: ghHeaders() });

  if (r.status === 404) return { exists: false, sha: null, content: null };
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`GH read failed (${r.status}): ${t || "unknown"}`);
  }
  const j = await r.json();
  const b64 = String(j?.content || "").replace(/\n/g, "");
  const raw = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
  return { exists: true, sha: j?.sha || null, content: raw || "" };
}

async function ghPutFile(jsonObj, shaMaybe) {
  const url = `${GH_API_BASE}/repos/${encodeURIComponent(
    GH_OWNER
  )}/${encodeURIComponent(GH_REPO)}/contents/${GH_DB_PATH}`;

  const content = Buffer.from(JSON.stringify(jsonObj, null, 2), "utf8").toString("base64");

  const body = {
    message: `levpay db update ${new Date().toISOString()}`,
    content,
    branch: GH_BRANCH,
  };
  if (shaMaybe) body.sha = shaMaybe;

  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`GH write failed (${r.status}): ${t || "unknown"}`);
  }
  return true;
}

// ===== DB read/write =====
async function readDB() {
  if (ghConfigured()) {
    try {
      const f = await ghGetFile();
      if (!f.exists) return {};
      const raw = f.content || "";
      return raw ? JSON.parse(raw) : {};
    } catch {
      // fallback tmp
    }
  }
  try {
    if (!fs.existsSync(TMP_DB_PATH)) return {};
    const raw = fs.readFileSync(TMP_DB_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeDB(db) {
  if (ghConfigured()) {
    const f = await ghGetFile().catch(() => ({ exists: false, sha: null }));
    const sha = f.exists ? f.sha : null;
    await ghPutFile(db, sha);
    return true;
  }
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch {
    return false;
  }
}

function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  db.promo.monthly = db.promo.monthly || {};

  // BACKWARD COMPAT: kalau dulu ada requireCode, sekarang kita paksa always-code
  // monthly.code wajib diisi biar monthly jalan.
  const m = db.promo.monthly;

  if (m.enabled == null) m.enabled = true;
  if (m.name == null) m.name = "PROMO BULANAN";
  if (m.code == null) m.code = ""; // WAJIB diisi lewat admin
  if (m.percent == null) m.percent = 5;
  if (m.maxRp == null) m.maxRp = 2000;

  // Global monthly max uses (per bulan, semua device)
  if (m.maxUses == null) m.maxUses = null;

  // Global toggle: unlimited mode ON/OFF
  if (m.unlimitedEnabled == null) m.unlimitedEnabled = true;

  // whitelist unlimited devices (SET DARI BACKEND/DB)
  m.unlimited = m.unlimited || {}; // { deviceKey: true }

  // state tracking
  m.usedDevice = m.usedDevice || {}; // {deviceKey: "yyyymm"}
  m.reservedDevice = m.reservedDevice || {}; // {deviceKey: {token,month,expiresAt}}
  m.usedGlobal = m.usedGlobal || {}; // {yyyymm: count}
  m.reservedTokens = m.reservedTokens || {}; // {token: {expiresAt, month, deviceKey, unlimited}}

  return db;
}

function cleanupExpiredReservations(db) {
  ensure(db);
  const now = Date.now();
  const m = db.promo.monthly;

  // clean reservedTokens
  for (const [t, info] of Object.entries(m.reservedTokens || {})) {
    const exp = Date.parse(info?.expiresAt || "");
    if (Number.isFinite(exp) && now > exp) {
      // also release reservedDevice if matching
      const dk = info?.deviceKey;
      if (dk) {
        const cur = m.reservedDevice?.[dk];
        if (cur && cur.token === t) delete m.reservedDevice[dk];
      }
      delete m.reservedTokens[t];
    }
  }

  // voucher cleanup
  for (const [code, v] of Object.entries(db.vouchers || {})) {
    if (!v || !v.reserved) continue;
    for (const [t, expAt] of Object.entries(v.reserved)) {
      const exp = Date.parse(expAt || "");
      if (Number.isFinite(exp) && now > exp) delete v.reserved[t];
    }
    if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
  }
}

// ===== DISCOUNT ENGINE =====
function reserveVoucher(db, amount, voucherCode, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const code = String(voucherCode || "").trim().toUpperCase();
  if (!code) return { ok: false, discountRp: 0 };

  const v = db.vouchers[code];
  if (!v || v.enabled === false) return { ok: false, discountRp: 0 };

  if (v.expiresAt) {
    const exp = Date.parse(v.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(Number(v.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;
  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  v.reserved = v.reserved || {};
  const reservedCount = Object.keys(v.reserved).length;

  // maxUses: global lifetime limit (paid)
  if (v.maxUses != null) {
    const used = Number(v.uses || 0);
    const cap = Number(v.maxUses);
    if (Number.isFinite(cap) && cap > 0 && used + reservedCount >= cap) {
      return { ok: false, discountRp: 0 };
    }
  }

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  v.reserved[t] = expiresAt;

  return {
    ok: true,
    discountRp,
    info: {
      type: "voucher",
      code,
      name: v.name || code,
      percent,
      maxRp,
      expiresAt: v.expiresAt || null,
    },
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp },
  };
}

function monthlyGlobalCount(db, month) {
  ensure(db);
  const m = db.promo.monthly;
  const used = Number(m.usedGlobal?.[month] || 0);
  // count reservedTokens for this month
  let rsv = 0;
  for (const info of Object.values(m.reservedTokens || {})) {
    if (info?.month === month) rsv++;
  }
  return { used, reserved: rsv, total: used + rsv };
}

function reserveMonthly(db, amount, deviceKey, voucherCodeMaybe, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const m = db.promo.monthly;

  if (!m.enabled) return { ok: false, discountRp: 0 };

  // MONTHLY MUST USE CODE
  const want = String(m.code || "").trim().toUpperCase();
  const got = String(voucherCodeMaybe || "").trim().toUpperCase();
  if (!want || got !== want) return { ok: false, discountRp: 0 };

  const month = yyyymm();

  // global cap per bulan (optional)
  if (m.maxUses != null) {
    const cap = Number(m.maxUses);
    if (Number.isFinite(cap) && cap > 0) {
      const c = monthlyGlobalCount(db, month);
      if (c.total >= cap) return { ok: false, discountRp: 0 };
    }
  }

  const unlimited = !!(m.unlimitedEnabled && m.unlimited && m.unlimited[deviceKey]);

  // per-device 1x/bulan (kalau bukan unlimited)
  if (!unlimited) {
    const last = String(m.usedDevice?.[deviceKey] || "");
    if (last === month) return { ok: false, discountRp: 0 };

    const rsv = m.reservedDevice?.[deviceKey];
    if (rsv && rsv.month === month) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(Number(m.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(m.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;
  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // token list (selalu)
  m.reservedTokens[t] = { expiresAt, month, deviceKey, unlimited: !!unlimited };

  // per-device reserve (hanya kalau non-unlimited)
  if (!unlimited) {
    m.reservedDevice[deviceKey] = { token: t, month, expiresAt };
  }

  return {
    ok: true,
    discountRp,
    info: {
      type: "monthly",
      code: want,
      name: m.name || "PROMO BULANAN",
      percent,
      maxRp,
      unlimitedApplied: !!unlimited,
    },
    reservation: { type: "monthly", token: t, expiresAt, month, deviceKey, discountRp, unlimited: !!unlimited },
  };
}

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  const code = String(voucherCode || "").trim();

  // voucher first
  const v = reserveVoucher(db, finalAmount, code, reserveTtlMs);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
  }

  // monthly second (only if code matches monthly.code)
  const m = reserveMonthly(db, finalAmount, deviceKey, code, reserveTtlMs);
  if (m.ok) {
    finalAmount = Math.max(1, finalAmount - m.discountRp);
    discountRp += m.discountRp;
    applied.push(m.info);
    reservations.push(m.reservation);
  }

  return { finalAmount, discountRp, applied, reservations, deviceKey };
}

function releaseReservations(db, reservations) {
  ensure(db);
  cleanupExpiredReservations(db);

  const m = db.promo.monthly;

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "voucher") {
      const code = String(r.code || "").trim().toUpperCase();
      const v = db.vouchers?.[code];
      if (v?.reserved?.[r.token]) delete v.reserved[r.token];
      if (v?.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
    }

    if (r.type === "monthly") {
      const t = String(r.token || "").trim();
      const info = m.reservedTokens?.[t];
      if (info) {
        const dk = info.deviceKey;
        const cur = m.reservedDevice?.[dk];
        if (cur && cur.token === t) delete m.reservedDevice[dk];
        delete m.reservedTokens[t];
      }
    }
  }
}

function commitReservations(db, reservations) {
  ensure(db);
  cleanupExpiredReservations(db);

  const m = db.promo.monthly;

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "voucher") {
      const code = String(r.code || "").trim().toUpperCase();
      const v = db.vouchers?.[code];
      if (v?.reserved?.[r.token]) {
        delete v.reserved[r.token];
        v.uses = Number(v.uses || 0) + 1;
        if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      }
    }

    if (r.type === "monthly") {
      const t = String(r.token || "").trim();
      const info = m.reservedTokens?.[t];
      if (info) {
        const month = info.month;
        const dk = info.deviceKey;
        const unlimited = !!info.unlimited;

        // global used++
        m.usedGlobal[month] = Number(m.usedGlobal?.[month] || 0) + 1;

        // per-device used only if non-unlimited
        if (!unlimited) m.usedDevice[dk] = month;

        // cleanup reserves
        const cur = m.reservedDevice?.[dk];
        if (cur && cur.token === t) delete m.reservedDevice[dk];
        delete m.reservedTokens[t];
      }
    }
  }
}

// ===== ADMIN OPS =====
function adminUpsertVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    code,
    name: body.name ? String(body.name) : prev.name || code,
    enabled: body.enabled != null ? !!body.enabled : prev.enabled !== false,
    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : prev.expiresAt || null,
    uses: Number(prev.uses || 0),
    maxUses: body.maxUses != null ? Number(body.maxUses) : prev.maxUses ?? null,
    updatedAt: new Date().toISOString(),
    reserved: prev.reserved || undefined,
  };
  return db.vouchers[code];
}

function adminDisableVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers[code]) throw new Error("voucher not found");

  if (body.enabled != null) db.vouchers[code].enabled = !!body.enabled;
  else db.vouchers[code].enabled = false;

  db.vouchers[code].updatedAt = new Date().toISOString();
  return db.vouchers[code];
}

function adminSetMonthly(db, body) {
  ensure(db);
  const m = db.promo.monthly;

  if (body.enabled != null) m.enabled = !!body.enabled;
  if (body.unlimitedEnabled != null) m.unlimitedEnabled = !!body.unlimitedEnabled;

  if (body.code != null) m.code = String(body.code || "").trim().toUpperCase();
  if (body.name != null) m.name = String(body.name || "").trim();
  if (body.percent != null) m.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) m.maxRp = Math.max(0, Number(body.maxRp));
  if (body.maxUses !== undefined) {
    if (body.maxUses == null || body.maxUses === "") m.maxUses = null;
    else {
      const n = Number(body.maxUses);
      m.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  // keep hidden admin capability (not exposed in UI)
  if (body.addUnlimitedDeviceKey != null) {
    const k = String(body.addUnlimitedDeviceKey || "").trim().toLowerCase();
    if (k && /^[0-9a-f]{64}$/.test(k)) m.unlimited[k] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const k = String(body.removeUnlimitedDeviceKey || "").trim().toLowerCase();
    if (k && /^[0-9a-f]{64}$/.test(k)) delete m.unlimited[k];
  }

  m.updatedAt = new Date().toISOString();
  return m;
}

function helpPayload() {
  return {
    success: true,
    service: "levpay-api",
    adminConfigured: !!ADMIN_KEY,
    storage: {
      github: {
        enabled: ghConfigured(),
        owner: GH_OWNER || null,
        repo: GH_REPO || null,
        branch: GH_BRANCH || "main",
        path: GH_DB_PATH || null,
        apiBase: GH_API_BASE || "https://api.github.com",
      },
      tmpFallback: !ghConfigured(),
    },
    actions: [
      "ping",
      "help",
      "discount.apply",
      "discount.commit",
      "discount.release",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",
      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",
    ],
    notes: [
      "Monthly promo selalu butuh kode (monthly.code). Kalau kosong, monthly tidak akan pernah kepake.",
      "Unlimited mode = monthly.unlimitedEnabled (global). OFF => whitelist device unlimited diabaikan.",
      "Whitelist device unlimited tetap di backend/db (monthly.unlimited). UI tidak menampilkan sha/device.",
    ],
  };
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();
  const body = await readBody(req);

  const db = ensure(await readDB());

  if (!action || action === "help") return send(res, 200, helpPayload());
  if (action === "ping") return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });

  try {
    // ===== PUBLIC DISCOUNT =====
    if (action === "discount.apply") {
      const amount = Number(body.amount);
      const deviceId = String(body.deviceId || body.deviceid || body.device_id || "").trim();
      const code = String(body.voucher || body.code || body.voucherCode || "").trim();

      if (!Number.isFinite(amount) || amount < 1) return send(res, 400, { success: false, error: "amount invalid" });
      if (!deviceId) return send(res, 400, { success: false, error: "deviceId required" });

      const out = applyDiscount({
        db,
        amount,
        deviceId,
        voucherCode: code,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      await writeDB(db);

      return send(res, 200, {
        success: true,
        data: {
          finalAmount: out.finalAmount,
          discountRp: out.discountRp,
          applied: out.applied,
          reservations: out.reservations,
          deviceKey: out.deviceKey,
        },
      });
    }

    if (action === "discount.commit") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      commitReservations(db, reservations);
      await writeDB(db);
      return send(res, 200, { success: true, data: { committed: reservations.length } });
    }

    if (action === "discount.release") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      releaseReservations(db, reservations);
      await writeDB(db);
      return send(res, 200, { success: true, data: { released: reservations.length } });
    }

    // ===== PAIDHOOK optional =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });
      // optional: store payload into tx
      const id = String(body.idTransaksi || body.id || "").trim();
      if (id) {
        db.tx[id] = { ...(db.tx[id] || {}), ...body, idTransaksi: id, updatedAt: new Date().toISOString() };
        await writeDB(db);
      }
      return send(res, 200, { success: true, data: { received: true, idTransaksi: id || null } });
    }

    // ===== ADMIN REQUIRED =====
    if (action.startsWith("voucher.") || action.startsWith("monthly.")) {
      if (!ADMIN_KEY) return send(res, 500, { success: false, error: "ADMIN_KEY not set in env" });
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""))
        );
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "").trim().toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v });
      }

      if (action === "voucher.upsert") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const out = adminUpsertVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.disable") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const out = adminDisableVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "monthly.get") {
        cleanupExpiredReservations(db);
        const m = db.promo.monthly;
        // jangan bocorin list key ke UI (tapi tetep kasih count biar user tau ada data)
        const unlimitedCount = Object.keys(m.unlimited || {}).length;
        return send(res, 200, {
          success: true,
          data: {
            enabled: !!m.enabled,
            unlimitedEnabled: !!m.unlimitedEnabled,
            code: String(m.code || ""),
            name: String(m.name || ""),
            percent: Number(m.percent || 0),
            maxRp: Number(m.maxRp || 0),
            maxUses: m.maxUses == null ? null : Number(m.maxUses),
            unlimitedCount,
            updatedAt: m.updatedAt || null,
          },
        });
      }

      if (action === "monthly.set") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const out = adminSetMonthly(db, body || {});
        await writeDB(db);
        const unlimitedCount = Object.keys(out.unlimited || {}).length;
        return send(res, 200, {
          success: true,
          data: {
            enabled: !!out.enabled,
            unlimitedEnabled: !!out.unlimitedEnabled,
            code: String(out.code || ""),
            name: String(out.name || ""),
            percent: Number(out.percent || 0),
            maxRp: Number(out.maxRp || 0),
            maxUses: out.maxUses == null ? null : Number(out.maxUses),
            unlimitedCount,
            updatedAt: out.updatedAt || null,
          },
        });
      }
    }

    return send(res, 404, { success: false, error: "Unknown action" });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};