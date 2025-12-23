// api/levpay.js — FINAL
// Router: /api/levpay?action=...
// - voucher.* (ADMIN)
// - monthly.* (ADMIN)
// - system.* (ADMIN)  ✅ toggle unlimited whitelist ON/OFF (tanpa input sha di admin)
// - discount.apply/commit/release (optional tools)
// - tx.* (ADMIN) optional
//
// GH ENV (WAJIB GH_*):
// GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH, GH_DB_PATH, (optional GH_API_BASE)
//
// ADMIN ENV:
// ADMIN_KEY (default LEVIN6824)
//
// DEVICE ENV:
// DEVICE_PEPPER (wajib konsisten utk deviceKey sha256)
// UNLIMITED_DEVICE_KEYS="sha256_1,sha256_2,..." (opsional; kalau kosong pakai hardcode seed di bawah)
// api/levpay.js — ALIAS (biar /api/levpay?action=... tetap work)
// semua logic ada di /api/orkut.js (1 sumber kebenaran)
module.exports = require("./orkut");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// === ENV ===
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";
const DEVICE_PEPPER =
  process.env.DEVICE_PEPPER ||
  "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4"; // ✅ fallback pepper bener

// === GH ENV (WAJIB) ===
const GH_API_BASE = process.env.GH_API_BASE || "https://api.github.com";
const GH_TOKEN = process.env.GH_TOKEN || "";
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_DB_PATH = process.env.GH_DB_PATH || "db/levpay-db.json";

// ✅ Seed whitelist deviceKey dari backend (tanpa input di admin)
function parseUnlimitedKeys() {
  const raw = String(process.env.UNLIMITED_DEVICE_KEYS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // fallback hardcode kalau env kosong (isi punya lo)
  const fallback = [
    "3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805",
  ];

  const list = fromEnv.length ? fromEnv : fallback;
  return new Set(list);
}
const BACKEND_UNLIMITED_KEYS = parseUnlimitedKeys();

// ===== utils =====
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

// ===== GH DB helpers =====
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

// ===== DB ensure =====
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};
  db.system = db.system || {};

  // ✅ GLOBAL: unlimited whitelist toggle + list (list diset dari backend seed)
  db.system.unlimitedEnabled =
    db.system.unlimitedEnabled != null ? !!db.system.unlimitedEnabled : true;

  db.system.unlimitedKeys = db.system.unlimitedKeys || {};
  for (const k of BACKEND_UNLIMITED_KEYS) db.system.unlimitedKeys[k] = true;

  // MONTHLY PROMO (kode wajib utk dipakai)
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      code: "PROMO",
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      used: {}, // deviceKey -> yyyymm
      reserved: {}, // deviceKey -> {token, month, expiresAt}
      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};

  // vouchers: tambah reserved & perDeviceMonth default true
  for (const [code, v] of Object.entries(db.vouchers)) {
    if (!v) continue;
    v.code = String(v.code || code).trim().toUpperCase();
    if (v.enabled == null) v.enabled = true;
    if (v.perDeviceMonth == null) v.perDeviceMonth = true; // ✅ default: 1x/bulan/device
    if (!v.usedByDevice) v.usedByDevice = {};
    if (!v.reserved) v.reserved = {};
    if (!Number.isFinite(Number(v.uses))) v.uses = 0;
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

function isUnlimitedDevice(db, deviceKey) {
  ensure(db);
  if (!db.system.unlimitedEnabled) return false;
  return !!db.system.unlimitedKeys?.[deviceKey];
}

// ===== Discount engine =====
function reserveMonthly(db, amount, deviceKey, ttlMs, codeInput) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  const want = String(p.code || "").trim().toUpperCase();
  const got = String(codeInput || "").trim().toUpperCase();
  if (!want || got !== want) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const unlimited = isUnlimitedDevice(db, deviceKey);

  const lastUsed = p.used[deviceKey] || "";
  if (!unlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  const rsv = p.reserved[deviceKey];
  if (!unlimited && rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

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
    info: { type: "monthly", code: want, name: p.name || "PROMO", percent, maxRp },
    reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
  };
}

function reserveVoucher(db, amount, deviceKey, codeInput, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const code = String(codeInput || "").trim().toUpperCase();
  if (!code) return { ok: false, discountRp: 0 };

  const v = db.vouchers?.[code];
  if (!v || v.enabled === false) return { ok: false, discountRp: 0 };

  if (v.expiresAt) {
    const exp = Date.parse(v.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, discountRp: 0 };
  }

  const unlimited = isUnlimitedDevice(db, deviceKey);
  const cur = yyyymm();

  // ✅ per-device-per-month limit (default ON), tapi whitelist unlimited bypass
  if (v.perDeviceMonth && !unlimited) {
    const last = String(v.usedByDevice?.[deviceKey] || "");
    if (last === cur) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(Number(v.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;
  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  // maxUses global (uses + reserved)
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
      perDeviceMonth: !!v.perDeviceMonth,
    },
    reservation: { type: "voucher", code, deviceKey, token: t, expiresAt, month: cur, discountRp },
  };
}

function applyDiscount({ db, amount, deviceId, code, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  // 1) voucher
  const v = reserveVoucher(db, finalAmount, deviceKey, code, reserveTtlMs);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
    return { finalAmount, discountRp, applied, reservations, deviceKey };
  }

  // 2) monthly (kode bulanan)
  const m = reserveMonthly(db, finalAmount, deviceKey, reserveTtlMs, code);
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

        // commit per-device-month ONLY kalau perDeviceMonth ON dan device bukan whitelist unlimited
        const unlimited = isUnlimitedDevice(db, r.deviceKey);
        if (v.perDeviceMonth && !unlimited) v.usedByDevice[r.deviceKey] = r.month;

        if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      }
    }
  }
}

