// api/levpay.js (Vercel SINGLE-FILE ROUTER) — FINAL
// ============================================================================
// GH ENV (WAJIB pakai GH_*):
// - GH_TOKEN   : GitHub PAT (repo scope untuk private / contents:write)
// - GH_OWNER   : owner/org
// - GH_REPO    : repo name
// - GH_BRANCH  : default "main"
// - GH_DB_PATH : default "db/levpay-db.json"
// Optional:
// - GH_API_BASE: default "https://api.github.com" (kalau enterprise, isi base API)
//
// ENV lainnya:
// - ADMIN_KEY       : admin key buat akses admin page + endpoint admin
// - CALLBACK_SECRET : optional secret buat paidhook (boleh kosong)
// - DEVICE_PEPPER   : pepper buat deviceKey (JANGAN ditaruh di client)
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim() || "LEVIN6824";
const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim();

// Pepper wajibnya di ENV (tapi fallback biar ga crash)
const DEVICE_PEPPER =
  String(process.env.DEVICE_PEPPER || "").trim() ||
  "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4";

// ====== GH CONFIG (WAJIB pakai GH_) ======
const GH_API_BASE = String(process.env.GH_API_BASE || "https://api.github.com").trim();
const GH_TOKEN = String(process.env.GH_TOKEN || "").trim();
const GH_OWNER = String(process.env.GH_OWNER || "").trim();
const GH_REPO = String(process.env.GH_REPO || "").trim();
const GH_BRANCH = String(process.env.GH_BRANCH || "main").trim();
const GH_DB_PATH = String(process.env.GH_DB_PATH || "db/levpay-db.json").trim();

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
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
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
    `${GH_API_BASE}/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}` +
    `/contents/${GH_DB_PATH}?ref=${encodeURIComponent(GH_BRANCH)}`;

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
  const url =
    `${GH_API_BASE}/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}` +
    `/contents/${GH_DB_PATH}`;

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

