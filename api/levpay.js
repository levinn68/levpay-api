// api/levpay.js — FINAL
// - Voucher + Monthly promo (require code by default, bukan auto)
// - Unlimited whitelist toggle (ON/OFF) tanpa nampilin SHA/pepper di admin page
// - Voucher delete
// - GH DB storage (recommended) + /tmp fallback

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// ====== ENV ======
const ADMIN_KEY = String(process.env.ADMIN_KEY || "LEVIN6824").trim();
const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim();

// Pepper (server only)
const DEVICE_PEPPER = String(
  process.env.DEVICE_PEPPER ||
    "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4"
).trim();

// GH DB
const GH_API_BASE = process.env.GH_API_BASE || "https://api.github.com";
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_DB_PATH = process.env.GH_DB_PATH || "db/levpay-db.json";

// Unlimited whitelist (SERVER ONLY; admin page gak nampilin)
// Kamu bisa set salah satu:
// - UNLIMITED_DEVICE_KEYS="sha256a,sha256b"
// - UNLIMITED_DEVICE_IDS="dev_1,dev_2"  (lebih enak, backend yg hash)
const ENV_UNLIMITED_DEVICE_KEYS = String(process.env.UNLIMITED_DEVICE_KEYS || "3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ENV_UNLIMITED_DEVICE_IDS = String(process.env.UNLIMITED_DEVICE_IDS || "dev_5a816e29352778_19b17b3bd88")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ====== helpers ======
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

function getDeviceKey(deviceId) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(DEVICE_PEPPER || ""))
    .digest("hex");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
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

// ====== DB ======
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

// ====== Ensure + Flags ======
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // global flags (admin toggle)
  db.promo.flags = db.promo.flags || {
    monthlyUnlimitedEnabled: true, // ON => device whitelist unlimited
    voucherUnlimitedEnabled: true, // ON => device whitelist bypass voucher limits
  };

  // monthly promo
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      // REQUIRE CODE by default (biar gak auto kepake)
      requireCode: true,
      code: "PROMO",

      // per device tracking
      used: {}, // deviceKey => yyyymm
      reserved: {}, // deviceKey => {token, month, expiresAt}

      // whitelist (server only)
      unlimited: {}, // deviceKey => true

      // optional global max uses per month
      maxUses: null,
      usedCountByMonth: {}, // yyyymm => count

      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};
  db.promo.monthly.usedCountByMonth = db.promo.monthly.usedCountByMonth || {};

  // seed unlimited whitelist from ENV
  for (const k of ENV_UNLIMITED_DEVICE_KEYS) db.promo.monthly.unlimited[k] = true;
  for (const id of ENV_UNLIMITED_DEVICE_IDS) {
    const k = getDeviceKey(id);
    db.promo.monthly.unlimited[k] = true;
  }

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

  // voucher reserved cleanup (token-based)
  for (const [code, v] of Object.entries(db.vouchers || {})) {
    if (!v || !v.reserved) continue;
    for (const [t, expAt] of Object.entries(v.reserved)) {
      const exp = Date.parse(expAt || "");
      if (Number.isFinite(exp) && now > exp) delete v.reserved[t];
    }
    if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
  }
}

