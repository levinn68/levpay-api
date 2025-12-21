// lib/voucher.js
const crypto = require("crypto");

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

function getDeviceKey(deviceId, pepper = process.env.DEVICE_PEPPER || "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4") {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(pepper || ""))
    .digest("hex");
}

// ====== DB init / ensure ======
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

      // ✅ NEW: global max uses per month (null = unlimited)
      maxUses: null,

      // ✅ per-device used tracking
      used: {},

      // ✅ reservation by deviceKey
      reserved: {},

      // ✅ unlimited deviceKey list
      unlimited: {},

      // ✅ NEW: global used counter per month { "202512": 12 }
      usedCount: {},

      updatedAt: null,
    };

  const p = db.promo.monthly;
  p.used = p.used || {};
  p.reserved = p.reserved || {};
  p.unlimited = p.unlimited || {};
  p.usedCount = p.usedCount || {};

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
function reserveMonthlyPromo(db, amount, deviceKey, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  // 1× per device per month
  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // already reserved this month
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // ✅ global maxUses per month (used + reserved)
  if (!isUnlimited && p.maxUses != null) {
    const maxUses = Number(p.maxUses);
    if (Number.isFinite(maxUses) && maxUses > 0) {
      const usedCount = Number(p.usedCount?.[cur] || 0);

      // count current-month reservations
      let reservedCount = 0;
      for (const r of Object.values(p.reserved || {})) {
        if (r?.month === cur) reservedCount++;
      }

      if (usedCount + reservedCount >= maxUses) {
        return { ok: false, discountRp: 0 };
      }
    }
  }

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
      info: { type: "monthly", name: p.name || "PROMO BULANAN", percent, maxRp, maxUses: p.maxUses ?? null },
      reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
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
    info: { type: "voucher", code, name: v.name || code, percent, maxRp, expiresAt: v.expiresAt || null },
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp },
  };
}

function applyDiscount(db, opts) {
  ensure(db);

  const {
    amount,
    deviceKey,
    voucherCode,
    reserveTtlMs = 6 * 60 * 1000,

    // ✅ defaultnya tetep aman buat backward compat
    useVoucher = true,
    useMonthly = false,
    stackWithVoucher = false,
    allowMonthlyWithoutVoucher = true,
  } = opts || {};

  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];
  const reservations = [];

  // voucher first
  let voucherApplied = false;
  if (useVoucher) {
    const v = reserveVoucher(db, finalAmount, voucherCode, reserveTtlMs);
    if (v.ok) {
      finalAmount = Math.max(1, finalAmount - v.discountRp);
      discountRp += v.discountRp;
      applied.push(v.info);
      reservations.push(v.reservation);
      voucherApplied = true;
    }
  }

  // monthly after voucher (if enabled)
  if (useMonthly && (allowMonthlyWithoutVoucher || voucherApplied || stackWithVoucher)) {
    const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs);
    if (m.ok) {
      if (!stackWithVoucher && voucherApplied) {
        // if not stacking: ignore monthly when voucher already applied
      } else {
        finalAmount = Math.max(1, finalAmount - m.discountRp);
        discountRp += m.discountRp;
        applied.push(m.info);
        reservations.push(m.reservation);
      }
    }
  }

  return { finalAmount, discountRp, applied, reservations };
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

        // ✅ increment monthly global usedCount
        const m = String(r.month || yyyymm());
        db.promo.monthly.usedCount[m] = Number(db.promo.monthly.usedCount[m] || 0) + 1;

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
    enabled: body.enabled !== false,
    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : null,
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
  db.vouchers[code].enabled = false;
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

  // ✅ NEW: set global maxUses per month (null/unset = unlimited)
  if (body.maxUses !== undefined) {
    if (body.maxUses == null || body.maxUses === "") p.maxUses = null;
    else {
      const n = Number(body.maxUses);
      p.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

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

module.exports = {
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
};
