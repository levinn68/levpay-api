// api/levpay.js — FINAL (Vercel single-file router)
// - Voucher & Promo Bulanan: WAJIB pakai KODE (user harus input)
// - Unlimited device: aman (admin input Device ID, server hitung SHA256 pakai DEVICE_PEPPER)
// - Admin gate: voucher/monthly/tx/devicekey wajib X-Admin-Key
//
// ENV wajib disaranin:
// - ADMIN_KEY        (jangan hardcode di client)
// - DEVICE_PEPPER    (RAHASIA, jangan dibocorin)
// - GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH(optional), GH_DB_PATH(optional)
// Optional:
// - CALLBACK_SECRET
// - UNLIMITED_DEVICE_KEYS  (comma-separated deviceKey sha256)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// ===== CONFIG =====
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824"; // set di env biar aman
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || ""; // optional
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || ""; // WAJIB disarankan

// ===== GH CONFIG =====
const GH_API_BASE = process.env.GH_API_BASE || "https://api.github.com";
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_DB_PATH = process.env.GH_DB_PATH || "db/levpay-db.json";

// ===== seed unlimited keys (optional via env) =====
function parseUnlimitedKeys() {
  const raw = String(process.env.UNLIMITED_DEVICE_KEYS || "3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(raw);
}
const UNLIMITED_DEVICE_KEYS = parseUnlimitedKeys();

// ===== fetch polyfill (buat runtime yang belum ada fetch) =====
async function ensureFetch() {
  if (typeof fetch !== "undefined") return fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key, X-Callback-Secret");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end("");
    return true;
  }
  return false;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function token() {
  return crypto.randomBytes(10).toString("hex");
}

function yyyymm(d = new Date()) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function getDeviceKey(deviceId) {
  // DEVICE_PEPPER wajib (biar konsisten deviceKey)
  if (!DEVICE_PEPPER) return crypto.createHash("sha256").update(String(deviceId || "") + "|").digest("hex");
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(DEVICE_PEPPER))
    .digest("hex");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // vercel biasanya udah parse
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

function isAdmin(req) {
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
  const _fetch = await ensureFetch();
  const url =
    `${GH_API_BASE}/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}/contents/${GH_DB_PATH}` +
    `?ref=${encodeURIComponent(GH_BRANCH)}`;

  const r = await _fetch(url, { method: "GET", headers: ghHeaders() });
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
  const _fetch = await ensureFetch();
  const url = `${GH_API_BASE}/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}/contents/${GH_DB_PATH}`;

  const content = Buffer.from(JSON.stringify(jsonObj, null, 2), "utf8").toString("base64");

  const body = {
    message: `levpay db update ${new Date().toISOString()}`,
    content,
    branch: GH_BRANCH,
  };
  if (shaMaybe) body.sha = shaMaybe;

  const r = await _fetch(url, {
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
      // fallback /tmp
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

// ===== DB init =====
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // Promo bulanan: WAJIB KODE (user harus input)
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      code: "", // wajib diset di admin, kalau kosong = promo gak bisa kepake
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
      maxUses: null, // global per bulan (kosong = unlimited)
      used: {}, // per deviceKey => yyyymm
      usedCount: {}, // yyyymm => count (global)
      reserved: {}, // deviceKey => { token, month, expiresAt }
      unlimited: {}, // deviceKey => true
      updatedAt: null,
    };

  const p = db.promo.monthly;
  p.used = p.used || {};
  p.usedCount = p.usedCount || {};
  p.reserved = p.reserved || {};
  p.unlimited = p.unlimited || {};

  // seed from env (optional)
  for (const k of UNLIMITED_DEVICE_KEYS) p.unlimited[k] = true;

  return db;
}

function cleanupExpiredReservations(db) {
  ensure(db);
  const now = Date.now();
  const p = db.promo.monthly;

  for (const [deviceKey, r] of Object.entries(p.reserved || {})) {
    const exp = Date.parse(r?.expiresAt || "");
    if (Number.isFinite(exp) && now > exp) delete p.reserved[deviceKey];
  }

  for (const [code, v] of Object.entries(db.vouchers || {})) {
    if (!v || !v.reserved) continue;
    for (const [t, expAt] of Object.entries(v.reserved)) {
      const exp = Date.parse(expAt || "");
      if (Number.isFinite(exp) && now > exp) delete v.reserved[t];
    }
    if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
  }
}

// ===== Discount engine =====
function reserveVoucher(db, amount, voucherCode, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  if (!voucherCode) return { ok: false, discountRp: 0 };

  const code = String(voucherCode).trim().toUpperCase();
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

  if (v.maxUses != null) {
    const used = Number(v.uses || 0);
    if (used + reservedCount >= Number(v.maxUses)) return { ok: false, discountRp: 0 };
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

function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, inputCode) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // WAJIB KODE: kalau p.code kosong / input gak match -> NO DISKON
  const want = String(p.code || "").trim().toUpperCase();
  const got = String(inputCode || "").trim().toUpperCase();
  if (!want || got !== want) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const isUnlimited = !!p.unlimited?.[deviceKey];

  // global max uses per month (optional)
  const maxUses = p.maxUses == null ? null : Number(p.maxUses);
  if (Number.isFinite(maxUses) && maxUses > 0) {
    const usedCount = Number(p.usedCount?.[cur] || 0);
    const reservedCount = Object.values(p.reserved || {}).filter((r) => r && r.month === cur).length;
    if (usedCount + reservedCount >= maxUses) return { ok: false, discountRp: 0 };
  }

  // per device 1x/bulan (kecuali unlimited)
  const lastUsed = p.used?.[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  const rsv = p.reserved?.[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  const percent = clamp(Number(p.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(p.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  p.reserved[deviceKey] = { token: t, month: cur, expiresAt };

  return {
    ok: true,
    discountRp,
    info: {
      type: "monthly",
      name: p.name || "PROMO BULANAN",
      code: want,
      percent,
      maxRp,
      maxUses: p.maxUses ?? null,
    },
    reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
  };
}

function applyDiscount({ db, amount, deviceId, code, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  // 1) Voucher (kalau kode cocok voucher)
  const v = reserveVoucher(db, finalAmount, code, reserveTtlMs);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
  }

  // 2) Monthly (kalau kode cocok monthly.code)
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs, code);
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

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = db.promo.monthly.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) delete db.promo.monthly.reserved[r.deviceKey];
    }

    if (r.type === "voucher") {
      const v = db.vouchers?.[r.code];
      if (v?.reserved?.[r.token]) delete v.reserved[r.token];
      if (v?.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
    }
  }
}

function commitReservations(db, reservations) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = p.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) {
        p.used[r.deviceKey] = r.month;
        p.usedCount[r.month] = Number(p.usedCount?.[r.month] || 0) + 1;
        delete p.reserved[r.deviceKey];
      }
    }

    if (r.type === "voucher") {
      const v = db.vouchers?.[r.code];
      if (v?.reserved?.[r.token]) {
        delete v.reserved[r.token];
        v.uses = Number(v.uses || 0) + 1;
        if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      }
    }
  }
}

