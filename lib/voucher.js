// lib/voucher.js — FINAL
// - Unlimited device list DISIMPAN di DB: db.promo.unlimitedDevices
// - Admin bisa toggle pakai deviceId (tanpa sha/pepper di UI)
// - Voucher: 1x per device (default) kecuali device unlimited
// - Monthly: 1x per device per bulan kecuali device unlimited

const crypto = require("crypto");

const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "";

// ====== utils ======
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
function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
function getDeviceKey(deviceId) {
  return sha256Hex(`${String(deviceId || "")}|${String(DEVICE_PEPPER || "")}`);
}
function isHex64(s) {
  return /^[a-f0-9]{64}$/i.test(String(s || "").trim());
}

// ====== DB ensure ======
function ensureDb(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // global unlimited devices (berlaku voucher + monthly)
  db.promo.unlimitedDevices = db.promo.unlimitedDevices || {};

  // monthly promo config
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
      code: "", // wajib input code (kalau lu mau)
      used: {},
      reserved: {},
      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};

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

    // optional: cleanup reservedByDevice
    if (v.reservedByDevice) {
      for (const [dk, obj] of Object.entries(v.reservedByDevice)) {
        for (const [t, expAt] of Object.entries(obj || {})) {
          const exp = Date.parse(expAt || "");
          if (Number.isFinite(exp) && now > exp) delete obj[t];
        }
        if (Object.keys(obj || {}).length === 0) delete v.reservedByDevice[dk];
      }
      if (Object.keys(v.reservedByDevice || {}).length === 0) delete v.reservedByDevice;
    }
  }
}

// ====== Unlimited device (DB) ======
function isUnlimitedDeviceKey(db, deviceKey) {
  ensureDb(db);
  const k = String(deviceKey || "").trim().toLowerCase();
  if (!k || !isHex64(k)) return false;
  return !!db.promo.unlimitedDevices[k];
}
function isUnlimitedDeviceById(db, deviceId) {
  const dk = getDeviceKey(deviceId);
  return isUnlimitedDeviceKey(db, dk);
}
function adminSetUnlimitedDeviceById(db, { deviceId, enabled }) {
  ensureDb(db);
  const dk = getDeviceKey(deviceId).toLowerCase();
  if (enabled) db.promo.unlimitedDevices[dk] = true;
  else delete db.promo.unlimitedDevices[dk];

  db.promo.updatedAt = new Date().toISOString();
  return { deviceId, enabled: !!enabled };
}

