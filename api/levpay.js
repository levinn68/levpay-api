// api/levpay.js (Vercel SINGLE-FILE ROUTER) — FINAL (GH DB + flexible monthly + tutor)
// Endpoints via query action (recommended):
// - /api/levpay?action=ping | help | tutor
// - /api/levpay?action=discount.apply|discount.commit|discount.release
// - /api/levpay?action=voucher.upsert|voucher.disable|voucher.list|voucher.get
// - /api/levpay?action=monthly.get|monthly.set
// - /api/levpay?action=tx.upsert|tx.get|tx.list|tx.search|tx.clear
// - /api/levpay?action=paidhook
//
// Notes:
// - Admin endpoints require header: X-Admin-Key: <ADMIN_KEY>
// - DB stored in GitHub file (recommended). /tmp fallback only if GH config missing.
//
// ===== GH ENV (WAJIB GH_*, JANGAN GITHUB_*) =====
// - GH_TOKEN  : GitHub PAT (repo scope for private / contents:write)
// - GH_OWNER  : owner/org
// - GH_REPO   : repo name
// - GH_BRANCH : default "main"
// - GH_DB_PATH: default "db/levpay-db.json"  (bebas, tapi harus file json)
// Optional:
// - GH_API_BASE: default "https://api.github.com" (kalau enterprise, isi base API)
// =================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ====== CONFIG ======
const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// Admin key untuk ADMIN endpoints (voucher/monthly/tx admin ops)
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";

// Secret optional buat callback/hook (kalau lu mau proteksi paidhook)
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || ""; // kosong = off

// Pepper buat bikin deviceKey (monthly promo tracking)
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4";

// ====== GH CONFIG (WAJIB pakai GH_) ======
const GH_API_BASE = process.env.GH_API_BASE || "https://api.github.com";
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_DB_PATH = process.env.GH_DB_PATH || "db/levpay-db.json";

// DeviceKey yang unlimited (bypass limit promo bulanan)
// MASUKIN HASIL SHA256(deviceId + "|" + DEVICE_PEPPER)
const UNLIMITED_DEVICE_KEYS = new Set(["3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805"]);

// ====== utils ======
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
  const k = String(req.headers["x-admin-key"] || "").trim();
  return !!(k && k === ADMIN_KEY);
}

function checkCallbackSecret(req) {
  if (!CALLBACK_SECRET) return true;
  const k = String(req.headers["x-callback-secret"] || "").trim();
  return !!(k && k === CALLBACK_SECRET);
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

function getDeviceKey(deviceId, pepper = DEVICE_PEPPER) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(pepper || ""))
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

// ====== GH DB helpers ======
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

  const content = Buffer.from(JSON.stringify(jsonObj, null, 2), "utf8").toString(
    "base64"
  );

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

