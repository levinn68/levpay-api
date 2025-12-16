const crypto = require("crypto");
const { readJsonFile, writeJsonFile } = require("./github");

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function nowISO() {
  return new Date().toISOString();
}

function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() > t;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function deviceKey({ deviceId, ip, ua }) {
  const pepper = process.env.DEVICE_PEPPER || "levpay_pepper_change_me";
  const ipPart = String(ip || "").split(".").slice(0, 3).join("."); // best-effort
  const uaHash = sha256(String(ua || "").slice(0, 160));
  const raw = `${deviceId || "noid"}|${ipPart}|${uaHash}|${pepper}`;
  return sha256(raw);
}

function defaultDb() {
  return {
    promo1: {
      month: monthKey(),
      used: {}, // deviceKey -> true
      percent: Number(process.env.PROMO1_PERCENT || 10),
      maxRp: Number(process.env.PROMO1_MAX_RP || 5000),
    },
    promos: {
      // "KODE": { type:"percent"|"fixed", value:10, active:true, expiresAt:null, maxUses:null, usedCount:0, perDeviceOnce:false, usedDevices:{} }
    },
    meta: { updatedAt: nowISO() },
  };
}

function ensureDbShape(db) {
  const base = defaultDb();
  const out = (db && typeof db === "object") ? db : {};
  out.promo1 = out.promo1 && typeof out.promo1 === "object" ? out.promo1 : base.promo1;
  out.promos = out.promos && typeof out.promos === "object" ? out.promos : {};
  out.meta = out.meta && typeof out.meta === "object" ? out.meta : {};
  if (!out.promo1.month) out.promo1.month = base.promo1.month;
  if (!out.promo1.used || typeof out.promo1.used !== "object") out.promo1.used = {};
  if (!Number.isFinite(Number(out.promo1.percent))) out.promo1.percent = base.promo1.percent;
  if (!Number.isFinite(Number(out.promo1.maxRp))) out.promo1.maxRp = base.promo1.maxRp;
  return out;
}

async function loadDb() {
  const { json, sha, exists } = await readJsonFile();
  const db = ensureDbShape(json || (exists ? {} : defaultDb()));
  return { db, sha };
}

async function saveDb(db, sha, msg) {
  db.meta.updatedAt = nowISO();
  await writeJsonFile(db, sha, msg || "update vouchers");
}

function applyDiscount(amount, voucher) {
  const a = Math.max(0, Number(amount || 0));
  if (!voucher) return { pay: a, discount: 0 };

  if (voucher.type === "fixed") {
    const d = Math.max(0, Number(voucher.value || 0));
    const pay = Math.max(1, a - d);
    return { pay, discount: Math.min(a, d) };
  }

  if (voucher.type === "percent") {
    const p = Math.max(0, Math.min(100, Number(voucher.value || 0)));
    const d = Math.floor((a * p) / 100);
    const cap = Number.isFinite(Number(voucher.maxRp)) ? Number(voucher.maxRp) : null;
    const disc = cap != null ? Math.min(d, cap) : d;
    const pay = Math.max(1, a - disc);
    return { pay, discount: Math.min(a, disc) };
  }

  return { pay: a, discount: 0 };
}

async function tryMonthlyPromo({ amount, dkey }) {
  const { db, sha } = await loadDb();

  const mk = monthKey();
  if (db.promo1.month !== mk) {
    db.promo1.month = mk;
    db.promo1.used = {};
  }

  if (db.promo1.used[dkey]) {
    return { ok: false, reason: "promo1_already_used", db, sha };
  }

  const v = {
    type: "percent",
    value: Number(db.promo1.percent || 10),
    maxRp: Number(db.promo1.maxRp || 5000),
  };

  const { pay, discount } = applyDiscount(amount, v);
  db.promo1.used[dkey] = true;

  return {
    ok: true,
    kind: "PROMO_BULANAN",
    code: "PROMO1",
    pay,
    discount,
    db,
    sha,
  };
}