// ====== Discount ======
function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, voucherCodeMaybe) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // require code mode
  if (p.requireCode) {
    const want = String(p.code || "").trim().toUpperCase();
    const got = String(voucherCodeMaybe || "").trim().toUpperCase();
    if (!want || got !== want) return { ok: false, discountRp: 0 };
  }

  const cur = yyyymm();

  // Unlimited whitelist only works if flag ON
  const unlimitedEnabled = !!db.promo.flags?.monthlyUnlimitedEnabled;
  const isUnlimited = unlimitedEnabled && !!p.unlimited?.[deviceKey];

  // per-device 1x/month
  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // already reserved this month
  const rsv = p.reserved[deviceKey];
  if (!isUnlimited && rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // optional global maxUses per month
  if (!isUnlimited && p.maxUses != null) {
    const max = Number(p.maxUses);
    if (Number.isFinite(max) && max > 0) {
      const usedCnt = Number(p.usedCountByMonth?.[cur] || 0);
      const reservedCnt = Object.values(p.reserved || {}).filter((x) => x?.month === cur).length;
      if (usedCnt + reservedCnt >= max) return { ok: false, discountRp: 0 };
    }
  }

  const percent = clamp(Number(p.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(p.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp > 0) {
    const t = token();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    if (!isUnlimited) p.reserved[deviceKey] = { token: t, month: cur, expiresAt };

    return {
      ok: true,
      discountRp,
      info: {
        type: "monthly",
        name: p.name || "PROMO BULANAN",
        percent,
        maxRp,
        code: String(p.code || "").trim().toUpperCase(),
        requireCode: !!p.requireCode,
        unlimitedApplied: !!isUnlimited,
      },
      reservation: isUnlimited
        ? null
        : {
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

function reserveVoucher(db, amount, voucherCode, ttlMs, deviceKey) {
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

  const unlimitedEnabled = !!db.promo.flags?.voucherUnlimitedEnabled;
  const monthlyWhitelist = !!db.promo.monthly?.unlimited?.[deviceKey];
  const isUnlimited = unlimitedEnabled && monthlyWhitelist; // reuse whitelist

  const percent = clamp(Number(v.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;
  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  // maxUses check (skip if unlimited device)
  v.reserved = v.reserved || {};
  const reservedCount = Object.keys(v.reserved).length;

  if (!isUnlimited && v.maxUses != null) {
    const used = Number(v.uses || 0);
    if (used + reservedCount >= Number(v.maxUses)) return { ok: false, discountRp: 0 };
  }

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // if unlimited device => no reserve slot (biar gak ganggu counter)
  if (!isUnlimited) v.reserved[t] = expiresAt;

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
      unlimitedApplied: !!isUnlimited,
    },
    reservation: isUnlimited ? null : { type: "voucher", code, token: t, expiresAt, discountRp },
  };
}

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  // voucher first
  const v = reserveVoucher(db, finalAmount, voucherCode, reserveTtlMs, deviceKey);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    if (v.reservation) reservations.push(v.reservation);
  }

  // monthly after voucher
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs, voucherCode);
  if (m.ok) {
    finalAmount = Math.max(1, finalAmount - m.discountRp);
    discountRp += m.discountRp;
    applied.push(m.info);
    if (m.reservation) reservations.push(m.reservation);
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

  const curMonth = yyyymm();

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = db.promo.monthly.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) {
        db.promo.monthly.used[r.deviceKey] = r.month;
        delete db.promo.monthly.reserved[r.deviceKey];

        db.promo.monthly.usedCountByMonth[curMonth] =
          Number(db.promo.monthly.usedCountByMonth?.[curMonth] || 0) + 1;
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

function adminDeleteVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers[code]) throw new Error("voucher not found");
  delete db.vouchers[code];
  return true;
}

function adminSetMonthlyPromo(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.name != null) p.name = String(body.name);

  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  // requireCode ALWAYS supported
  if (body.requireCode != null) p.requireCode = !!body.requireCode;
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase();

  if (body.maxUses != null) {
    const v = body.maxUses === "" ? null : body.maxUses;
    p.maxUses = v == null ? null : Number(v);
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

function adminSetFlags(db, body) {
  ensure(db);
  const f = db.promo.flags;

  if (body.monthlyUnlimitedEnabled != null) f.monthlyUnlimitedEnabled = !!body.monthlyUnlimitedEnabled;
  if (body.voucherUnlimitedEnabled != null) f.voucherUnlimitedEnabled = !!body.voucherUnlimitedEnabled;

  return f;
}

// ====== public views (hide internal maps) ======
function publicMonthlyView(db) {
  ensure(db);
  const p = db.promo.monthly;
  return {
    enabled: !!p.enabled,
    name: p.name || "PROMO BULANAN",
    percent: Number(p.percent || 0),
    maxRp: Number(p.maxRp || 0),
    requireCode: !!p.requireCode,
    code: String(p.code || "").trim().toUpperCase(),
    maxUses: p.maxUses == null ? null : Number(p.maxUses),

    // info only
    unlimitedWhitelistCount: Object.keys(p.unlimited || {}).length,
    flags: { ...(db.promo.flags || {}) },
    updatedAt: p.updatedAt || null,
  };
}

function publicVoucherView(v) {
  if (!v) return null;
  return {
    code: String(v.code || "").trim().toUpperCase(),
    name: v.name || v.code,
    enabled: v.enabled !== false,
    percent: Number(v.percent || 0),
    maxRp: Number(v.maxRp || 0),
    maxUses: v.maxUses == null ? null : Number(v.maxUses),
    uses: Number(v.uses || 0),
    expiresAt: v.expiresAt || null,
    note: v.note || null,
    updatedAt: v.updatedAt || null,
  };
}

// ====== MAIN HANDLER ======
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();
  const body = await readBody(req);

  const db = ensure(await readDB());

  if (!action || action === "help") {
    return send(res, 200, {
      success: true,
      service: "levpay-api",
      storage: { gh: ghConfigured(), path: GH_DB_PATH, branch: GH_BRANCH },
      actions: [
        "ping",
        "help",
        "discount.apply",
        "discount.commit",
        "discount.release",
        "voucher.upsert (ADMIN)",
        "voucher.disable (ADMIN)",
        "voucher.delete (ADMIN)",
        "voucher.list (ADMIN)",
        "voucher.get (ADMIN)",
        "monthly.get (ADMIN)",
        "monthly.set (ADMIN)",
        "flags.get (ADMIN)",
        "flags.set (ADMIN)",
        "paidhook",
      ],
      adminHeader: "X-Admin-Key",
    });
  }

  if (action === "ping") {
    return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });
  }

  try {
    // ===== DISCOUNT =====
    if (action === "discount.apply" || action === "apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const voucher = body.voucher || body.voucherCode || body.code || body.vouccer || "";

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

    // ===== FLAGS (ADMIN) =====
    if (action.startsWith("flags.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "flags.get") {
        return send(res, 200, { success: true, data: db.promo.flags || {} });
      }

      if (action === "flags.set") {
        const out = adminSetFlags(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: out });
      }

      return send(res, 400, { success: false, error: "Unknown flags action" });
    }

    // ===== VOUCHER (ADMIN) =====
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = adminUpsertVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: publicVoucherView(out) });
      }

      if (action === "voucher.disable") {
        const out = adminDisableVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: publicVoucherView(out) });
      }

      if (action === "voucher.delete") {
        const ok = adminDeleteVoucher(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: { deleted: ok } });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {})
          .map(publicVoucherView)
          .filter(Boolean)
          .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "").trim().toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = publicVoucherView(db.vouchers?.[code]);
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
        return send(res, 200, { success: true, data: publicMonthlyView(db) });
      }

      if (action === "monthly.set") {
        const out = adminSetMonthlyPromo(db, body || {});
        await writeDB(db);
        return send(res, 200, { success: true, data: publicMonthlyView(db) });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // ===== PAIDHOOK (optional secret) =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });

      const id = String(body.idTransaksi || body.id || "").trim();
      if (id) {
        db.tx[id] = {
          ...(db.tx[id] || {}),
          ...body,
          idTransaksi: id,
          updatedAt: new Date().toISOString(),
          createdAt: (db.tx[id] || {}).createdAt || new Date().toISOString(),
        };
        await writeDB(db);
      }

      return send(res, 200, { success: true, data: { received: true, idTransaksi: id || null } });
    }

    return send(res, 404, {
      success: false,
      error: "Unknown action",
      hint: "use action=discount.*|voucher.*|monthly.*|flags.*|paidhook|help|ping",
    });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};