// ===== ADMIN ops =====
function upsertVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    code,
    name: body.name ? String(body.name) : prev.name || code,
    enabled: body.enabled != null ? !!body.enabled : prev.enabled !== false,

    // ✅ ini switch “Limit 1x/bulan/device”
    perDeviceMonth: body.perDeviceMonth != null ? !!body.perDeviceMonth : prev.perDeviceMonth !== false,

    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : prev.expiresAt || null,

    uses: Number(prev.uses || 0),
    maxUses: body.maxUses != null ? Number(body.maxUses) : prev.maxUses ?? null,

    note: body.note ? String(body.note) : prev.note || null,
    updatedAt: new Date().toISOString(),

    usedByDevice: prev.usedByDevice || {},
    reserved: prev.reserved || {},
  };
  return db.vouchers[code];
}

function deleteVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers?.[code]) throw new Error("voucher not found");
  delete db.vouchers[code];
  return true;
}

function setMonthly(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase();
  if (body.name != null) p.name = String(body.name || "");

  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  if (body.resetUsage) {
    p.used = {};
    p.reserved = {};
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

function setSystem(db, body) {
  ensure(db);
  if (body.unlimitedEnabled != null) db.system.unlimitedEnabled = !!body.unlimitedEnabled;
  db.system.updatedAt = new Date().toISOString();
  return db.system;
}

// ===== MAIN HANDLER =====
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
      actions: [
        "ping",
        "discount.apply",
        "discount.commit",
        "discount.release",
        "voucher.upsert (ADMIN)",
        "voucher.delete (ADMIN)",
        "voucher.list (ADMIN)",
        "voucher.get (ADMIN)",
        "monthly.get (ADMIN)",
        "monthly.set (ADMIN)",
        "system.get (ADMIN)",
        "system.set (ADMIN)",
      ],
      admin: { header: "X-Admin-Key" },
      system: {
        unlimitedEnabled: db.system.unlimitedEnabled,
        unlimitedKeysCount: Object.keys(db.system.unlimitedKeys || {}).length,
      },
    });
  }

  if (action === "ping") {
    return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });
  }

  try {
    // ===== discount tools =====
    if (action === "discount.apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || "";
      const code = body.voucher || body.code || "";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      const r = applyDiscount({
        db,
        amount,
        deviceId,
        code,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      await writeDB(db);
      return send(res, 200, { success: true, data: r });
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

    // ===== ADMIN required =====
    const isAdminAction =
      action.startsWith("voucher.") || action.startsWith("monthly.") || action.startsWith("system.");
    if (isAdminAction && !isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

    // ===== voucher.* =====
    if (action === "voucher.upsert") {
      const out = upsertVoucher(db, body || {});
      await writeDB(db);
      return send(res, 200, { success: true, data: out });
    }

    if (action === "voucher.delete") {
      const ok = deleteVoucher(db, body || {});
      await writeDB(db);
      return send(res, 200, { success: true, data: { deleted: ok } });
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

    // ===== monthly.* =====
    if (action === "monthly.get") {
      cleanupExpiredReservations(db);
      return send(res, 200, { success: true, data: db.promo.monthly });
    }

    if (action === "monthly.set") {
      const out = setMonthly(db, body || {});
      await writeDB(db);
      return send(res, 200, { success: true, data: out });
    }

    // ===== system.* (GLOBAL unlimited toggle) =====
    if (action === "system.get") {
      return send(res, 200, {
        success: true,
        data: {
          unlimitedEnabled: db.system.unlimitedEnabled,
          unlimitedKeysCount: Object.keys(db.system.unlimitedKeys || {}).length,
          // list boleh ditampilin read-only biar tau ada isinya
          unlimitedKeys: Object.keys(db.system.unlimitedKeys || {}).sort(),
          updatedAt: db.system.updatedAt || null,
        },
      });
    }

    if (action === "system.set") {
      const out = setSystem(db, body || {});
      await writeDB(db);
      return send(res, 200, { success: true, data: out });
    }

    // ===== paidhook (optional) =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });
      return send(res, 200, { success: true, data: { received: true } });
    }

    return send(res, 404, { success: false, error: "Unknown action" });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};