async function tryCustomPromo({ amount, code, dkey }) {
  const CODE = normalizeCode(code);
  if (!CODE) return { ok: false, reason: "no_code" };

  const { db, sha } = await loadDb();
  const promo = db.promos[CODE];

  if (!promo || promo.active === false) return { ok: false, reason: "promo_not_found", db, sha };
  if (isExpired(promo.expiresAt)) return { ok: false, reason: "promo_expired", db, sha };

  if (Number.isFinite(Number(promo.maxUses)) && Number(promo.maxUses) >= 0) {
    const used = Number(promo.usedCount || 0);
    if (used >= Number(promo.maxUses)) return { ok: false, reason: "promo_sold_out", db, sha };
  }

  if (promo.perDeviceOnce) {
    promo.usedDevices = promo.usedDevices && typeof promo.usedDevices === "object" ? promo.usedDevices : {};
    if (promo.usedDevices[dkey]) return { ok: false, reason: "promo_already_used_device", db, sha };
  }

  const { pay, discount } = applyDiscount(amount, promo);
  if (discount <= 0) return { ok: false, reason: "promo_no_discount", db, sha };

  promo.usedCount = Number(promo.usedCount || 0) + 1;
  if (promo.perDeviceOnce) promo.usedDevices[dkey] = true;
  db.promos[CODE] = promo;

  return {
    ok: true,
    kind: "PROMO_CUSTOM",
    code: CODE,
    pay,
    discount,
    db,
    sha,
  };
}

async function applyVoucher({ amount, deviceId, ip, ua, voucherCode, autoMonthly = true }) {
  const dkey = deviceKey({ deviceId, ip, ua });

  if (voucherCode) {
    const custom = await tryCustomPromo({ amount, code: voucherCode, dkey });
    if (custom.ok) {
      await saveDb(custom.db, custom.sha, `use promo ${custom.code}`);
      return {
        ok: true,
        amountOriginal: Number(amount),
        amountPay: custom.pay,
        discount: custom.discount,
        promo: { kind: custom.kind, code: custom.code },
      };
    }
    if (!autoMonthly) {
      return { ok: false, reason: custom.reason || "promo_rejected" };
    }
  }

  if (autoMonthly) {
    const m = await tryMonthlyPromo({ amount, dkey });
    if (m.ok) {
      await saveDb(m.db, m.sha, "use promo bulanan");
      return {
        ok: true,
        amountOriginal: Number(amount),
        amountPay: m.pay,
        discount: m.discount,
        promo: { kind: m.kind, code: m.code },
      };
    }
    return { ok: false, reason: m.reason || "monthly_rejected" };
  }

  return { ok: false, reason: "no_promo_applied" };
}

function requireAdminKey(req) {
  const admin = (process.env.ADMIN_KEY || "").trim();
  if (!admin) return true;
  const got =
    (req.headers["x-admin-key"] || "").toString().trim() ||
    (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  return got === admin;
}

async function adminSetPromo({ code, type, value, expiresAt, active, maxUses, perDeviceOnce }) {
  const CODE = normalizeCode(code);
  if (!CODE) throw new Error("code kosong");
  const T = String(type || "").toLowerCase().trim();
  if (!["percent", "fixed"].includes(T)) throw new Error("type harus percent/fixed");
  const V = Number(value);
  if (!Number.isFinite(V) || V <= 0) throw new Error("value invalid");

  const { db, sha } = await loadDb();

  const p = db.promos[CODE] && typeof db.promos[CODE] === "object" ? db.promos[CODE] : {};
  p.type = T;
  p.value = V;
  p.active = active === false ? false : true;
  p.expiresAt = expiresAt ? String(expiresAt) : null;

  if (maxUses === null || maxUses === undefined || maxUses === "") p.maxUses = null;
  else {
    const mu = Number(maxUses);
    if (!Number.isFinite(mu) || mu < 0) throw new Error("maxUses invalid");
    p.maxUses = mu;
  }

  p.perDeviceOnce = !!perDeviceOnce;
  p.usedCount = Number(p.usedCount || 0);
  p.usedDevices = p.usedDevices && typeof p.usedDevices === "object" ? p.usedDevices : {};

  db.promos[CODE] = p;
  await saveDb(db, sha, `admin set promo ${CODE}`);

  return { code: CODE, promo: p };
}

async function adminListPromos() {
  const { db } = await loadDb();
  const promos = db.promos || {};
  return promos;
}

module.exports = {
  applyVoucher,
  requireAdminKey,
  adminSetPromo,
  adminListPromos,
};
