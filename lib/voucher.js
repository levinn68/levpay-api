const crypto = require("crypto");

function yyyymm(d = new Date()) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function getDeviceKey(deviceId, pepper) {
  return crypto.createHash("sha256").update(String(deviceId || "") + "|" + String(pepper || "")).digest("hex");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.promo.monthly = db.promo.monthly || { enabled: true, percent: 10, maxRp: 5000, used: {} };
  db.promo.monthly.used = db.promo.monthly.used || {};
}

function applyMonthlyPromo(db, amount, deviceKey) {
  ensure(db);
  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const last = p.used[deviceKey] || "";
  if (last === cur) return { ok: false, discountRp: 0 };

  const percent = clamp(Number(p.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(p.maxRp || 0));
  const raw = Math.floor((amount * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp > 0) {
    p.used[deviceKey] = cur;
    return { ok: true, discountRp, info: { type: "monthly", percent, maxRp } };
  }
  return { ok: false, discountRp: 0 };
}

function applyVoucher(db, amount, voucherCode) {
  ensure(db);
  if (!voucherCode) return { ok: false, discountRp: 0 };

  const code = String(voucherCode).trim().toUpperCase();
  const v = db.vouchers[code];
  if (!v || v.enabled === false) return { ok: false, discountRp: 0 };

  if (v.expiresAt) {
    const exp = Date.parse(v.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return { ok: false, discountRp: 0 };
  }

  if (v.maxUses != null) {
    const used = Number(v.uses || 0);
    if (used >= Number(v.maxUses)) return { ok: false, discountRp: 0 };
  }

  const percent = clamp(Number(v.percent || 0), 0, 100);
  const maxRp = Math.max(0, Number(v.maxRp || 0));
  const raw = Math.floor((amount * percent) / 100);
  const discountRp = maxRp ? Math.min(raw, maxRp) : raw;

  if (discountRp > 0) {
    v.uses = Number(v.uses || 0) + 1;
    return { ok: true, discountRp, info: { type: "voucher", code, percent, maxRp, expiresAt: v.expiresAt || null } };
  }
  return { ok: false, discountRp: 0 };
}

function applyDiscount({ db, amount, deviceKey, voucherCode }) {
  ensure(db);

  let finalAmount = Number(amount || 0);
  let discountRp = 0;
  const applied = [];

  const v = applyVoucher(db, finalAmount, voucherCode);
  if (v.ok) {
    finalAmount = Math.max(1, finalAmount - v.discountRp);
    discountRp += v.discountRp;
    applied.push(v.info);
  }

  const m = applyMonthlyPromo(db, finalAmount, deviceKey);
  if (m.ok) {
    finalAmount = Math.max(1, finalAmount - m.discountRp);
    discountRp += m.discountRp;
    applied.push(m.info);
  }

  return { finalAmount, discountRp, applied };
}

function adminUpsertVoucher(db, body) {
  ensure(db);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) throw new Error("code required");

  db.vouchers[code] = {
    code,
    enabled: body.enabled !== false,
    percent: clamp(Number(body.percent || 0), 0, 100),
    maxRp: Math.max(0, Number(body.maxRp || 0)),
    expiresAt: body.expiresAt ? String(body.expiresAt) : null,
    uses: Number(db.vouchers[code]?.uses || 0),
    maxUses: body.maxUses != null ? Number(body.maxUses) : null,
    note: body.note ? String(body.note) : null,
    updatedAt: new Date().toISOString(),
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
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));
  p.updatedAt = new Date().toISOString();
  return p;
}

module.exports = {
  getDeviceKey,
  applyDiscount,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
};
