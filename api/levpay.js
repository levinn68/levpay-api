// api/levpay.js  (Vercel 1-file)
// Endpoints:
// - /api/discount?action=apply|commit|release
// - /api/paidhook
// - /api/tx?action=list|get|clear
// - /api/voucher?action=upsert|disable|list|get   (ADMIN)
// - /api/monthly?action=get|set                   (ADMIN)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join("/tmp", "levpay-db.json");

// ===== ENV (Vercel) =====
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "LEVIN6824";
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "PEPPER_LEVPAY";

// ===== deviceKey unlimited (bypass promo monthly limit) =====
// MASUKIN DEVICEKEY SHA256 DI SINI kalau mau hardcode:
const UNLIMITED_DEVICE_KEYS = new Set([
  // contoh:
  // "58b370dda7d9575e05bcaa5ce4a0c63725185b492fd39e4ba0b372ef86e9488e",
]);

// ===== utils =====
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isAdmin(req) {
  const k = String(req.headers["x-admin-key"] || "").trim();
  return !!(k && k === ADMIN_KEY);
}

function verifyCallback(req) {
  // kalau CALLBACK_SECRET kosong => skip verif
  if (!CALLBACK_SECRET) return true;
  const s = String(req.headers["x-callback-secret"] || "").trim();
  return !!(s && s === CALLBACK_SECRET);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => resolve(raw));
  });
}

async function readJson(req) {
  try {
    const raw = await readBody(req);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
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

function getDeviceKey(deviceId, pepper) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(pepper || ""))
    .digest("hex");
}

// ===== DB =====
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf8");
      const j = raw ? JSON.parse(raw) : {};
      return ensureDb(j);
    }
  } catch {}
  return ensureDb({});
}

function saveDb(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db), "utf8");
  } catch {}
}

function ensureDb(db) {
  db.vouchers = db.vouchers || {}; // custom voucher codes
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
      used: {},
      reserved: {},
      unlimited: {},
      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};

  // seed unlimited keys (hardcode)
  for (const k of UNLIMITED_DEVICE_KEYS) db.promo.monthly.unlimited[k] = true;

  return db;
}

function cleanupExpiredReservations(db) {
  ensureDb(db);
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

// ===== reserve / commit / release =====
function reserveMonthlyPromo(db, amount, deviceKey, ttlMs) {
  ensureDb(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

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
      info: { type: "monthly", name: p.name || "PROMO BULANAN", percent, maxRp },
      reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
    };
  }

  return { ok: false, discountRp: 0 };
}

function reserveVoucher(db, amount, voucherCode, ttlMs) {
  ensureDb(db);
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

// ✅ PROMO MONTHLY TIDAK AUTO: harus applyMonthly=true
function applyDiscount({ db, amount, deviceKey, voucherCode, applyMonthly = false, reserveTtlMs = 6 * 60 * 1000 }) {
  ensureDb(db);

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

  // monthly ONLY kalau diminta
  if (applyMonthly) {
    const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs);
    if (m.ok) {
      finalAmount = Math.max(1, finalAmount - m.discountRp);
      discountRp += m.discountRp;
      applied.push(m.info);
      reservations.push(m.reservation);
    }
  }

  return { finalAmount, discountRp, applied, reservations };
}

function releaseReservations(db, reservations) {
  ensureDb(db);
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
  ensureDb(db);
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

// ===== ADMIN: voucher & monthly =====
function adminUpsertVoucher(db, body) {
  ensureDb(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    code,
    name: body.name ? String(body.name) : (prev.name || code),
    enabled: body.enabled !== false,
    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : null,
    uses: Number(prev.uses || 0),
    maxUses: body.maxUses != null ? Number(body.maxUses) : (prev.maxUses ?? null),
    note: body.note ? String(body.note) : (prev.note || null),
    updatedAt: nowIso(),
    reserved: prev.reserved || undefined,
  };
  return db.vouchers[code];
}

function adminDisableVoucher(db, body) {
  ensureDb(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers[code]) throw new Error("voucher not found");
  db.vouchers[code].enabled = false;
  db.vouchers[code].updatedAt = nowIso();
  return db.vouchers[code];
}

function adminSetMonthlyPromo(db, body) {
  ensureDb(db);
  const p = db.promo.monthly;
  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.name != null) p.name = String(body.name);
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  if (body.addUnlimitedDeviceKey != null) {
    const k = String(body.addUnlimitedDeviceKey).trim();
    if (k) p.unlimited[k] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const k = String(body.removeUnlimitedDeviceKey).trim();
    if (k && p.unlimited) delete p.unlimited[k];
  }

  p.updatedAt = nowIso();
  return p;
}

