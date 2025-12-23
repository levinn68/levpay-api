// lib/voucher.js
// Voucher + Monthly Promo engine (deviceKey hashed, reservation-based)

const crypto = require("crypto");

// =========================
// DEVICE KEY / PEPPER
// =========================

// DEVICE_PEPPER itu SECRET yang dipakai buat bikin deviceKey:
//   deviceKey = sha256(`${deviceId}|${DEVICE_PEPPER}`)
// Jadi string 64-hex yang kamu kirim (mis. 3cba...) itu BUKAN pepper,
// itu deviceKey hasil hash untuk 1 device tertentu.
//
// ✅ Kalau env Vercel kadang gak kebaca, kita kasih fallback default pepper.
//    Saran: tetap set DEVICE_PEPPER di ENV Vercel biar aman & konsisten.
const DEFAULT_DEVICE_PEPPER =
  "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4";

const DEVICE_PEPPER = String(process.env.DEVICE_PEPPER || DEFAULT_DEVICE_PEPPER).trim();

// Optional bypass (global) deviceKey list dari ENV, dipake buat testing / emergency.
// ✅ Harus Set (karena dipake .has)
const UNLIMITED_DEVICE_KEYS = new Set(
  String(process.env.UNLIMITED_DEVICE_KEYS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function isSha256Hex(s) {
  return /^[a-f0-9]{64}$/i.test(String(s || "").trim());
}

// deviceKey = sha256(`${deviceId}|${DEVICE_PEPPER}`)
// - deviceKey disimpan di DB (bukan deviceId)
// - kalau input udah 64-hex (udah deviceKey), kita pakai apa adanya
function getDeviceKey(deviceId = "") {
  const raw = String(deviceId || "").trim();
  if (!raw) return "";
  if (isSha256Hex(raw)) return raw.toLowerCase();

  const pepper = String(DEVICE_PEPPER || "").trim();
  if (!pepper) {
    // fallback aman: jangan diam-diam beda hash antar env
    throw new Error("DEVICE_PEPPER is empty. Set DEVICE_PEPPER in ENV.");
  }

  return sha256Hex(`${raw}|${pepper}`).toLowerCase();
}

// =========================
// HELPERS
// =========================

function nowIso() {
  return new Date().toISOString();
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function ensureDbShape(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.promo.monthly = db.promo.monthly || {};

  db.promo.monthly.code = normalizeCode(db.promo.monthly.code || "");
  db.promo.monthly.enabled = !!db.promo.monthly.enabled;

  db.promo.monthly.discountType = db.promo.monthly.discountType || "percent"; // percent|flat
  db.promo.monthly.discountValue = Number(db.promo.monthly.discountValue || 0);

  db.promo.monthly.perDeviceLimit = clampInt(db.promo.monthly.perDeviceLimit || 0, 0, 999999);
  db.promo.monthly.used = db.promo.monthly.used || {}; // deviceKey -> count

  db.promo.monthly.unlimited = Array.isArray(db.promo.monthly.unlimited) ? db.promo.monthly.unlimited : [];

  // merge ENV unlimited devices (optional)
  for (const k of UNLIMITED_DEVICE_KEYS) {
    if (k && !db.promo.monthly.unlimited.includes(k)) db.promo.monthly.unlimited.push(k);
  }

  db._reservations = db._reservations || {}; // reservationId -> { type, code, deviceKey, expiresAt, meta }
}

function maskDeviceKey(k) {
  const s = String(k || "");
  if (!s) return "";
  return s.slice(0, 6) + "…" + s.slice(-6);
}

// admin input bisa berupa deviceId ("dev_xxx") atau sudah deviceKey (64 hex)
function normalizeUnlimitedInputToDeviceKey(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (isSha256Hex(raw)) return raw.toLowerCase();
  // treat as deviceId
  return getDeviceKey(raw);
}

function makeReservationId() {
  return "rsv_" + crypto.randomBytes(16).toString("hex");
}

function cleanupExpiredReservations(db) {
  const t = Date.now();
  const r = db._reservations || {};
  for (const [id, it] of Object.entries(r)) {
    const exp = Number(it?.expiresAt || 0);
    if (exp && exp <= t) {
      delete r[id];
    }
  }
}

// =========================
// DISCOUNT CALC
// =========================

function calcDiscount(amount, discountType, discountValue) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { discountRp: 0, finalAmount: amt };

  if (discountType === "flat") {
    const disc = Math.max(0, Math.floor(Number(discountValue || 0)));
    const finalAmount = Math.max(0, amt - disc);
    return { discountRp: Math.max(0, amt - finalAmount), finalAmount };
  }

  // percent
  const pct = Number(discountValue || 0);
  const disc = Math.floor((amt * pct) / 100);
  const finalAmount = Math.max(0, amt - disc);
  return { discountRp: Math.max(0, amt - finalAmount), finalAmount };
}

// =========================
// MONTHLY PROMO RESERVE
// =========================

function reserveMonthlyPromo(db, { amount, deviceKey, voucherCodeNormalized, reserveTtlMs }) {
  const p = db.promo.monthly;

  // must be enabled and must match code
  if (!p.enabled) return { ok: false, reason: "monthly_disabled" };
  if (!p.code) return { ok: false, reason: "monthly_no_code" };
  if (voucherCodeNormalized !== p.code) return { ok: false, reason: "monthly_code_mismatch" };

  const isUnlimited =
    (Array.isArray(p.unlimited) && p.unlimited.includes(deviceKey)) ||
    (deviceKey && UNLIMITED_DEVICE_KEYS.has(deviceKey));

  if (!isUnlimited && p.perDeviceLimit > 0) {
    const used = clampInt(p.used?.[deviceKey] || 0, 0, 999999);
    if (used >= p.perDeviceLimit) return { ok: false, reason: "monthly_limit_reached" };
  }

  const { discountRp, finalAmount } = calcDiscount(amount, p.discountType, p.discountValue);
  if (!discountRp || finalAmount === amount) return { ok: false, reason: "monthly_no_discount" };

  const reservationId = makeReservationId();
  db._reservations[reservationId] = {
    type: "monthly",
    code: p.code,
    deviceKey,
    discountRp,
    finalAmount,
    expiresAt: Date.now() + reserveTtlMs,
    meta: { discountType: p.discountType, discountValue: p.discountValue },
  };

  return {
    ok: true,
    reservationId,
    discountRp,
    finalAmount,
    applied: [{ kind: "monthly", code: p.code, discountRp }],
  };
}

// =========================
// VOUCHER RESERVE
// =========================

function reserveVoucher(db, { amount, deviceKey, voucherCodeNormalized, reserveTtlMs }) {
  const v = db.vouchers[voucherCodeNormalized];
  if (!v || v.disabled) return { ok: false, reason: "voucher_not_found" };

  // optional device restrictions:
  // v.unlimitedDevices: [deviceKey,...] means only these devices get unlimited usage
  // v.allowedDevices: [deviceKey,...] means only these devices can use voucher at all
  const allowedDevices = Array.isArray(v.allowedDevices) ? v.allowedDevices : [];
  const unlimitedDevices = Array.isArray(v.unlimitedDevices) ? v.unlimitedDevices : [];

  if (allowedDevices.length > 0 && !allowedDevices.includes(deviceKey)) {
    return { ok: false, reason: "voucher_device_not_allowed" };
  }

  const isUnlimited = unlimitedDevices.includes(deviceKey) || (deviceKey && UNLIMITED_DEVICE_KEYS.has(deviceKey));

  // usage limit per device (only if not unlimited)
  const perDeviceLimit = clampInt(v.perDeviceLimit || 0, 0, 999999);
  v.used = v.used || {};
  if (!isUnlimited && perDeviceLimit > 0) {
    const used = clampInt(v.used?.[deviceKey] || 0, 0, 999999);
    if (used >= perDeviceLimit) return { ok: false, reason: "voucher_limit_reached" };
  }

  const discountType = v.discountType || "percent";
  const discountValue = Number(v.discountValue || 0);

  const { discountRp, finalAmount } = calcDiscount(amount, discountType, discountValue);
  if (!discountRp || finalAmount === amount) return { ok: false, reason: "voucher_no_discount" };

  const reservationId = makeReservationId();
  db._reservations[reservationId] = {
    type: "voucher",
    code: voucherCodeNormalized,
    deviceKey,
    discountRp,
    finalAmount,
    expiresAt: Date.now() + reserveTtlMs,
    meta: { discountType, discountValue },
  };

  return {
    ok: true,
    reservationId,
    discountRp,
    finalAmount,
    applied: [{ kind: "voucher", code: voucherCodeNormalized, discountRp }],
  };
}

// =========================
// PUBLIC API
// =========================

function applyDiscount(
  db,
  { amount, deviceKey, voucherCode, reserveTtlMs = 6 * 60 * 1000 } = {}
) {
  ensureDbShape(db);
  cleanupExpiredReservations(db);

  const amt = Math.floor(Number(amount || 0));
  if (!Number.isFinite(amt) || amt < 1) {
    return {
      finalAmount: amt,
      discountRp: 0,
      applied: [],
      reservations: [],
      error: "amount_invalid",
    };
  }

  const dk = String(deviceKey || "").trim().toLowerCase();
  const code = normalizeCode(voucherCode);

  // ✅ REQUIRE code: kalau kosong, gak ada diskon
  if (!code) {
    return { finalAmount: amt, discountRp: 0, applied: [], reservations: [] };
  }

  // try voucher first
  const rv = reserveVoucher(db, { amount: amt, deviceKey: dk, voucherCodeNormalized: code, reserveTtlMs });
  if (rv.ok) {
    return {
      finalAmount: rv.finalAmount,
      discountRp: rv.discountRp,
      applied: rv.applied,
      reservations: [rv.reservationId],
    };
  }

  // fallback: monthly promo (also needs matching code)
  const rm = reserveMonthlyPromo(db, { amount: amt, deviceKey: dk, voucherCodeNormalized: code, reserveTtlMs });
  if (rm.ok) {
    return {
      finalAmount: rm.finalAmount,
      discountRp: rm.discountRp,
      applied: rm.applied,
      reservations: [rm.reservationId],
    };
  }

  // no discount
  return { finalAmount: amt, discountRp: 0, applied: [], reservations: [] };
}

function commitReservations(db, reservationIds = []) {
  ensureDbShape(db);
  cleanupExpiredReservations(db);

  for (const id of reservationIds || []) {
    const r = db._reservations?.[id];
    if (!r) continue;

    if (r.type === "monthly") {
      const p = db.promo.monthly;
      const dk = r.deviceKey;
      const isUnlimited =
        (Array.isArray(p.unlimited) && p.unlimited.includes(dk)) ||
        (dk && UNLIMITED_DEVICE_KEYS.has(dk));

      if (!isUnlimited && p.perDeviceLimit > 0) {
        p.used[dk] = clampInt((p.used?.[dk] || 0) + 1, 0, 999999);
      }
    }

    if (r.type === "voucher") {
      const v = db.vouchers[r.code];
      if (v && !v.disabled) {
        v.used = v.used || {};
        const dk = r.deviceKey;

        const unlimitedDevices = Array.isArray(v.unlimitedDevices) ? v.unlimitedDevices : [];
        const isUnlimited = unlimitedDevices.includes(dk) || (dk && UNLIMITED_DEVICE_KEYS.has(dk));

        const perDeviceLimit = clampInt(v.perDeviceLimit || 0, 0, 999999);
        if (!isUnlimited && perDeviceLimit > 0) {
          v.used[dk] = clampInt((v.used?.[dk] || 0) + 1, 0, 999999);
        }
      }
    }

    delete db._reservations[id];
  }
}

function releaseReservations(db, reservationIds = []) {
  ensureDbShape(db);
  for (const id of reservationIds || []) {
    if (db._reservations?.[id]) delete db._reservations[id];
  }
}

// =========================
// ADMIN HELPERS
// =========================

function adminUpsertVoucher(db, payload = {}) {
  ensureDbShape(db);

  const code = normalizeCode(payload.code);
  if (!code) throw new Error("code required");

  const discountType = payload.discountType === "flat" ? "flat" : "percent";
  const discountValue = Number(payload.discountValue || 0);

  const perDeviceLimit = clampInt(payload.perDeviceLimit || 0, 0, 999999);
  const disabled = !!payload.disabled;

  const allowedDevicesIn = Array.isArray(payload.allowedDevices) ? payload.allowedDevices : [];
  const unlimitedDevicesIn = Array.isArray(payload.unlimitedDevices) ? payload.unlimitedDevices : [];

  const allowedDevices = allowedDevicesIn
    .map(normalizeUnlimitedInputToDeviceKey)
    .filter(Boolean);

  const unlimitedDevices = unlimitedDevicesIn
    .map(normalizeUnlimitedInputToDeviceKey)
    .filter(Boolean);

  db.vouchers[code] = {
    ...(db.vouchers[code] || {}),
    code,
    discountType,
    discountValue,
    perDeviceLimit,
    disabled,
    allowedDevices,
    unlimitedDevices,
    updatedAt: nowIso(),
  };

  return {
    ...db.vouchers[code],
    // jangan bocorin semua key ke UI kalau gak perlu
    allowedDevicesMasked: allowedDevices.map(maskDeviceKey),
    unlimitedDevicesMasked: unlimitedDevices.map(maskDeviceKey),
  };
}

function adminDisableVoucher(db, payload = {}) {
  ensureDbShape(db);
  const code = normalizeCode(payload.code);
  if (!code || !db.vouchers[code]) throw new Error("voucher not found");
  db.vouchers[code].disabled = true;
  db.vouchers[code].updatedAt = nowIso();
  return db.vouchers[code];
}

function adminSetMonthlyPromo(db, payload = {}) {
  ensureDbShape(db);

  const enabled = !!payload.enabled;
  const code = normalizeCode(payload.code);

  const discountType = payload.discountType === "flat" ? "flat" : "percent";
  const discountValue = Number(payload.discountValue || 0);

  const perDeviceLimit = clampInt(payload.perDeviceLimit || 0, 0, 999999);

  const unlimitedIn = Array.isArray(payload.unlimited) ? payload.unlimited : [];
  const unlimited = unlimitedIn.map(normalizeUnlimitedInputToDeviceKey).filter(Boolean);

  db.promo.monthly.enabled = enabled;
  db.promo.monthly.code = code;
  db.promo.monthly.discountType = discountType;
  db.promo.monthly.discountValue = discountValue;
  db.promo.monthly.perDeviceLimit = perDeviceLimit;
  db.promo.monthly.unlimited = unlimited;
  db.promo.monthly.updatedAt = nowIso();

  return {
    ...db.promo.monthly,
    unlimitedMasked: unlimited.map(maskDeviceKey),
  };
}

module.exports = {
  // shared
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,

  // admin
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
};