// ====== DB read/write ======
async function readDB() {
  if (ghConfigured()) {
    try {
      const f = await ghGetFile();
      if (!f.exists) return {};
      const raw = f.content || "";
      return raw ? JSON.parse(raw) : {};
    } catch {
      // fallback ke /tmp
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

// ====== DB init / ensure ======
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // PROMO BULANAN — CODE-BASED (TIDAK AUTO)
  // - enabled, code, name, percent, maxRp
  // - maxUses: limit global per bulan (opsional, null = unlimited)
  // - usedByDevice: 1x per device per bulan
  // - usageByMonth: counter global per bulan (buat maxUses)
  // - reserved: reservasi sementara biar ga dipake barengan
  // - unlimited: map deviceKey => true/false (OFFLINE = false)
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      code: "", // wajib diisi admin page
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
      maxUses: null,

      usedByDevice: {},
      usageByMonth: {},
      reserved: {},
      unlimited: {},

      updatedAt: null,
    };

  db.promo.monthly.usedByDevice = db.promo.monthly.usedByDevice || {};
  db.promo.monthly.usageByMonth = db.promo.monthly.usageByMonth || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};

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

function normCode(x) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

// ====== Discount engine (reserve/apply/commit/release) ======
function reserveVoucher(db, amount, voucherCode, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const code = normCode(voucherCode);
  if (!code) return { ok: false, discountRp: 0 };

  const v = db.vouchers[code];
  if (!v || v.enabled === false) return { ok: false, discountRp: 0 };

  if (v.expiresAt) {
    const exp = Date.parse(v.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(v.percent || 0, 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  v.reserved = v.reserved || {};
  const reservedCount = Object.keys(v.reserved).length;

  if (v.maxUses != null) {
    const used = Number(v.uses || 0);
    const mx = Number(v.maxUses);
    if (Number.isFinite(mx) && mx > 0 && used + reservedCount >= mx) {
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

function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, voucherCodeMaybe) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // RULE: promo bulanan wajib input CODE (nggak auto)
  const want = normCode(p.code);
  const got = normCode(voucherCodeMaybe);
  if (!want || got !== want) return { ok: false, discountRp: 0 };

  const cur = yyyymm();

  // Unlimited ON/OFF
  const unlimitedState = p.unlimited?.[deviceKey];
  const isUnlimited = unlimitedState === true; // OFFLINE (false) => dianggap normal

  // 1x per device per bulan (kecuali unlimited)
  const lastUsed = String(p.usedByDevice?.[deviceKey] || "");
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // sudah reserved bulan ini -> tahan dulu sampai expire
  const rsv = p.reserved?.[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // maxUses global per bulan (opsional)
  const maxUses = p.maxUses == null ? null : Number(p.maxUses);
  if (maxUses != null && Number.isFinite(maxUses) && maxUses > 0) {
    const used = Number(p.usageByMonth?.[cur] || 0);
    // hitung reserved bulan ini
    const reservedThisMonth = Object.values(p.reserved || {}).filter((x) => x?.month === cur).length;
    if (used + reservedThisMonth >= maxUses) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(p.percent || 0, 0, 100);
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
      code: want,
      name: p.name || "PROMO BULANAN",
      percent,
      maxRp,
      maxUses: p.maxUses ?? null,
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

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  let finalAmount = Number(amount || 0);
  let discountRp = 0;

  const applied = [];
  const reservations = [];

  // 1 input code: prioritas voucher; kalau voucher ga ketemu, baru cek monthly
  const code = normCode(voucherCode);

  const v = reserveVoucher(db, finalAmount, code, reserveTtlMs);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
    return { finalAmount, discountRp, applied, reservations, deviceKey };
  }

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

  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = db.promo.monthly.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) {
        db.promo.monthly.usedByDevice[r.deviceKey] = r.month;
        db.promo.monthly.usageByMonth[r.month] = Number(db.promo.monthly.usageByMonth?.[r.month] || 0) + 1;
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
  const code = normCode(body.code);
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
  const code = normCode(body.code);
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
  if (body.name != null) p.name = String(body.name || "");
  if (body.code != null) p.code = normCode(body.code);
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));
  if (body.maxUses !== undefined) {
    const v = body.maxUses;
    if (v === null || v === "" || v === 0) p.maxUses = null;
    else {
      const n = Number(v);
      p.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  // add by deviceId (lebih aman: pepper ga keluar)
  if (body.addUnlimitedDeviceId != null) {
    const deviceId = String(body.addUnlimitedDeviceId || "").trim();
    if (deviceId) {
      const dk = getDeviceKey(deviceId);
      p.unlimited[dk] = true;
    }
  }

  // set state by deviceKey (toggle Unlimited / Offline)
  if (body.setUnlimitedDeviceKey != null) {
    const dk = String(body.setUnlimitedDeviceKey || "").trim();
    if (dk) {
      const en = body.enabledUnlimited;
      p.unlimited[dk] = en === false ? false : true;
    }
  }

  // remove completely
  if (body.removeUnlimitedDeviceKey != null) {
    const dk = String(body.removeUnlimitedDeviceKey || "").trim();
    if (dk && p.unlimited) delete p.unlimited[dk];
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

// ====== TX ops (simple) ======
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
    admin: { header: "X-Admin-Key" },
    actions: [
      "ping",
      "help",
      "discount.apply",
      "discount.commit",
      "discount.release",
      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",
      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",
      "tools.devicekey (ADMIN)",
      "tx.upsert (ADMIN)",
      "tx.get (ADMIN)",
      "tx.list (ADMIN)",
      "tx.search (ADMIN)",
      "tx.clear (ADMIN)",
      "paidhook",
    ],
    note: "Promo bulanan wajib input kode (monthly.code). Unlimited toggle: monthly.unlimited[deviceKey] true/false.",
  };
}

// ====== MAIN HANDLER ======
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  const body = await readBody(req);
  const db = ensure(await readDB());

  if (!action || action === "help") return send(res, 200, help());
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
      if (!String(deviceId || "").trim()) {
        return send(res, 400, { success: false, error: "deviceId required" });
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

    // ===== ADMIN: VOUCHER =====
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
        const code = normCode(body.code || url.searchParams.get("code") || "");
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v });
      }

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // ===== ADMIN: MONTHLY =====
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

    // ===== ADMIN: TOOLS =====
    if (action.startsWith("tools.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "tools.devicekey") {
        const deviceId = String(body.deviceId || url.searchParams.get("deviceId") || "").trim();
        if (!deviceId) return send(res, 400, { success: false, error: "deviceId required" });
        const deviceKey = getDeviceKey(deviceId);
        return send(res, 200, { success: true, data: { deviceId, deviceKey } });
      }

      return send(res, 400, { success: false, error: "Unknown tools action" });
    }

    // ===== ADMIN: TX =====
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
      hint:
        "use action=discount.apply|discount.commit|discount.release|voucher.*|monthly.*|tools.devicekey|tx.*|paidhook|help|ping",
    });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};