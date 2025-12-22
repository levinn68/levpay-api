// lib/voucher.js
// Voucher + Monthly Promo engine with reserve/commit/release.
// - Supports per-device usage limit (default: once per device) for vouchers
// - Supports monthly promo (1x per device per month) with optional unlimited devices
// - Supports global unlimited device keys via env (UNLIMITED_DEVICE_KEYS) or built-in defaults
//
// deviceKey = sha256(deviceId + "|" + pepper)

"use strict";

const crypto = require("crypto");

// ✅ IMPORTANT: deviceId is never stored; we only store deviceKey (hash).
const DEVICE_PEPPER =
  process.env.DEVICE_PEPPER ||
  // keep the old default pepper to avoid breaking existing deviceKey mappings
  "6db5e4f918d72a91a2b3e768f8f3bdfb";

// ✅ Hardcoded unlimited deviceKey(s) as fallback if ENV isn't set.
// User provided deviceKey (sha256): 3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805
const DEFAULT_UNLIMITED_DEVICE_KEYS = [
  "3cba807b27e933940fed9994073973ec2496ab2a2a9c70a1fff11d94b8081805",
];

function parseCsv(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const UNLIMITED_DEVICE_KEYS = new Set([
  ...DEFAULT_UNLIMITED_DEVICE_KEYS,
  ...parseCsv(process.env.UNLIMITED_DEVICE_KEYS),
]);

const DEFAULT_MONTHLY_PROMO = {
  enabled: false,
  // promo monthly requires code input (no auto discount)
  code: "BULANAN",
  percent: 10,
  maxRp: 5000,
  // bookkeeping
  used: {}, // deviceKey -> "YYYY-MM"
  reserved: {}, // token -> { deviceKey, month, expiresAt }
  unlimited: {}, // deviceKey -> true
};

function isoNow() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function ensure(db) {
  if (!db || typeof db !== "object") throw new Error("DB object required");

  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.promo.monthly = db.promo.monthly || JSON.parse(JSON.stringify(DEFAULT_MONTHLY_PROMO));

  // merge global unlimited device keys into monthly promo unlimited map (best-effort)
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};
  for (const k of UNLIMITED_DEVICE_KEYS) {
    if (k && !db.promo.monthly.unlimited[k]) db.promo.monthly.unlimited[k] = true;
  }
}

function getDeviceKey(deviceIdRaw) {
  const deviceId = String(deviceIdRaw || "").trim();
  if (!deviceId) return "";
  return crypto.createHash("sha256").update(`${deviceId}|${DEVICE_PEPPER}`).digest("hex");
}

function isGlobalUnlimited(deviceKey) {
  return !!deviceKey && UNLIMITED_DEVICE_KEYS.has(String(deviceKey));
}

function normalizeCode(codeRaw) {
  return String(codeRaw || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function pickList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).map((x) => x.trim()).filter(Boolean);
  return parseCsv(val);
}

function isUnlimitedForVoucher(v, deviceKey) {
  if (!deviceKey) return false;
  if (isGlobalUnlimited(deviceKey)) return true;

  // accept several legacy shapes
  const list =
    pickList(v?.unlimitedDevices)
      .concat(pickList(v?.unlimitedDeviceKeys))
      .concat(Object.keys(v?.unlimited || {}));

  return list.includes(deviceKey);
}

// ----- Monthly promo reservation -----

function cleanupExpiredReservations(obj) {
  const now = nowMs();
  for (const [token, r] of Object.entries(obj || {})) {
    const exp = Date.parse(r?.expiresAt || "");
    if (!exp || exp <= now) delete obj[token];
  }
}

function reserveMonthlyPromo(db, amount, deviceKey, reserveTtlMs) {
  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, reason: "monthly_disabled" };

  const code = normalizeCode(p.code);
  const percent = Number(p.percent || 0);
  const maxRp = Number(p.maxRp || 0);

  if (!code || percent <= 0 || maxRp <= 0) return { ok: false, reason: "monthly_invalid" };
  if (!deviceKey) return { ok: false, reason: "device_required" };

  cleanupExpiredReservations(p.reserved);

  const month = monthKey();
  const isUnlimited = !!p.unlimited?.[deviceKey] || isGlobalUnlimited(deviceKey);

  if (!isUnlimited) {
    const usedMonth = p.used?.[deviceKey];
    if (usedMonth === month) return { ok: false, reason: "monthly_already_used" };
    // already reserved by this device?
    for (const r of Object.values(p.reserved || {})) {
      if (r?.deviceKey === deviceKey && r?.month === month) return { ok: false, reason: "monthly_already_reserved" };
    }
  }

  const rawDisc = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = Math.min(maxRp, rawDisc);
  const finalAmount = Math.max(1, Number(amount || 0) - discountRp);

  const token = crypto.randomBytes(10).toString("hex");
  const expiresAt = new Date(nowMs() + reserveTtlMs).toISOString();

  // even if unlimited, we still create a reservation (to keep flow consistent)
  p.reserved[token] = { deviceKey, month, expiresAt, discountRp };

  return {
    ok: true,
    discountRp,
    finalAmount,
    info: { type: "monthly", code, name: "Promo Bulanan", percent, maxRp, month },
    reservation: { type: "monthly", token, month, expiresAt, discountRp, deviceKey },
  };
}