// ====== DB read/write ======
async function readDB() {
  // prefer GitHub
  if (ghConfigured()) {
    try {
      const f = await ghGetFile();
      if (!f.exists) return {};
      const raw = f.content || "";
      return raw ? JSON.parse(raw) : {};
    } catch {
      // fallback /tmp kalau GH error
    }
  }

  // fallback /tmp (testing)
  try {
    if (!fs.existsSync(TMP_DB_PATH)) return {};
    const raw = fs.readFileSync(TMP_DB_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeDB(db) {
  // prefer GitHub
  if (ghConfigured()) {
    const f = await ghGetFile().catch(() => ({ exists: false, sha: null }));
    const sha = f.exists ? f.sha : null;
    await ghPutFile(db, sha);
    return true;
  }

  // fallback /tmp (testing)
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ====== DB init / ensure ======
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // MONTHLY PROMO — flexible
  // - enabled: on/off
  // - name: label tampil
  // - percent/maxRp: diskon
  // - requireCode: kalau true, monthly hanya jalan jika voucherCode == code
  // - code: kode monthly kalau requireCode = true
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      // NEW (flex)
      requireCode: false,
      code: "",

      used: {},
      reserved: {},
      unlimited: {},
      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};

  // seed unlimited keys
  for (const k of UNLIMITED_DEVICE_KEYS) db.promo.monthly.unlimited[k] = true;

  return db;
}

function cleanupExpiredReservations(db) {
  ensure(db);
  const now = Date.now();

  // monthly reserved cleanup
  for (const [deviceKey, r] of Object.entries(db.promo.monthly.reserved || {})) {
    const exp = Date.parse(r?.expiresAt || "");
    if (Number.isFinite(exp) && now > exp) delete db.promo.monthly.reserved[deviceKey];
  }

  // voucher reserved cleanup
  for (const [code, v] of Object.entries(db.vouchers || {})) {
    if (!v || !v.reserved) continue;
    for (const [t, expAt] of Object.entries(v.reserved)) {
      const exp = Date.parse(expAt || "");
      if (Number.isFinite(exp) && now > exp) delete v.reserved[t];
    }
    if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
  }
}

// ====== Discount engine (reserve/apply/commit/release) ======
function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, voucherCodeMaybe) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // FLEX: requireCode mode
  if (p.requireCode) {
    const want = String(p.code || "").trim().toUpperCase();
    const got = String(voucherCodeMaybe || "").trim().toUpperCase();
    if (!want || got !== want) return { ok: false, discountRp: 0 };
  }

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // kalau sudah reserved bulan ini -> jangan kasih lagi sampai expired
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  const percent = clamp(Number(p.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(p.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp > 0) {
    const t = token();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    p.reserved[deviceKey] = { token: t, month: cur, expiresAt };

    return {
      ok: true,
      discountRp,
      info: {
        type: "monthly",
        name: p.name || "PROMO BULANAN",
        percent,
        maxRp,
        code: p.requireCode ? String(p.code || "").trim().toUpperCase() : null,
      },
      reservation: {
        type: "monthly",
        deviceKey,
        token: t,
        month: cur,
        expiresAt,
        discountRp,
      },
    };
  }

  return { ok: false, discountRp: 0 };
}

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

  // maxUses check (uses + reserved)
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

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  // voucher dulu
  const v = reserveVoucher(db, finalAmount, voucherCode, reserveTtlMs);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
  }

  // monthly setelah voucher (atau requireCode mode, voucherCode bisa jadi monthly code)
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs, voucherCode);
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

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = db.promo.monthly.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) {
        db.promo.monthly.used[r.deviceKey] = r.month;
        delete db.promo.monthly.reserved[r.deviceKey];
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

// ====== ADMIN ops ======
function adminUpsertVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    code,
    name: body.name ? String(body.name) : prev.name || code,

    // allow toggle via admin page
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

// voucher.disable (admin) — by default OFF, but can also toggle if body.enabled provided
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
  if (body.name != null) p.name = String(body.name);

  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  // FLEX: monthly code config
  if (body.requireCode != null) p.requireCode = !!body.requireCode;
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase();

  // add/remove unlimited by deviceKey (sha256)
  if (body.addUnlimitedDeviceKey != null) {
    const k = String(body.addUnlimitedDeviceKey).trim();
    if (k) p.unlimited[k] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const k = String(body.removeUnlimitedDeviceKey).trim();
    if (k && p.unlimited) delete p.unlimited[k];
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

// ====== TX store ops (simple) ======
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

// ====== HELP / TUTOR ======
function help() {
  return {
    success: true,
    service: "levpay-api (single file)",
    storage: {
      gh: {
        enabled: ghConfigured(),
        owner: GH_OWNER || null,
        repo: GH_REPO || null,
        branch: GH_BRANCH || "main",
        path: GH_DB_PATH || null,
        apiBase: GH_API_BASE || "https://api.github.com",
      },
      tmpFallback: !ghConfigured(),
    },
    paths: { recommended: "/api/levpay?action=..." },
    actions: [
      "ping",
      "help",
      "tutor",

      "discount.apply",
      "discount.commit",
      "discount.release",

      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",

      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",

      "tx.upsert (ADMIN)",
      "tx.get (ADMIN)",
      "tx.list (ADMIN)",
      "tx.search (ADMIN)",
      "tx.clear (ADMIN)",

      "paidhook",
    ],
    admin: { header: "X-Admin-Key", requiredFor: ["voucher.*", "monthly.*", "tx.*"] },
  };
}

function tutor(hostHint) {
  const HOST = hostHint || "https://YOUR-VERCEL-DOMAIN";
  return {
    success: true,
    note: "Copy-paste curl sesuai endpoint. ADMIN endpoints wajib header X-Admin-Key.",
    host: HOST,
    examples: {
      ping: {
        method: "GET",
        curl: `curl -sS "${HOST}/api/levpay?action=ping" | jq`,
      },
      help: {
        method: "GET",
        curl: `curl -sS "${HOST}/api/levpay?action=help" | jq`,
      },
      discount_apply: {
        method: "POST",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=discount.apply" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"amount":10000,"deviceId":"dev_1","voucher":"LEVPAYVIP"}' | jq`,
      },
      discount_commit: {
        method: "POST",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=discount.commit" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"reservations":[{"type":"voucher","code":"LEVPAYVIP","token":"..."}]}' | jq`,
      },
      discount_release: {
        method: "POST",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=discount.release" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"reservations":[{"type":"voucher","code":"LEVPAYVIP","token":"..."}]}' | jq`,
      },

      voucher_upsert: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.upsert" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"code":"KINGLEV","name":"KINGLEV 60%","enabled":true,"percent":60,"maxRp":0,"maxUses":null,"expiresAt":null,"note":"custom"}' | jq`,
      },
      voucher_disable: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.disable" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"code":"KINGLEV"}' | jq`,
      },
      voucher_enable_again: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.disable" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"code":"KINGLEV","enabled":true}' | jq`,
      },
      voucher_list: {
        method: "GET (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.list" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" -d '{}' | jq`,
      },
      voucher_get: {
        method: "GET/POST (ADMIN)",
        curl:
          `curl -sS "${HOST}/api/levpay?action=voucher.get&code=KINGLEV" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" | jq`,
      },

      monthly_get: {
        method: "GET (ADMIN)",
        curl: `curl -sS "${HOST}/api/levpay?action=monthly.get" -H "X-Admin-Key: ${ADMIN_KEY}" | jq`,
      },
      monthly_set_auto: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=monthly.set" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"enabled":true,"name":"PROMO BULANAN","percent":10,"maxRp":5000,"requireCode":false}' | jq`,
      },
      monthly_set_require_code: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=monthly.set" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"enabled":true,"name":"PROMO BULANAN KODE","percent":15,"maxRp":7000,"requireCode":true,"code":"MONTHLYVIP"}' | jq`,
      },
      monthly_add_unlimited_deviceKey: {
        method: "POST (ADMIN)",
        note: "deviceKey = SHA256(deviceId + '|' + DEVICE_PEPPER)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=monthly.set" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"addUnlimitedDeviceKey":"<DEVICE_KEY_SHA256>"}' | jq`,
      },

      tx_upsert: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=tx.upsert" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" ` +
          `-H "Content-Type: application/json" ` +
          `-d '{"idTransaksi":"TRX123","status":"paid","amount":10000}' | jq`,
      },
      tx_list: {
        method: "GET (ADMIN)",
        curl: `curl -sS "${HOST}/api/levpay?action=tx.list&limit=50" -H "X-Admin-Key: ${ADMIN_KEY}" | jq`,
      },
      tx_search: {
        method: "GET (ADMIN)",
        curl: `curl -sS "${HOST}/api/levpay?action=tx.search&q=TRX" -H "X-Admin-Key: ${ADMIN_KEY}" | jq`,
      },
      tx_clear: {
        method: "POST (ADMIN)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=tx.clear" ` +
          `-H "X-Admin-Key: ${ADMIN_KEY}" -H "Content-Type: application/json" -d '{}' | jq`,
      },

      paidhook: {
        method: "POST (optional secret)",
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=paidhook" ` +
          (CALLBACK_SECRET ? `-H "X-Callback-Secret: ${CALLBACK_SECRET}" ` : "") +
          `-H "Content-Type: application/json" ` +
          `-d '{"idTransaksi":"TRX123","status":"paid","paidAt":"${new Date().toISOString()}"}' | jq`,
      },
    },
  };
}

