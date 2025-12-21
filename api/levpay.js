// api/levpay.js  (Vercel SINGLE-FILE ROUTER + GitHub DB)
// Actions:
// - /api/levpay?action=ping | help | tutor
// - /api/levpay?action=discount.apply|discount.commit|discount.release
// - /api/levpay?action=voucher.upsert|voucher.disable|voucher.list|voucher.get   (ADMIN)
// - /api/levpay?action=monthly.get|monthly.set|monthly.resetMonth               (ADMIN)
// - /api/levpay?action=tx.upsert|tx.get|tx.list|tx.search|tx.clear              (ADMIN)
// - /api/levpay?action=paidhook
//
// Admin endpoints require header: X-Admin-Key: <ADMIN_KEY>
//
// GitHub DB ENV (Wajib prefix GH, bukan GITHUB):
// - GH_OWNER, GH_REPO, GH_PATH (default: "tmp/levpay-db.json"), GH_BRANCH (default: "main"), GH_TOKEN
//
// Notes:
// - /tmp fallback tetap dipakai buat cache cepat (optional)
// - Monthly limit:
//    - Per-device: 1x/device/bulan (kecuali unlimited deviceKey)
//    - Global per bulan: maxUses (optional). Commit akan nambah counter per bulan.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ====== CONFIG ======
const DB_PATH = path.join("/tmp", "levpay-db.json");

// ADMIN
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";

// optional secret untuk paidhook
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";

// pepper buat bikin deviceKey (monthly tracking)
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "6db5a8b3eafc122eda3c7a5a09f61a2c019fcab0a18a4b53b391451f95b4bea4";

// GitHub DB
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_PATH = process.env.GH_PATH || "tmp/levpay-db.json";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_TOKEN = process.env.GH_TOKEN || "";

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
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}

function getDeviceKey(deviceId, pepper = DEVICE_PEPPER) {
  return sha256Hex(String(deviceId || "") + "|" + String(pepper || ""));
}

async function readBody(req) {
  // Vercel kadang sudah parse
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

// ====== GitHub DB ======
const hasGH = () => !!(GH_OWNER && GH_REPO && GH_PATH && GH_TOKEN);

async function ghFetch(url, opts = {}) {
  const headers = Object.assign(
    {
      Accept: "application/vnd.github+json",
      Authorization: `token ${GH_TOKEN}`,
      "User-Agent": "levpay-api",
    },
    opts.headers || {}
  );
  const r = await fetch(url, { ...opts, headers });
  const txt = await r.text();
  let json = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {
    json = { raw: txt };
  }
  return { ok: r.ok, status: r.status, json };
}

async function ghGetFile() {
  if (!hasGH()) return { ok: false, status: 0, json: null };
  const url =
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/` +
    `${encodeURIComponent(GH_PATH).replace(/%2F/g, "/")}?ref=${encodeURIComponent(GH_BRANCH)}`;

  return ghFetch(url, { method: "GET" });
}

async function ghPutFile({ contentStr, message }) {
  if (!hasGH()) return { ok: false, status: 0, json: null };

  const cur = await ghGetFile();
  const sha = cur.ok ? cur.json?.sha : undefined;

  const url =
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/` +
    `${encodeURIComponent(GH_PATH).replace(/%2F/g, "/")}`;

  const body = {
    message: message || `levpay-db update ${new Date().toISOString()}`,
    content: Buffer.from(String(contentStr || ""), "utf8").toString("base64"),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;

  return ghFetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// ====== local /tmp fallback ======
function readTmpDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeTmpDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ====== DB init / ensure ======
function ensure(db) {
  db = db && typeof db === "object" ? db : {};
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,

      // kalau requireCode=true -> monthly cuma aktif bila voucherCode == code
      requireCode: false,
      code: "MONTHLY",

      // limit total pemakaian global per bulan (optional)
      maxUses: null,

      used: {},        // deviceKey -> yyyymm
      reserved: {},    // deviceKey -> {token, month, expiresAt, discountRp}
      unlimited: {},   // deviceKey -> true

      usedCountByMonth: {}, // yyyymm -> number (commit only, exclude unlimited)
      updatedAt: null,
    };

  const p = db.promo.monthly;
  p.used = p.used || {};
  p.reserved = p.reserved || {};
  p.unlimited = p.unlimited || {};
  p.usedCountByMonth = p.usedCountByMonth || {};

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

function monthlyStats(db) {
  ensure(db);
  cleanupExpiredReservations(db);
  const p = db.promo.monthly;
  const cur = yyyymm();

  const usedDevicesThisMonth = Object.values(p.used || {}).filter((m) => m === cur).length;
  const usedGlobalThisMonth = Number(p.usedCountByMonth?.[cur] || 0);

  let reservedThisMonth = 0;
  for (const r of Object.values(p.reserved || {})) {
    if (r?.month === cur) reservedThisMonth++;
  }

  const unlimitedCount = Object.keys(p.unlimited || {}).length;

  return {
    month: cur,
    usedDevicesThisMonth,
    usedGlobalThisMonth,
    reservedThisMonth,
    maxUses: p.maxUses == null ? null : Number(p.maxUses),
    unlimitedCount,
  };
}

// ====== DB read/write (GH + tmp cache) ======
async function readDB() {
  // try GH first
  if (hasGH()) {
    const r = await ghGetFile();
    if (r.ok && r.json?.content) {
      try {
        const raw = Buffer.from(String(r.json.content || ""), "base64").toString("utf8");
        const db = raw ? JSON.parse(raw) : {};
        // cache to /tmp
        writeTmpDB(db);
        return ensure(db);
      } catch {
        // fallthrough to tmp
      }
    }
  }
  // fallback tmp
  return ensure(readTmpDB());
}

async function writeDB(db, msg) {
  ensure(db);
  // always cache tmp
  writeTmpDB(db);
  // push to GH if configured
  if (hasGH()) {
    const raw = JSON.stringify(db, null, 2);
    const r = await ghPutFile({ contentStr: raw, message: msg });
    return r.ok;
  }
  return true;
}

// ====== Discount engine ======
function reserveMonthlyPromo(db, amount, deviceKey, voucherCode, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0 };

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  // optional require code
  if (p.requireCode) {
    const need = String(p.code || "MONTHLY").trim().toUpperCase();
    const got = String(voucherCode || "").trim().toUpperCase();
    if (!need || got !== need) return { ok: false, discountRp: 0 };
  }

  // per device 1x/bulan
  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0 };

  // already reserved for this month
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0 };

  // global maxUses per month (commit only, reserve counts too)
  if (!isUnlimited && p.maxUses != null) {
    const maxUses = Math.max(0, Number(p.maxUses));
    if (maxUses > 0) {
      const usedGlobal = Number(p.usedCountByMonth?.[cur] || 0);

      let reservedCount = 0;
      for (const [dk, rr] of Object.entries(p.reserved || {})) {
        if (rr?.month !== cur) continue;
        if (p.unlimited?.[dk]) continue; // unlimited not counted
        reservedCount++;
      }

      if (usedGlobal + reservedCount >= maxUses) return { ok: false, discountRp: 0 };
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
      info: {
        type: "monthly",
        name: p.name || "PROMO BULANAN",
        percent,
        maxRp,
        requireCode: !!p.requireCode,
        code: p.code || "MONTHLY",
        maxUses: p.maxUses == null ? null : Number(p.maxUses),
      },
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
      maxUses: v.maxUses == null ? null : Number(v.maxUses),
      uses: Number(v.uses || 0),
    },
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp },
  };
}