// ===== handler =====
module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const action = String(url.searchParams.get("action") || "").trim().toLowerCase();

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Callback-Secret");
    if (req.method === "OPTIONS") return res.end("");

    const db = loadDb();

    // ===== /api/discount =====
    if (pathname === "/api/discount") {
      if (!verifyCallback(req)) return send(res, 401, { success: false, error: "Bad callback secret" });

      if (action === "apply") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);

        const amount = Number(body.amount || 0);
        const deviceId = String(body.deviceId || "").trim();
        const voucherCode = String(body.voucher || body.voucherCode || "").trim();
        const applyMonthly = !!(body.applyMonthly || body.promoMonthly || body.monthly || body.apply_monthly);

        if (!Number.isFinite(amount) || amount < 1) {
          return send(res, 400, { success: false, error: "amount invalid" });
        }

        const deviceKey = getDeviceKey(deviceId, DEVICE_PEPPER);
        const out = applyDiscount({
          db,
          amount,
          deviceKey,
          voucherCode,
          applyMonthly,
          reserveTtlMs: 6 * 60 * 1000,
        });

        saveDb(db);
        return send(res, 200, {
          success: true,
          data: {
            amountOriginal: amount,
            finalAmount: out.finalAmount,
            discountRp: out.discountRp,
            applied: out.applied,
            reservations: out.reservations,
            deviceKey,
            applyMonthly,
          },
        });
      }

      if (action === "commit") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);
        commitReservations(db, body.reservations || []);
        saveDb(db);
        return send(res, 200, { success: true, ok: true });
      }

      if (action === "release") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);
        releaseReservations(db, body.reservations || []);
        saveDb(db);
        return send(res, 200, { success: true, ok: true });
      }

      return send(res, 404, { success: false, error: "Unknown action" });
    }

    // ===== /api/paidhook =====
    if (pathname === "/api/paidhook") {
      if (!verifyCallback(req)) return send(res, 401, { success: false, error: "Bad callback secret" });
      if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });

      const body = await readJson(req);
      const idTransaksi = String(body.idTransaksi || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "idTransaksi required" });

      db.tx[idTransaksi] = {
        ...db.tx[idTransaksi],
        ...body,
        updatedAt: nowIso(),
      };

      // optional safety: kalau payload bawa reservations, auto commit/release
      const status = String(body.status || "").toLowerCase();
      const reservations = body.reservations || [];
      if (Array.isArray(reservations) && reservations.length) {
        if (status === "paid") commitReservations(db, reservations);
        if (status === "expired" || status === "cancelled" || status === "failed") releaseReservations(db, reservations);
      }

      saveDb(db);
      return send(res, 200, { success: true, ok: true });
    }

    // ===== /api/tx =====
    if (pathname === "/api/tx") {
      if (!verifyCallback(req)) return send(res, 401, { success: false, error: "Bad callback secret" });

      if (action === "get") {
        const idTransaksi = String(url.searchParams.get("idTransaksi") || "").trim();
        const data = db.tx && db.tx[idTransaksi] ? db.tx[idTransaksi] : null;
        return send(res, 200, { success: true, data });
      }

      if (action === "clear") {
        if (!isAdmin(req)) return send(res, 401, { success: false, error: "Admin key required" });
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        db.tx = {};
        saveDb(db);
        return send(res, 200, { success: true, ok: true });
      }

      // default: list
      const deviceId = String(url.searchParams.get("deviceId") || "").trim();
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));

      let arr = Object.entries(db.tx || {}).map(([id, v]) => ({ idTransaksi: id, ...v }));
      if (deviceId) arr = arr.filter((x) => String(x.deviceId || "") === deviceId);

      arr.sort((a, b) => Date.parse(b.updatedAt || b.paidAt || 0) - Date.parse(a.updatedAt || a.paidAt || 0));
      arr = arr.slice(0, limit);

      return send(res, 200, { success: true, data: arr });
    }

    // ===== /api/voucher (ADMIN) =====
    if (pathname === "/api/voucher") {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "Admin key required" });

      if (action === "list" || !action) {
        const list = Object.values(db.vouchers || {}).map((v) => ({
          code: v.code,
          name: v.name,
          enabled: v.enabled !== false,
          percent: v.percent,
          maxRp: v.maxRp,
          expiresAt: v.expiresAt || null,
          uses: Number(v.uses || 0),
          maxUses: v.maxUses ?? null,
          updatedAt: v.updatedAt || null,
        }));
        list.sort((a, b) => (a.code > b.code ? 1 : -1));
        return send(res, 200, { success: true, data: list });
      }

      if (action === "get") {
        const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
        const v = db.vouchers[code] || null;
        return send(res, 200, { success: true, data: v });
      }

      if (action === "upsert") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);
        const v = adminUpsertVoucher(db, body);
        saveDb(db);
        return send(res, 200, { success: true, data: v });
      }

      if (action === "disable") {
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);
        const v = adminDisableVoucher(db, body);
        saveDb(db);
        return send(res, 200, { success: true, data: v });
      }

      return send(res, 404, { success: false, error: "Unknown action" });
    }

    // ===== /api/monthly (ADMIN) =====
    if (pathname === "/api/monthly") {
      if (action === "get" || !action) {
        // public read boleh (kalau mau admin-only, tinggal kunci di sini)
        const p = db.promo.monthly;
        return send(res, 200, {
          success: true,
          data: {
            enabled: !!p.enabled,
            name: p.name,
            percent: p.percent,
            maxRp: p.maxRp,
            updatedAt: p.updatedAt || null,
            unlimitedCount: Object.keys(p.unlimited || {}).length,
            reservedCount: Object.keys(p.reserved || {}).length,
            usedCount: Object.keys(p.used || {}).length,
          },
        });
      }

      if (action === "set") {
        if (!isAdmin(req)) return send(res, 401, { success: false, error: "Admin key required" });
        if (req.method !== "POST") return send(res, 405, { success: false, error: "Method Not Allowed" });
        const body = await readJson(req);
        const p = adminSetMonthlyPromo(db, body);
        saveDb(db);
        return send(res, 200, { success: true, data: p });
      }

      return send(res, 404, { success: false, error: "Unknown action" });
    }

    // root/help
    if (pathname === "/" || pathname === "/help") {
      return send(res, 200, {
        success: true,
        service: "levpay-vercel-single",
        time: nowIso(),
        routes: [
          "POST /api/discount?action=apply (X-Callback-Secret) body:{amount,deviceId,voucher?,applyMonthly?}",
          "POST /api/discount?action=commit (X-Callback-Secret) body:{reservations:[]}",
          "POST /api/discount?action=release (X-Callback-Secret) body:{reservations:[]}",
          "POST /api/paidhook (X-Callback-Secret) body:{idTransaksi,status,deviceId,...,reservations?}",
          "GET  /api/tx?action=list&deviceId=...&limit=50 (X-Callback-Secret)",
          "GET  /api/tx?action=get&idTransaksi=... (X-Callback-Secret)",
          "POST /api/tx?action=clear (X-Admin-Key + X-Callback-Secret)",
          "GET  /api/voucher?action=list (X-Admin-Key)",
          "POST /api/voucher?action=upsert (X-Admin-Key)",
          "POST /api/voucher?action=disable (X-Admin-Key)",
          "GET  /api/monthly?action=get",
          "POST /api/monthly?action=set (X-Admin-Key)",
        ],
      });
    }

    return send(res, 404, { success: false, error: "Not found" });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};