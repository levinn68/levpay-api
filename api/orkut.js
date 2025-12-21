/**
 * api/orkut.js — FINAL
 *
 * Tujuan:
 * - Frontend LevPay (scripts/api.js) nembak /api/orkut?action=createqr|status|cancel|qr
 * - Admin page bisa ngatur voucher + promo bulanan lewat /api/orkut?action=voucher.*|monthly.*
 * - Diskon (voucher + monthly) dihitung DI VERCEL (bukan di VPS) pakai GH DB, supaya konsisten.
 * - Saat QR dibuat: kita reserve diskon -> amount QR = amountFinal -> pricing disimpan ke tx store.
 * - Saat PAID: commit reservations (voucher uses + monthly used) sekali aja (idempotent).
 * - Saat CANCEL/EXPIRED: release reservations supaya nggak “nyangkut”.
 *
 * Env wajib (proxy ke VPS):
 * - VPS_BASE   = https://domain-vps-kamu (tanpa slash belakang)
 * - VPS_TOKEN  = token untuk Authorization Bearer (kalau VPS lu pakai)
 *
 * Env untuk DB GitHub (persist device monthly + voucher uses + tx mapping):
 * - GH_OWNER   = username/org
 * - GH_REPO    = repo
 * - GH_PATH    = path file json (contoh: "levpay-db.json" atau "tmp/levpay-db.json")
 * - GH_TOKEN   = classic token yang bisa read/write repo (contents)
 *
 * Env admin:
 * - ADMIN_KEY  = admin key (header X-Admin-Key)
 *
 * Optional:
 * - CALLBACK_SECRET = kalau mau proteksi paidhook (header X-Callback-Secret)
 * - DEVICE_PEPPER   = pepper untuk bikin deviceKey SHA256(deviceId|pepper)
 */

const crypto = require("crypto");

// ====== CONFIG ======
const VPS_BASE = String(process.env.VPS_BASE || "").trim().replace(/\/+$/, "");
const VPS_TOKEN = String(process.env.VPS_TOKEN || "").trim();

const GH_OWNER = String(process.env.GH_OWNER || "").trim();
const GH_REPO = String(process.env.GH_REPO || "").trim();
const GH_PATH = String(process.env.GH_PATH || "tmp/levpay-db.json").trim().replace(/^\/+/, "");
const GH_TOKEN = String(process.env.GH_TOKEN || "").trim();

const ADMIN_KEY = String(process.env.ADMIN_KEY || "LEVIN6824").trim();
const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim();
const DEVICE_PEPPER = String(process.env.DEVICE_PEPPER || "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4").trim();

// ====== utils (http/json) ======
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

function nowISO() {
  return new Date().toISOString();
}

function yyyymm(d = new Date()) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function getDeviceKey(deviceId, pepper = DEVICE_PEPPER) {
  return sha256Hex(String(deviceId || "") + "|" + String(pepper || ""));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // vercel kadang sudah parse
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

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const txt = await r.text();
  let json = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {
    json = { raw: txt };
  }
  return { ok: r.ok, status: r.status, json };
}

// ====== GitHub DB (read/write) ======
function ghEnabled() {
  return !!(GH_OWNER && GH_REPO && GH_PATH && GH_TOKEN);
}