function applyDiscount({
  db,
  amount,
  deviceId = "",
  deviceKey: deviceKeyIn = "",
  voucherCode = "",
  reserveTtlMs = 6 * 60 * 1000,
}) {
  ensure(db);

  const deviceKey = deviceKeyIn ? String(deviceKeyIn) : getDeviceKey(deviceId || "");
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
  const m = reserveMonthlyPromo(db, finalAmount, deviceKey, voucherCode, reserveTtlMs);
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

  const p = db.promo.monthly;
  for (const r of reservations || []) {
    if (!r || !r.type) continue;

    if (r.type === "monthly") {
      const cur = p.reserved?.[r.deviceKey];
      if (cur && cur.token === r.token) {
        const isUnlimited = !!p.unlimited?.[r.deviceKey];

        // per-device used only if not unlimited
        if (!isUnlimited) {
          p.used[r.deviceKey] = r.month;

          // global counter per month (exclude unlimited)
          p.usedCountByMonth[r.month] = Number(p.usedCountByMonth?.[r.month] || 0) + 1;
        }

        delete p.reserved[r.deviceKey];
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

  if (body.requireCode != null) p.requireCode = !!body.requireCode;
  if (body.code != null) p.code = String(body.code || "MONTHLY").trim().toUpperCase();

  // global maxUses / bulan (null = unlimited)
  if (Object.prototype.hasOwnProperty.call(body, "maxUses")) {
    if (body.maxUses == null || body.maxUses === "") p.maxUses = null;
    else {
      const n = Number(body.maxUses);
      p.maxUses = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
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

  p.updatedAt = new Date().toISOString();
  return p;
}

// reset only current month counters (ADMIN, buat debugging)
function adminResetMonthlyForCurrentMonth(db) {
  ensure(db);
  const p = db.promo.monthly;
  const cur = yyyymm();

  // remove used markers for current month
  for (const [dk, mon] of Object.entries(p.used || {})) {
    if (mon === cur) delete p.used[dk];
  }
  // clear reserved current month
  for (const [dk, r] of Object.entries(p.reserved || {})) {
    if (r?.month === cur) delete p.reserved[dk];
  }
  // reset global count current month
  if (p.usedCountByMonth) delete p.usedCountByMonth[cur];

  p.updatedAt = new Date().toISOString();
  return { ok: true, month: cur };
}

// ====== TX store ops (simple) ======
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

// ====== HELP / TUTOR ======
function help() {
  return {
    success: true,
    service: "levpay-api (single file + GH DB)",
    actions: [
      "ping", "help", "tutor",
      "discount.apply", "discount.commit", "discount.release",
      "voucher.upsert (ADMIN)", "voucher.disable (ADMIN)", "voucher.list (ADMIN)", "voucher.get (ADMIN)",
      "monthly.get (ADMIN)", "monthly.set (ADMIN)", "monthly.resetMonth (ADMIN)",
      "tx.upsert (ADMIN)", "tx.get (ADMIN)", "tx.list (ADMIN)", "tx.search (ADMIN)", "tx.clear (ADMIN)",
      "paidhook",
    ],
    admin: { header: "X-Admin-Key", requiredFor: ["voucher.*", "monthly.*", "tx.*"] },
    githubDb: {
      requiredEnv: ["GH_OWNER", "GH_REPO", "GH_PATH", "GH_BRANCH", "GH_TOKEN"],
      usingGH: hasGH(),
      path: GH_PATH,
      branch: GH_BRANCH,
    },
  };
}

function tutor() {
  return {
    success: true,
    note: "Copy-paste contoh curl berikut. Set $HOST dan $ADMIN dulu.",
    examples: {
      ping: `curl -sS "$HOST/api/levpay?action=ping" | jq`,
      apply: `curl -sS -X POST "$HOST/api/levpay?action=discount.apply" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":10000,"deviceId":"dev_frontend_1","voucher":"VIPL"}' | jq`,
      commit: `curl -sS -X POST "$HOST/api/levpay?action=discount.commit" \\
  -H "Content-Type: application/json" \\
  -d '{"reservations":[/* dari response apply */]}' | jq`,
      voucherUpsert: `curl -sS -X POST "$HOST/api/levpay?action=voucher.upsert" \\
  -H "X-Admin-Key: $ADMIN" -H "Content-Type: application/json" \\
  -d '{"code":"VIPL","enabled":true,"name":"VIP LEVEL","percent":90,"maxRp":0,"maxUses":999,"expiresAt":null}' | jq`,
      monthlySet: `curl -sS -X POST "$HOST/api/levpay?action=monthly.set" \\
  -H "X-Admin-Key: $ADMIN" -H "Content-Type: application/json" \\
  -d '{"enabled":true,"name":"PROMO BULANAN","percent":5,"maxRp":2000,"maxUses":100,"requireCode":false,"code":"MONTHLY"}' | jq`,
      addUnlimited: `curl -sS -X POST "$HOST/api/levpay?action=monthly.set" \\
  -H "X-Admin-Key: $ADMIN" -H "Content-Type: application/json" \\
  -d '{"addUnlimitedDeviceKey":"<64hex deviceKey>"}' | jq`,
    },
  };
}

// ====== MAIN HANDLER ======
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  const body = await readBody(req);

  // db
  const db = await readDB();

  if (!action || action === "help") return send(res, 200, help());
  if (action === "tutor") return send(res, 200, tutor());
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

      const r = applyDiscount({
        db,
        amount,
        deviceId,
        voucherCode: voucher,
        reserveTtlMs: Number(body.reserveTtlMs || 6 * 60 * 1000),
      });

      await writeDB(db, "discount.apply (reserve)");

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
      await writeDB(db, "discount.commit");
      return send(res, 200, { success: true, data: { committed: reservations.length } });
    }

    if (action === "discount.release" || action === "release") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      releaseReservations(db, reservations);
      await writeDB(db, "discount.release");
      return send(res, 200, { success: true, data: { released: reservations.length } });
    }

    // ===== VOUCHER (ADMIN) =====
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = adminUpsertVoucher(db, body || {});
        await writeDB(db, "voucher.upsert");
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.disable") {
        const out = adminDisableVoucher(db, body || {});
        await writeDB(db, "voucher.disable");
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""))
        );
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "").trim().toUpperCase();
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
        const p = db.promo.monthly;
        return send(res, 200, {
          success: true,
          data: {
            ...p,
            stats: monthlyStats(db),
            unlimitedKeys: Object.keys(p.unlimited || {}),
          },
        });
      }

      if (action === "monthly.set") {
        const out = adminSetMonthlyPromo(db, body || {});
        await writeDB(db, "monthly.set");
        return send(res, 200, {
          success: true,
          data: {
            ...out,
            stats: monthlyStats(db),
            unlimitedKeys: Object.keys(out.unlimited || {}),
          },
        });
      }

      if (action === "monthly.resetMonth") {
        const out = adminResetMonthlyForCurrentMonth(db);
        await writeDB(db, "monthly.resetMonth");
        return send(res, 200, { success: true, data: out });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // ===== TX (ADMIN) =====
    if (action.startsWith("tx.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "tx.upsert") {
        const out = txUpsert(db, body || {});
        await writeDB(db, "tx.upsert");
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
        await writeDB(db, "tx.clear");
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
        await writeDB(db, "paidhook");
      }

      return send(res, 200, { success: true, data: { received: true, idTransaksi: id || null } });
    }

    return send(res, 404, {
      success: false,
      error: "Unknown action",
      hint:
        "use action=discount.apply|discount.commit|discount.release|voucher.*|monthly.*|tx.*|paidhook|help|ping|tutor",
    });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};