// ====== Discount engine ======
function reserveMonthlyPromo(db, amount, deviceKey, ttlMs, voucherCodeMaybe) {
  ensureDb(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  // monthly pake kode (kalau lu isi code)
  const want = String(p.code || "").trim().toUpperCase();
  const got = String(voucherCodeMaybe || "").trim().toUpperCase();
  if (want && got !== want) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const unlimited = isUnlimitedDeviceKey(db, deviceKey);

  const lastUsed = p.used[deviceKey] || "";
  if (!unlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

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
        code: want || null,
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

function reserveVoucher(db, amount, voucherCode, ttlMs, deviceKey) {
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

  const unlimited = isUnlimitedDeviceKey(db, deviceKey);

  // default: voucher 1x per device (kecuali unlimited)
  if (!unlimited && deviceKey) {
    v.usedByDevice = v.usedByDevice || {};
    if (v.usedByDevice[deviceKey]) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(Number(v.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;
  if (discountRp <= 0) return { ok: false, discountRp: 0 };

  // global maxUses (kecuali unlimited -> ga ngurangin kuota)
  v.reserved = v.reserved || {};
  const reservedCount = Object.keys(v.reserved).length;

  if (!unlimited && v.maxUses != null) {
    const used = Number(v.uses || 0);
    if (used + reservedCount >= Number(v.maxUses)) return { ok: false, discountRp: 0 };
  }

  const t = token();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  v.reserved[t] = expiresAt;

  // per-device reservation (buat aman kalau user spam apply)
  if (!unlimited && deviceKey) {
    v.reservedByDevice = v.reservedByDevice || {};
    v.reservedByDevice[deviceKey] = v.reservedByDevice[deviceKey] || {};
    v.reservedByDevice[deviceKey][t] = expiresAt;
  }

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
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp, deviceKey, unlimited },
  };
}

function applyDiscount(db, { amount, deviceId, voucherCode, ttlMs = 6 * 60 * 1000 }) {
  ensureDb(db);

  const deviceKey = getDeviceKey(deviceId || "").toLowerCase();
  let amountFinal = Number(amount || 0);
  let discountRp = 0;

  const applied = [];
  const reservations = [];

  // voucher dulu
  const v = reserveVoucher(db, amountFinal, voucherCode, ttlMs, deviceKey);
  if (v.ok) {
    amountFinal = Math.max(1, amountFinal - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
    reservations.push(v.reservation);
  }

  // monthly setelah voucher
  const m = reserveMonthlyPromo(db, amountFinal, deviceKey, ttlMs, voucherCode);
  if (m.ok) {
    amountFinal = Math.max(1, amountFinal - m.discountRp);
    discountRp += m.discountRp;
    applied.push(m.info);
    reservations.push(m.reservation);
  }

  return {
    amountOriginal: Number(amount || 0),
    amountFinal,
    discountRp,
    applied,
    reservations,
    deviceKey,
  };
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
      if (v?.reservedByDevice?.[r.deviceKey]?.[r.token]) delete v.reservedByDevice[r.deviceKey][r.token];

      if (v?.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      if (v?.reservedByDevice?.[r.deviceKey] && Object.keys(v.reservedByDevice[r.deviceKey]).length === 0) {
        delete v.reservedByDevice[r.deviceKey];
      }
      if (v?.reservedByDevice && Object.keys(v.reservedByDevice).length === 0) delete v.reservedByDevice;
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
      if (!v) continue;

      const unlimited = !!r.unlimited || isUnlimitedDeviceKey(db, r.deviceKey);

      if (v?.reserved?.[r.token]) {
        delete v.reserved[r.token];
        if (v.reserved && Object.keys(v.reserved).length === 0) delete v.reserved;
      }
      if (v?.reservedByDevice?.[r.deviceKey]?.[r.token]) {
        delete v.reservedByDevice[r.deviceKey][r.token];
      }

      // kalau unlimited -> jangan nambah uses & jangan kunci per-device
      if (!unlimited) {
        v.uses = Number(v.uses || 0) + 1;
        v.usedByDevice = v.usedByDevice || {};
        if (r.deviceKey) v.usedByDevice[r.deviceKey] = true;
      }

      if (v?.reservedByDevice?.[r.deviceKey] && Object.keys(v.reservedByDevice[r.deviceKey]).length === 0) {
        delete v.reservedByDevice[r.deviceKey];
      }
      if (v?.reservedByDevice && Object.keys(v.reservedByDevice).length === 0) delete v.reservedByDevice;
    }
  }
}

// ====== ADMIN ops ======
function adminUpsertVoucher(db, body) {
  ensureDb(db);
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
    reservedByDevice: prev.reservedByDevice || undefined,
    usedByDevice: prev.usedByDevice || undefined,
  };
  return db.vouchers[code];
}

function adminDisableVoucher(db, body) {
  ensureDb(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers[code]) throw new Error("voucher not found");

  if (body.enabled != null) db.vouchers[code].enabled = !!body.enabled;
  else db.vouchers[code].enabled = false;

  db.vouchers[code].updatedAt = new Date().toISOString();
  return db.vouchers[code];
}

function adminDeleteVoucher(db, body) {
  ensureDb(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");
  if (!db.vouchers[code]) throw new Error("voucher not found");
  delete db.vouchers[code];
  return { deleted: true, code };
}

function adminSetMonthlyPromo(db, body) {
  ensureDb(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.name != null) p.name = String(body.name);

  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  // monthly code
  if (body.code != null) p.code = String(body.code || "").trim().toUpperCase();

  p.updatedAt = new Date().toISOString();
  return p;
}

module.exports = {
  ensureDb,
  cleanupExpiredReservations,
  applyDiscount,
  releaseReservations,
  commitReservations,

  // unlimited device
  isUnlimitedDeviceById,
  adminSetUnlimitedDeviceById,

  // admin voucher/monthly
  adminUpsertVoucher,
  adminDisableVoucher,
  adminDeleteVoucher,
  adminSetMonthlyPromo,
};