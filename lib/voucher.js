// lib/voucher.js
// Diskon & kuota untuk:
// - Voucher custom: 1× per device (seumur hidup) + limit global (maxUses) + expiry opsional
// - Promo bulanan: 1× per device per bulan + limit global per bulan (maxUses) + kode wajib
//
// Mekanik anti-penyalahgunaan:
// - Saat create QR: reserve dulu kuota (token TTL).
// - Saat PAID: commit reservation => kuota kepakai.
// - Saat CANCEL/EXPIRED/FAILED: release => kuota balik.
//
// deviceKey = sha256(deviceId + "|" + pepper)
//
// Update penting:
// - default pepper di-hardcode (kalau ENV DEVICE_PEPPER ga kebaca)
// - admin monthly addUnlimitedDeviceKey / removeUnlimitedDeviceKey bisa terima:
//   a) deviceKey sha256 64 hex, atau
//   b) deviceId biasa (auto di-hash jadi deviceKey)

const crypto = require("crypto");

// ✅ kalau ENV ga kebaca, pake default ini (dari kamu)
const DEFAULT_DEVICE_PEPPER =
  process.env.DEVICE_PEPPER ||
  "3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805";

const UNLIMITED_DEVICE_KEYS = String(process.env.UNLIMITED_DEVICE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function clamp(n, a, b) {
  n = Number(n);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function token() {
  return crypto.randomBytes(16).toString("hex");
}

function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      // kode promo bulanan (wajib)
      code: "",

      // limit global per bulan (null = unlimited)
      maxUses: null,

      // 1× per device per bulan
      used: {},

      // reserve per device (anti spam sebelum paid/cancel)
      reserved: {},

      // counter global per bulan
      usedCount: {},

      // bypass limit (deviceKey => true)
      unlimited: {},

      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.usedCount = db.promo.monthly.usedCount || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};

  // ambil dari ENV juga (kalau ada)
  for (const k of UNLIMITED_DEVICE_KEYS) {
    const kk = String(k).trim();
    if (kk) db.promo.monthly.unlimited[kk] = true;
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

    for (const [t, entry] of Object.entries(v.reserved)) {
      const expAt = typeof entry === "string" ? entry : entry?.expiresAt;
      const exp = Date.parse(expAt || "");
      if (Number.isFinite(exp) && now > exp) delete v.reserved[t];
    }
    if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
  }
}

// deviceKey = sha256(deviceId + "|" + pepper)
function getDeviceKey(deviceId, pepper = DEFAULT_DEVICE_PEPPER) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(pepper || ""))
    .digest("hex");
}

// helper: kalau input 64 hex => dianggap deviceKey
// selain itu => dianggap deviceId lalu di-hash jadi deviceKey
function normalizeUnlimitedInputToDeviceKey(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const maybeHex = raw.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(maybeHex)) return maybeHex; // deviceKey

  // treat as deviceId
  return getDeviceKey(raw);
}

function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, enteredCode) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // KODE WAJIB
  const want = String(p.code || "").trim().toUpperCase().replace(/\s+/g, "");
  const got = String(enteredCode || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!want || !got || got !== want) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  // 1× per device per month
  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // already reserved this month
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // global maxUses per month (used + reserved)
  if (!isUnlimited && p.maxUses != null) {
    const maxUses = Number(p.maxUses);
    if (Number.isFinite(maxUses) && maxUses > 0) {
      const usedCount = Number(p.usedCount?.[cur] || 0);
      let reservedCount = 0;
      for (const r of Object.values(p.reserved || {})) {
        if (r?.month === cur) reservedCount++;
      }
      if (usedCount + reservedCount >= maxUses) return { ok: false, discountRp: 0 };
    }
  }

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