// ----- Voucher reservation -----

function isVoucherEligible(db, v, deviceKey) {
  if (!v || typeof v !== "object") return { ok: false, reason: "voucher_not_found" };
  if (v.disabled) return { ok: false, reason: "voucher_disabled" };

  const now = nowMs();
  const startsAt = v.startsAt ? Date.parse(v.startsAt) : null;
  const expiresAt = v.expiresAt ? Date.parse(v.expiresAt) : null;
  if (startsAt && now < startsAt) return { ok: false, reason: "voucher_not_started" };
  if (expiresAt && now > expiresAt) return { ok: false, reason: "voucher_expired" };

  const isUnlimited = isUnlimitedForVoucher(v, deviceKey);

  // allowlists (skip if unlimited)
  if (!isUnlimited) {
    const allowed = pickList(v.allowedDevices).concat(pickList(v.allowedDeviceKeys));
    if (allowed.length && (!deviceKey || !allowed.includes(deviceKey))) {
      return { ok: false, reason: "voucher_not_allowed_device" };
    }
  }

  // per-device once (skip if unlimited)
  if (!isUnlimited) {
    if (deviceKey && v.usedByDevice && v.usedByDevice[deviceKey]) {
      return { ok: false, reason: "voucher_already_used" };
    }
  }

  return { ok: true, isUnlimited };
}

function reserveVoucher(db, amount, deviceKey, voucherCode, reserveTtlMs) {
  const code = normalizeCode(voucherCode);
  if (!code) return { ok: false, reason: "voucher_code_required" };

  const v = db.vouchers?.[code];
  const elig = isVoucherEligible(db, v, deviceKey);
  if (!elig.ok) return elig;

  const percent = Number(v.percent || 0);
  const maxRp = Number(v.maxRp || 0);
  if (percent <= 0 || maxRp <= 0) return { ok: false, reason: "voucher_invalid" };

  // cleanup expired reservations first
  v.reserved = v.reserved || {};
  cleanupExpiredReservations(v.reserved);

  // maxUses check (skip if unlimited device)
  if (!elig.isUnlimited && Number.isFinite(Number(v.maxUses)) && Number(v.maxUses) > 0) {
    const maxUses = Number(v.maxUses);
    const used = Number(v.uses || 0);
    const reservedCount = Object.keys(v.reserved || {}).length;
    if (used + reservedCount >= maxUses) return { ok: false, reason: "voucher_sold_out" };
  }

  // also avoid multiple reservations per-device (skip if unlimited)
  if (!elig.isUnlimited && deviceKey) {
    for (const r of Object.values(v.reserved || {})) {
      if (r?.deviceKey === deviceKey) return { ok: false, reason: "voucher_already_reserved" };
    }
  }

  const rawDisc = Math.floor((Number(amount || 0) * percent) / 100);
  const discountRp = Math.min(maxRp, rawDisc);
  const finalAmount = Math.max(1, Number(amount || 0) - discountRp);

  // ✅ Unlimited device: no reservation needed, and does NOT consume quota / mark used.
  if (elig.isUnlimited) {
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
        unlimited: true,
      },
      reservation: null,
    };
  }

  const token = crypto.randomBytes(10).toString("hex");
  const expiresAt = new Date(nowMs() + reserveTtlMs).toISOString();

  v.reserved[token] = { deviceKey: deviceKey || null, expiresAt, discountRp };
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
    reservation: { type: "voucher", code, token, expiresAt, discountRp, deviceKey: deviceKey || null },
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
    return { finalAmount, discountRp, applied, reservations };
  }

  // try voucher first
  const v = reserveVoucher(db, finalAmount, deviceKey, code, reserveTtlMs);
  if (v.ok) {
    discountRp += Number(v.discountRp || 0);
    finalAmount = Math.max(1, finalAmount - Number(v.discountRp || 0));
    applied.push(v.info);
    if (v.reservation) reservations.push(v.reservation);
    return { finalAmount, discountRp, applied, reservations };
  }

  // then monthly promo (same code gate)
  const p = db.promo?.monthly;
  const monthlyCode = normalizeCode(p?.code);
  if (monthlyCode && normalizeCode(code) === monthlyCode) {
    const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs);
    if (m.ok) {
      discountRp += Number(m.discountRp || 0);
      finalAmount = Math.max(1, finalAmount - Number(m.discountRp || 0));
      applied.push(m.info);
      if (m.reservation) reservations.push(m.reservation);
      return { finalAmount, discountRp, applied, reservations };
    }
  }

  // not applied
  return { finalAmount, discountRp: 0, applied: [], reservations: [] };
}