function ghHeaders(extra = {}) {
  return {
    Authorization: `token ${GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "levpay-api",
    ...extra,
  };
}

function ghUrlContents() {
  return `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
    GH_REPO
  )}/contents/${GH_PATH}`;
}

function b64Encode(str) {
  return Buffer.from(String(str || ""), "utf8").toString("base64");
}

function b64Decode(b64) {
  return Buffer.from(String(b64 || ""), "base64").toString("utf8");
}

async function ghReadFile() {
  if (!ghEnabled()) return { ok: false, error: "GH env missing" };
  const url = ghUrlContents();
  const r = await fetchJson(url, { method: "GET", headers: ghHeaders() });
  if (!r.ok) {
    return { ok: false, status: r.status, error: r.json?.message || "gh read failed", raw: r.json };
  }
  const content = r.json?.content || "";
  const sha = r.json?.sha || "";
  let data = {};
  try {
    data = content ? JSON.parse(b64Decode(content)) : {};
  } catch {
    data = {};
  }
  return { ok: true, sha, data };
}

async function ghWriteFile(db, prevSha) {
  if (!ghEnabled()) return { ok: false, error: "GH env missing" };
  const url = ghUrlContents();
  const body = {
    message: `levpay db update ${new Date().toISOString()}`,
    content: b64Encode(JSON.stringify(db, null, 2)),
  };
  if (prevSha) body.sha = prevSha;
  const r = await fetchJson(url, {
    method: "PUT",
    headers: ghHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    return { ok: false, status: r.status, error: r.json?.message || "gh write failed", raw: r.json };
  }
  const sha = r.json?.content?.sha || r.json?.commit?.sha || "";
  return { ok: true, sha };
}

// ====== DB schema / ensure ======
function ensure(db) {
  db = db && typeof db === "object" ? db : {};
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // monthly promo
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      // ✅ limit total pemakaian promo per bulan (global) — null = unlimited
      maxUses: null,

      // 1×/device/bulan
      used: {}, // deviceKey -> yyyymm

      // global count per month
      usesByMonth: {}, // yyyymm -> number

      // reservation (anti double reserve)
      reserved: {}, // deviceKey -> {token, month, expiresAt, discountRp}

      // unlimited deviceKey list
      unlimited: {}, // deviceKey -> true

      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.usesByMonth = db.promo.monthly.usesByMonth || {};
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

// ====== Discount engine ======
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

function reserveMonthlyPromo(db, amount, deviceKey, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  // 1×/device/bulan
  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // kalau sudah reserved bulan ini -> jangan kasih lagi sampai expired
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // ✅ limit total pemakaian promo per bulan (global)
  if (p.maxUses != null) {
    const maxUses = Number(p.maxUses);
    if (Number.isFinite(maxUses) && maxUses > 0) {
      const usedCount = Number(p.usesByMonth[cur] || 0);
      const reservedCount = Object.values(p.reserved || {}).filter((x) => x?.month === cur).length;
      if (!isUnlimited && usedCount + reservedCount >= maxUses) {
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
    p.reserved[deviceKey] = { token: t, month: cur, expiresAt, discountRp };

    return {
      ok: true,
      discountRp,
      info: { type: "monthly", name: p.name || "PROMO BULANAN", percent, maxRp, maxUses: p.maxUses },
      reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
    };
  }

  return { ok: false, discountRp: 0 };
}

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
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

  // monthly setelah voucher
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, reserveTtlMs);
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

        // ✅ increment global uses count per month
        db.promo.monthly.usesByMonth[r.month] = Number(db.promo.monthly.usesByMonth[r.month] || 0) + 1;

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

// ====== Admin ops ======
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
    updatedAt: nowISO(),
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
  db.vouchers[code].updatedAt = nowISO();
  return db.vouchers[code];
}

function adminSetMonthlyPromo(db, body) {
  ensure(db);
  const p = db.promo.monthly;

  if (body.enabled != null) p.enabled = !!body.enabled;
  if (body.name != null) p.name = String(body.name);
  if (body.percent != null) p.percent = clamp(Number(body.percent), 0, 100);
  if (body.maxRp != null) p.maxRp = Math.max(0, Number(body.maxRp));

  // ✅ maxUses global per bulan (null = unlimited)
  if (body.maxUses !== undefined) {
    if (body.maxUses === null || body.maxUses === "" || body.maxUses === 0) p.maxUses = null;
    else {
      const n = Number(body.maxUses);
      p.maxUses = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  // add/remove unlimited by deviceKey (sha256)
  if (body.addUnlimitedDeviceKey != null) {
    const k = String(body.addUnlimitedDeviceKey).trim();
    if (k) p.unlimited[k] = true;
  }
  if (body.removeUnlimitedDeviceKey != null) {
    const k = String(body.removeUnlimitedDeviceKey).trim();
    if (k && p.unlimited) delete p.unlimited[k];
  }

  p.updatedAt = nowISO();
  return p;
}

// ====== tx store (mapping pricing/reservations -> idTransaksi) ======
function txUpsert(db, idTransaksi, patch) {
  ensure(db);
  const id = String(idTransaksi || "").trim();
  if (!id) throw new Error("idTransaksi required");
  const prev = db.tx[id] || {};
  db.tx[id] = {
    ...prev,
    ...patch,
    idTransaksi: id,
    updatedAt: nowISO(),
    createdAt: prev.createdAt || nowISO(),
  };
  return db.tx[id];
}

function txGet(db, idTransaksi) {
  ensure(db);
  return db.tx?.[String(idTransaksi || "").trim()] || null;
}

// ====== VPS proxy helpers ======
function vpsHeaders(extra = {}) {
  const h = { ...extra };
  if (VPS_TOKEN) h.Authorization = `Bearer ${VPS_TOKEN}`;
  return h;
}

function vpsUrl(p) {
  if (!VPS_BASE) return "";
  return VPS_BASE.replace(/\/+$/, "") + String(p || "");
}

async function vpsPostJson(pathname, body) {
  const url = vpsUrl(pathname);
  if (!url) return { ok: false, status: 500, json: { success: false, error: "VPS_BASE missing" } };
  return fetchJson(url, {
    method: "POST",
    headers: vpsHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body || {}),
  });
}

async function vpsGet(pathname) {
  const url = vpsUrl(pathname);
  if (!url) return { ok: false, status: 500, json: { success: false, error: "VPS_BASE missing" } };
  return fetchJson(url, { method: "GET", headers: vpsHeaders() });
}

// ====== help/tutor ======
function help() {
  return {
    success: true,
    service: "levpay-api (orkut)",
    paths: { recommended: "/api/orkut?action=..." },
    actions: [
      "ping",
      "help",
      "tutor",

      // QR proxy
      "createqr",
      "status",
      "cancel",
      "qr",

      // discount engine
      "discount.apply",
      "discount.commit",
      "discount.release",

      // admin
      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",
      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",

      // hook
      "paidhook",
    ],
    admin: { header: "X-Admin-Key", requiredFor: ["voucher.*", "monthly.*"] },
    ghdb: {
      requiredEnv: ["GH_OWNER", "GH_REPO", "GH_PATH", "GH_TOKEN"],
      note: "DB disimpan di GitHub contents API (persist).",
    },
    vps: { requiredEnv: ["VPS_BASE"], optionalEnv: ["VPS_TOKEN"] },
  };
}

function tutor() {
  return {
    success: true,
    notes: [
      "Set env: VPS_BASE & VPS_TOKEN (untuk proxy QR).",
      "Set env: GH_OWNER, GH_REPO, GH_PATH, GH_TOKEN (untuk DB GitHub).",
      "Admin endpoints butuh header: X-Admin-Key: <ADMIN_KEY>.",
      "Untuk terminal/curl: export HOST='https://domain-vercel-kamu' dan export ADMIN='<ADMIN_KEY>'.",
    ],
    examples: {
      ping: {
        curl: "curl -sS \\\"$HOST/api/orkut?action=ping\\\" | jq",
        resp: { success: true, ok: true },
      },
      "voucher.upsert": {
        curl:
          "curl -sS -X POST \\\"$HOST/api/orkut?action=voucher.upsert\\\" \\\n" +
          "  -H \\\"X-Admin-Key: $ADMIN\\\" \\\n" +
          "  -H \\\"Content-Type: application/json\\\" \\\n" +
          "  -d '{\"code\":\"VIPL\",\"enabled\":true,\"name\":\"VIP LEVEL\",\"percent\":90,\"maxRp\":0,\"maxUses\":100,\"expiresAt\":\"2026-12-31T23:59:59.000Z\"}' | jq",
        resp: { success: true, data: { code: "VIPL", enabled: true, percent: 90 } },
      },
      "monthly.set": {
        curl:
          "curl -sS -X POST \\\"$HOST/api/orkut?action=monthly.set\\\" \\\n" +
          "  -H \\\"X-Admin-Key: $ADMIN\\\" \\\n" +
          "  -H \\\"Content-Type: application/json\\\" \\\n" +
          "  -d '{\"enabled\":true,\"name\":\"PROMO BULANAN\",\"percent\":5,\"maxRp\":2000,\"maxUses\":1000}' | jq",
        resp: { success: true, data: { enabled: true, percent: 5 } },
      },
      "discount.apply": {
        curl:
          "curl -sS -X POST \\\"$HOST/api/orkut?action=discount.apply\\\" \\\n" +
          "  -H \\\"Content-Type: application/json\\\" \\\n" +
          "  -d '{\"amount\":10000,\"deviceId\":\"dev_termux_1\",\"voucher\":\"VIPL\"}' | jq",
        resp: { success: true, data: { pricing: { amountOriginal: 10000, amountFinal: 1 } } },
      },
      "createqr": {
        curl:
          "curl -sS -X POST \\\"$HOST/api/orkut?action=createqr\\\" \\\n" +
          "  -H \\\"Content-Type: application/json\\\" \\\n" +
          "  -d '{\"amount\":10000,\"deviceId\":\"dev_web_1\",\"voucher\":\"VIPL\"}' | jq",
        resp: { success: true, data: { idTransaksi: \"...\", pricing: { amountFinal: \"...\" } } },
      },
    },
  };
}

// ===== MAIN HANDLER =====
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  // body
  const body = await readBody(req);

  // basic
  if (!action || action === "help") return send(res, 200, help());
  if (action === "tutor") return send(res, 200, tutor());
  if (action === "ping") return send(res, 200, { success: true, ok: true, time: nowISO() });

  // GH db load
  let gh = { ok: false, data: {}, sha: "" };
  if (ghEnabled()) gh = await ghReadFile();
  const db = ensure(gh.ok ? gh.data : {});

  try {
    // ===== DISCOUNT (public) =====
    if (action === "discount.apply" || action === "apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const voucher = body.voucher || body.voucherCode || body.code || "";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      const r = applyDiscount({
        db,
        amount,
        deviceId,
        voucherCode: voucher,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      const pricing = {
        amountOriginal: amount,
        amountFinal: r.finalAmount,
        discountRp: r.discountRp,
        applied: r.applied,
        reservations: r.reservations,
        deviceKey: r.deviceKey,
      };

      if (ghEnabled()) await ghWriteFile(db, gh.sha);

      return send(res, 200, { success: true, data: { pricing } });
    }

    if (action === "discount.commit" || action === "commit") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      commitReservations(db, reservations);
      if (ghEnabled()) await ghWriteFile(db, gh.sha);
      return send(res, 200, { success: true, data: { committed: reservations.length } });
    }

    if (action === "discount.release" || action === "release") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      releaseReservations(db, reservations);
      if (ghEnabled()) await ghWriteFile(db, gh.sha);
      return send(res, 200, { success: true, data: { released: reservations.length } });
    }

    // ===== VOUCHER (ADMIN) =====
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = adminUpsertVoucher(db, body || {});
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.disable") {
        const out = adminDisableVoucher(db, body || {});
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""))
        );
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "")
          .trim()
          .toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v });
      }

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // ===== MONTHLY (ADMIN) =====
    if (action.startsWith("monthly.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "monthly.get") {
        cleanupExpiredReservations(db);
        const cur = yyyymm();
        const usedCount = Number(db.promo.monthly.usesByMonth?.[cur] || 0);
        const reservedCount = Object.values(db.promo.monthly.reserved || {}).filter((x) => x?.month === cur).length;
        return send(res, 200, {
          success: true,
          data: {
            ...db.promo.monthly,
            stats: {
              month: cur,
              usedCount,
              reservedCount,
              limitMaxUses: db.promo.monthly.maxUses ?? null,
            },
          },
        });
      }

      if (action === "monthly.set") {
        const out = adminSetMonthlyPromo(db, body || {});
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
        return send(res, 200, { success: true, data: out });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // ===== QR PROXY + APPLY DISCOUNT INSIDE createqr =====
    if (action === "createqr") {
      // expected from frontend: amount, deviceId, voucher, deviceName, notes
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const voucher = body.voucher || body.voucherCode || body.code || "";
      const deviceName = body.deviceName || body.devicename || "";
      const notes = body.notes || "";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      // reserve discount (voucher + monthly) locally
      const r = applyDiscount({
        db,
        amount,
        deviceId,
        voucherCode: voucher,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      const pricing = {
        amountOriginal: amount,
        amountFinal: r.finalAmount,
        discountRp: r.discountRp,
        applied: r.applied,
        reservations: r.reservations,
        deviceKey: r.deviceKey,
      };

      // create QR on VPS with FINAL amount
      // IMPORTANT: jangan kirim voucher ke VPS biar nggak double-discount (voucher dihitung di sini)
      const vpsResp = await vpsPostJson("/api/v1/levpay/createqr", {
        amount: pricing.amountFinal,
        deviceId,
        deviceName,
        notes: notes ? String(notes) : "",
      });

      if (!vpsResp.ok) {
        // rollback reservation biar gak nyangkut
        releaseReservations(db, pricing.reservations);
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
        return send(res, vpsResp.status || 502, {
          success: false,
          error: "createqr failed",
          vps: vpsResp.json,
        });
      }

      const d = vpsResp.json?.data ?? vpsResp.json ?? {};
      const idTransaksi = String(d.idTransaksi || d.idtransaksi || d.id || "").trim();
      if (!idTransaksi) {
        releaseReservations(db, pricing.reservations);
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
        return send(res, 500, { success: false, error: "createqr mismatch (no idTransaksi)" });
      }

      // save tx mapping (pricing + reservations) so status can merge + paid can commit
      txUpsert(db, idTransaksi, {
        status: "pending",
        voucher: String(voucher || "").trim().toUpperCase(),
        deviceId,
        deviceKey: pricing.deviceKey,
        pricing,
        reservations: pricing.reservations,
        committed: false,
        released: false,
      });

      if (ghEnabled()) await ghWriteFile(db, gh.sha);

      // return merged data for frontend
      const out = {
        ...d,
        idTransaksi,
        voucher: String(voucher || "").trim().toUpperCase(),
        pricing,
      };

      return send(res, 200, { success: true, data: out });
    }

    if (action === "status") {
      const id = String(url.searchParams.get("id") || url.searchParams.get("idTransaksi") || body.id || body.idTransaksi || "").trim();
      if (!id) return send(res, 400, { success: false, error: "id required" });

      const vpsResp = await vpsGet(`/api/v1/levpay/status?id=${encodeURIComponent(id)}`);
      if (!vpsResp.ok) {
        return send(res, vpsResp.status || 502, { success: false, error: "status failed", vps: vpsResp.json });
      }

      const d = vpsResp.json?.data ?? vpsResp.json ?? {};
      const status = String(d.status || "pending").toLowerCase();

      // merge with tx mapping (pricing)
      const t = txGet(db, id);
      const merged = t
        ? {
            ...d,
            idTransaksi: id,
            voucher: t.voucher || d.voucher || "",
            pricing: t.pricing || d.pricing || null,
            applied: (t.pricing && t.pricing.applied) || d.applied || null,
          }
        : { ...d, idTransaksi: id };

      // if paid and not committed yet -> commit reservations
      if (t && status === "paid" && !t.committed) {
        commitReservations(db, t.reservations || []);
        txUpsert(db, id, { committed: true, status: "paid", paidAt: d.paidAt || nowISO() });
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
      }

      // if expired/cancelled and not released -> release reservations
      if (t && (status === "expired" || status === "cancelled" || status === "canceled") && !t.released && !t.committed) {
        releaseReservations(db, t.reservations || []);
        txUpsert(db, id, { released: true, status });
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
      }

      return send(res, 200, { success: true, data: merged });
    }

    if (action === "cancel") {
      const id = String(body.idTransaksi || body.id || url.searchParams.get("id") || "").trim();
      if (!id) return send(res, 400, { success: false, error: "id required" });

      const vpsResp = await vpsPostJson("/api/v1/levpay/cancel", { idTransaksi: id });
      const t = txGet(db, id);

      if (t && !t.committed && !t.released) {
        releaseReservations(db, t.reservations || []);
        txUpsert(db, id, { released: true, status: "cancelled" });
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
      }

      if (!vpsResp.ok) {
        return send(res, vpsResp.status || 502, { success: false, error: "cancel failed", vps: vpsResp.json });
      }
      return send(res, 200, vpsResp.json);
    }

    if (action === "qr") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return send(res, 400, { success: false, error: "id required" });

      // proxy raw QR from VPS
      const q = await fetch(vpsUrl(`/api/v1/levpay/qr?id=${encodeURIComponent(id)}`), {
        method: "GET",
        headers: vpsHeaders(),
      });

      res.statusCode = q.status;
      res.setHeader("Cache-Control", "no-store");

      // forward content-type
      const ct = q.headers.get("content-type");
      if (ct) res.setHeader("Content-Type", ct);

      const buf = Buffer.from(await q.arrayBuffer());
      res.end(buf);
      return;
    }

    // ===== PAIDHOOK =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });

      const id = String(body.idTransaksi || body.id || "").trim();
      if (!id) return send(res, 400, { success: false, error: "idTransaksi required" });

      const t = txGet(db, id);
      if (t && !t.committed) {
        commitReservations(db, t.reservations || []);
        txUpsert(db, id, { committed: true, status: "paid", paidAt: body.paidAt || nowISO() });
        if (ghEnabled()) await ghWriteFile(db, gh.sha);
      }

      return send(res, 200, { success: true, data: { received: true, idTransaksi: id } });
    }

    return send(res, 404, {
      success: false,
      error: "Unknown action",
      hint:
        "use action=createqr|status|cancel|qr|discount.apply|discount.commit|discount.release|voucher.*|monthly.*|paidhook|help|ping|tutor",
    });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};