function reserveVoucher(db, amount, voucherCode, ttlMs, deviceKey) {
  ensure(db);
  cleanupExpiredReservations(db);

  if (!voucherCode) return { ok: false, discountRp: 0 };

  const code = String(voucherCode).trim().toUpperCase().replace(/\s+/g, "");
  const v = db.vouchers[code];
  if (!v || v.enabled === false) return { ok: false, discountRp: 0 };

  if (v.expiresAt) {
    const exp = Date.parse(v.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, discountRp: 0 };
  }

  // 1× per device (lifetime)
  v.usedByDevice = v.usedByDevice || {};
  if (deviceKey && v.usedByDevice[deviceKey]) return { ok: false, discountRp: 0 };

  // device lagi reserve voucher ini -> jangan kasih lagi
  if (deviceKey && v.reserved) {
    for (const entry of Object.values(v.reserved)) {
      const dk = typeof entry === "object" ? entry.deviceKey : null;
      if (dk && dk === deviceKey) return { ok: false, discountRp: 0 };
    }
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
    const maxUses = Number(v.maxUses);
    if (Number.isFinite(maxUses) && maxUses > 0) {
      if (used + reservedCount >= maxUses) return { ok: false, discountRp: 0 };
    }
  }

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  v.reserved[t] = { expiresAt, deviceKey: deviceKey || null };

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
      maxUses: v.maxUses ?? null,
    },
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp, deviceKey: deviceKey || null },
  };
}

// Core: 1 input code => voucher OR monthly
function applyDiscount(db, opts) {
  ensure(db);

  const { amount, deviceKey, voucherCode, reserveTtlMs = 6 * 60 * 1000 } = opts || {};
  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  const code = String(voucherCode || "").trim();
  if (!code) {
    // kosong => no discount
    return { finalAmount, discountRp, applied, reservations };
  }

  // 1) coba voucher dulu
  const v = reserveVoucher(db, finalAmount, code, reserveTtlMs, deviceKey);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
    return { finalAmount, discountRp, applied, reservations };
  }

  // 2) kalau bukan voucher / gak eligible, coba monthly (kode wajib match)
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs, code);
  if (m.ok) {
    finalAmount = Math.max(1, finalAmount - m.discountRp);
    discountRp += m.discountRp;
    applied.push(m.info);
    reservations.push(m.reservation);
  }

  return { finalAmount, discountRp, applied, reservations };
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

        db.promo.monthly.usedCount = db.promo.monthly.usedCount || {};
        db.promo.monthly.usedCount[r.month] = Number(db.promo.monthly.usedCount[r.month] || 0) + 1;

        delete db.promo.monthly.reserved[r.deviceKey];
      }
    }

    if (r.type === "voucher") {
      const v = db.vouchers?.[r.code];
      if (v?.reserved?.[r.token]) {
        delete v.reserved[r.token];
        v.uses = Number(v.uses || 0) + 1;

        v.usedByDevice = v.usedByDevice || {};
        if (r.deviceKey) v.usedByDevice[r.deviceKey] = true;

        if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      }
    }
  }
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

// ===== Admin helpers =====

function adminUpsertVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) throw new Error("code required");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    code,
    name: body.name ? String(body.name) : prev.name || code,
    enabled: body.enabled !== false,
    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : null,

    uses: Number(prev.uses || 0),
    maxUses: body.maxUses != null ? Number(body.maxUses) : prev.maxUses ?? null,

    // per-device lifetime usage
    usedByDevice: prev.usedByDevice || {},

    note: body.note ? String(body.note) : prev.note || null,
    updatedAt: new Date().toISOString(),

    reserved: prev.reserved || undefined,
  };
  return db.vouchers[code];
}

function adminDisableVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) throw new Error("code required");
  const prev = db.vouchers[code];
  if (!prev) throw new Error("voucher not found");
  prev.enabled = false;
  prev.updatedAt = new Date().toISOString();
  return prev;
}

function adminSetMonthlyPromo(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.name != null) p.name = String(body.name);
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  // kode promo bulanan (wajib)
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase().replace(/\s+/g, "");

  // global maxUses per month (null = unlimited)
  if (body.maxUses !== undefined) {
    if (body.maxUses == null || body.maxUses === "") p.maxUses = null;
    else {
      const n = Number(body.maxUses);
      p.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  // ✅ sekarang bisa input deviceId biasa ATAU deviceKey 64hex
  if (body.addUnlimitedDeviceKey != null) {
    const dk = normalizeUnlimitedInputToDeviceKey(body.addUnlimitedDeviceKey);
    if (dk) p.unlimited[dk] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const dk = normalizeUnlimitedInputToDeviceKey(body.removeUnlimitedDeviceKey);
    if (dk && p.unlimited) delete p.unlimited[dk];
  }

  p.updatedAt = new Date().toISOString();
  return p;
}

module.exports = {
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
};