function commitReservations(db, reservations) {
  ensure(db);
  const list = Array.isArray(reservations) ? reservations : reservations ? [reservations] : [];

  for (const r of list) {
    if (!r || typeof r !== "object") continue;

    if (r.type === "voucher") {
      const code = normalizeCode(r.code);
      const v = db.vouchers?.[code];
      if (!v || v.disabled) continue;

      const token = String(r.token || "");
      if (!token) continue;

      // if token missing, ignore
      if (!v.reserved || !v.reserved[token]) continue;

      // consume quota
      v.uses = Number(v.uses || 0) + 1;
      v.usedByDevice = v.usedByDevice || {};
      if (r.deviceKey) v.usedByDevice[String(r.deviceKey)] = true;

      delete v.reserved[token];
      continue;
    }

    if (r.type === "monthly") {
      const p = db.promo.monthly;
      const token = String(r.token || "");
      if (!token) continue;
      if (!p.reserved || !p.reserved[token]) continue;

      const deviceKey = String(r.deviceKey || "");
      const month = String(r.month || "");
      if (deviceKey && month) {
        p.used = p.used || {};
        p.used[deviceKey] = month;
      }

      delete p.reserved[token];
      continue;
    }
  }
}

function releaseReservations(db, reservations) {
  ensure(db);
  const list = Array.isArray(reservations) ? reservations : reservations ? [reservations] : [];

  for (const r of list) {
    if (!r || typeof r !== "object") continue;

    if (r.type === "voucher") {
      const code = normalizeCode(r.code);
      const v = db.vouchers?.[code];
      if (!v) continue;

      const token = String(r.token || "");
      if (!token) continue;
      if (v.reserved && v.reserved[token]) delete v.reserved[token];
      continue;
    }

    if (r.type === "monthly") {
      const p = db.promo.monthly;
      const token = String(r.token || "");
      if (!token) continue;
      if (p.reserved && p.reserved[token]) delete p.reserved[token];
      continue;
    }
  }
}

// ===================== ADMIN HELPERS =====================

function adminUpsertVoucher(db, body) {
  ensure(db);
  const code = normalizeCode(body?.code);
  if (!code) throw new Error("code required");

  const percent = Number(body?.percent ?? body?.percentOff ?? body?.pct ?? 0);
  const maxRp = Number(body?.maxRp ?? body?.maxDiscountRp ?? body?.cap ?? 0);
  const name = String(body?.name || code).trim();

  const maxUsesVal = body?.maxUses ?? body?.limit ?? null;
  const maxUses = maxUsesVal === null || maxUsesVal === "" ? null : Number(maxUsesVal);

  const startsAt = body?.startsAt ? new Date(body.startsAt).toISOString() : null;
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt).toISOString() : null;

  if (!Number.isFinite(percent) || percent <= 0) throw new Error("percent invalid");
  if (!Number.isFinite(maxRp) || maxRp <= 0) throw new Error("maxRp invalid");
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) throw new Error("maxUses invalid");

  const prev = db.vouchers[code] || {};
  db.vouchers[code] = {
    ...prev,
    code,
    name,
    percent,
    maxRp,
    maxUses,
    startsAt: startsAt || prev.startsAt || null,
    expiresAt: expiresAt || prev.expiresAt || null,
    disabled: body?.disabled === true ? true : prev.disabled === true ? true : false,

    // keep counters/reservations
    uses: Number(prev.uses || 0),
    reserved: prev.reserved || {},
    usedByDevice: prev.usedByDevice || {},

    // optional device rules (store as deviceKey list)
    allowedDevices: pickList(body?.allowedDevices ?? prev.allowedDevices),
    unlimitedDevices: pickList(body?.unlimitedDevices ?? prev.unlimitedDevices),
  };

  return db.vouchers[code];
}

function adminDisableVoucher(db, body) {
  ensure(db);
  const code = normalizeCode(body?.code);
  if (!code) throw new Error("code required");
  const v = db.vouchers?.[code];
  if (!v) throw new Error("voucher not found");
  v.disabled = true;
  v.disabledAt = isoNow();
  return v;
}

function adminSetMonthlyPromo(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (typeof body?.enabled === "boolean") p.enabled = body.enabled;

  if (body?.code) p.code = normalizeCode(body.code);
  if (body?.percent != null) p.percent = Number(body.percent);
  if (body?.maxRp != null) p.maxRp = Number(body.maxRp);

  // allow manage unlimited devices
  // - body.addUnlimitedDeviceKey
  // - body.removeUnlimitedDeviceKey
  // - body.addUnlimitedDeviceId (will be hashed)
  // - body.removeUnlimitedDeviceId
  p.unlimited = p.unlimited || {};

  const addKey = String(body?.addUnlimitedDeviceKey || "").trim();
  const delKey = String(body?.removeUnlimitedDeviceKey || "").trim();
  const addId = String(body?.addUnlimitedDeviceId || "").trim();
  const delId = String(body?.removeUnlimitedDeviceId || "").trim();

  const add = addKey || (addId ? getDeviceKey(addId) : "");
  const del = delKey || (delId ? getDeviceKey(delId) : "");

  if (add) p.unlimited[add] = true;
  if (del && p.unlimited[del]) delete p.unlimited[del];

  p.updatedAt = isoNow();
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