// ===== Admin ops =====
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
    note: body.note ? String(body.note) : prev.note || null,
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

function adminSetMonthlyPromo(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase();
  if (body.name != null) p.name = String(body.name || "").trim();
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));
  if (body.maxUses !== undefined) {
    const mu = body.maxUses;
    if (mu == null || String(mu).trim() === "") p.maxUses = null;
    else {
      const n = Number(mu);
      p.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  // unlimited: bisa input deviceKey langsung ATAU deviceId (lebih aman)
  if (body.addUnlimitedDeviceKey != null) {
    const k = String(body.addUnlimitedDeviceKey).trim();
    if (k) p.unlimited[k] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const k = String(body.removeUnlimitedDeviceKey).trim();
    if (k && p.unlimited) delete p.unlimited[k];
  }
  if (body.addUnlimitedDeviceId != null) {
    const dk = getDeviceKey(String(body.addUnlimitedDeviceId || "").trim());
    if (dk) p.unlimited[dk] = true;
  }
  if (body.removeUnlimitedDeviceId != null) {
    const dk = getDeviceKey(String(body.removeUnlimitedDeviceId || "").trim());
    if (dk && p.unlimited) delete p.unlimited[dk];
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

// ===== TX ops =====
function txUpsert(db, body) {
  ensure(db);
  const id = String(body.idTransaksi || body.id || "").trim();
  if (!id) throw new Error("idTransaksi required");
  const prev = db.tx[id] || {};
  db.tx[id] = {
    ...prev,
    ...body,
    idTransaksi: id,
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  return db.tx[id];
}

function txGet(db, id) {
  ensure(db);
  return db.tx?.[id] || null;
}

function txList(db, limit = 200) {
  ensure(db);
  const arr = Object.values(db.tx || {});
  arr.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return arr.slice(0, clamp(Number(limit || 200), 1, 1000));
}

function txSearch(db, q) {
  ensure(db);
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [];
  const arr = Object.values(db.tx || {});
  return arr.filter((t) => JSON.stringify(t).toLowerCase().includes(s)).slice(0, 200);
}

function txClear(db) {
  ensure(db);
  db.tx = {};
  return true;
}

function help() {
  return {
    success: true,
    service: "levpay-api",
    note: "Diskon hanya jalan jika user input KODE dan cocok (voucher / monthly).",
    env: {
      adminKeySet: !!process.env.ADMIN_KEY,
      devicePepperSet: !!process.env.DEVICE_PEPPER,
      ghConfigured: ghConfigured(),
    },
    routes: [
      "GET  /api/levpay?action=ping",
      "POST /api/levpay?action=discount.apply (public)",
      "POST /api/levpay?action=discount.commit (public)",
      "POST /api/levpay?action=discount.release (public)",
      "POST /api/levpay?action=paidhook (optional secret)",
      "ADMIN: voucher.* monthly.* tx.* devicekey",
    ],
  };
}

// ===== MAIN HANDLER =====
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  const body = await readBody(req);

  const db = ensure(await readDB());

  if (!action || action === "help") return send(res, 200, help());
  if (action === "ping") return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });

  try {
    // ===== PUBLIC: discount =====
    if (action === "discount.apply" || action === "apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const code = body.voucher || body.code || body.voucherCode || "";

      if (!Number.isFinite(amount) || amount < 1) return send(res, 400, { success: false, error: "amount invalid" });
      if (!String(deviceId || "").trim()) return send(res, 400, { success: false, error: "deviceId required" });

      const r = applyDiscount({
        db,
        amount,
        deviceId,
        code,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      await writeDB(db);

      return send(res, 200, {
        success: true,
        data: {
          finalAmount: r.finalAmount,
          discountRp: r.discountRp,
          applied: r.applied,
          reservations: r.reservations,
          deviceKey: r.deviceKey,
        },
      });
    }

    if (action === "discount.commit" || action === "commit") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      commitReservations(db, reservations);
      await writeDB(db);
      return send(res, 200, { success: true, data: { committed: reservations.length } });
    }

    if (action === "discount.release" || action === "release") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      releaseReservations(db, reservations);
      await writeDB(db);
      return send(res, 200, { success: true, data: { released: reservations.length } });
    }

    // ===== ADMIN: devicekey (biar UI gak butuh pepper) =====
    if (action === "devicekey") {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });
      const deviceId = String(body.deviceId || body.deviceid || "").trim();
      if (!deviceId) return send(res, 400, { success: false, error: "deviceId required" });
      const deviceKey = getDeviceKey(deviceId);
      return send(res, 200, { success: true, data: { deviceId, deviceKey } });
    }

    // ===== ADMIN: voucher =====
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = adminUpsertVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.disable") {
        const out = adminDisableVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "").trim().toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v });
      }

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // ===== ADMIN: monthly =====
    if (action.startsWith("monthly.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "monthly.get") {
        cleanupExpiredReservations(db);
        return send(res, 200, { success: true, data: db.promo.monthly });
      }

      if (action === "monthly.set") {
        const out = adminSetMonthlyPromo(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // ===== ADMIN: tx =====
    if (action.startsWith("tx.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "tx.upsert") {
        const out = txUpsert(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "tx.get") {
        const id = String(body.idTransaksi || url.searchParams.get("idTransaksi") || "").trim();
        if (!id) return send(res, 400, { success: false, error: "idTransaksi required" });
        const out = txGet(db, id);
        if (!out) return send(res, 404, { success: false, error: "not found" });
        return send(res, 200, { success: true, data: out });
      }

      if (action === "tx.list") {
        const limit = Number(body.limit || url.searchParams.get("limit") || 200);
        const out = txList(db, limit);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "tx.search") {
        const q = body.q || url.searchParams.get("q") || "";
        const out = txSearch(db, q);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "tx.clear") {
        txClear(db);
        await writeDB(db);
        return send(res, 200, { success: true, data: { cleared: true } });
      }

      return send(res, 400, { success: false, error: "Unknown tx action" });
    }

    // ===== paidhook =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });

      const id = String(body.idTransaksi || body.id || "").trim();
      if (id) {
        txUpsert(db, { ...body, idTransaksi: id });
        await writeDB(db);
      }
      return send(res, 200, { success: true, data: { received: true, idTransaksi: id || null } });
    }

    return send(res, 404, { success: false, error: "Unknown action" });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};