// ====== MAIN HANDLER ======
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  // body
  const body = await readBody(req);

  // db
  const db = ensure(await readDB());

  // ping/help/tutor
  if (!action || action === "help") return send(res, 200, help());
  if (action === "tutor") {
    const host = url.searchParams.get("host") || "";
    return send(res, 200, tutor(host));
  }
  if (action === "ping") return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });

  try {
    // ===== DISCOUNT =====
    if (action === "discount.apply" || action === "apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const voucher = body.voucher || body.voucherCode || body.code || "";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      const r = applyDiscount({
        db,
        amount,
        deviceId,
        voucherCode: voucher,
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

    // ===== VOUCHER (ADMIN) =====
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

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // ===== MONTHLY (ADMIN) =====
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

    // ===== TX (ADMIN) =====
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

    // ===== PAIDHOOK (optional secret) =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });

      // simpan minimal ke tx store (kalau ada idTransaksi)
      const id = String(body.idTransaksi || body.id || "").trim();
      if (id) {
        txUpsert(db, { ...body, idTransaksi: id });
        await writeDB(db);
      }

      return send(res, 200, { success: true, data: { received: true, idTransaksi: id || null } });
    }

    return send(res, 404, {
      success: false,
      error: "Unknown action",
      hint: "use action=discount.apply|discount.commit|discount.release|voucher.*|monthly.*|tx.*|paidhook|help|ping|tutor",
    });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};