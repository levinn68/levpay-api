// api/levpay.js (Vercel SINGLE-FILE ROUTER) — FINAL (GH DB + monthly maxUses)
// Endpoints via query action:
// - /api/levpay?action=ping | help | tutor
// - /api/levpay?action=discount.apply|discount.commit|discount.release
// - /api/levpay?action=voucher.upsert|voucher.disable|voucher.list|voucher.get
// - /api/levpay?action=monthly.get|monthly.set
// - /api/levpay?action=tx.upsert|tx.get|tx.list|tx.search|tx.clear
// - /api/levpay?action=paidhook
//
// Notes:
// - Admin endpoints require header: X-Admin-Key: <ADMIN_KEY>
// - DB stored in GitHub repo file (GH_* env). Fallback /tmp if GH missing.
// - Monthly promo: 1× / device / month + OPTIONAL global maxUses per month (set via admin page)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ====== CONFIG ======

// Fallback local tmp DB (dipakai kalau GH tidak di-setup / error)
const TMP_DB_PATH = path.join("/tmp", "levpay-db.json");

// Admin key untuk ADMIN endpoints (voucher/monthly/tx admin ops)
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";

// Secret optional buat callback/hook (kalau lu mau proteksi paidhook)
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || ""; // kosong = off

// Pepper buat bikin deviceKey (monthly promo tracking)
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "ISI_PEPPER";

// === GitHub DB storage (WAJIB GH_*, bukan GITHUB_*) ===
// Repo yang nyimpen JSON db, mis: owner=db-levpay, repo=db-levpay, path=levpay-db.json
const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_PATH = process.env.GH_PATH || "levpay-db.json";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_TOKEN = process.env.GH_TOKEN || ""; // PAT / Fine-grained token
const GH_COMMITTER_NAME = process.env.GH_COMMITTER_NAME || "levpay-bot";
const GH_COMMITTER_EMAIL = process.env.GH_COMMITTER_EMAIL || "levpay-bot@users.noreply.github.com";

// DeviceKey yang unlimited (bypass limit promo bulanan)
// MASUKIN HASIL SHA256(deviceId + "|" + DEVICE_PEPPER) via env (comma separated)
const UNLIMITED_DEVICE_KEYS = new Set(
  String(process.env.UNLIMITED_DEVICE_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

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

function getDeviceKey(deviceId, pepper = DEVICE_PEPPER) {
  return crypto
    .createHash("sha256")
    .update(String(deviceId || "") + "|" + String(pepper || ""))
    .digest("hex");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // vercel biasanya udah parse
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

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function tmpReadDB() {
  try {
    if (!fs.existsSync(TMP_DB_PATH)) return {};
    const raw = fs.readFileSync(TMP_DB_PATH, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function tmpWriteDB(db) {
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ====== GitHub DB helpers ======
function ghEnabled() {
  return !!(GH_OWNER && GH_REPO && GH_PATH && GH_TOKEN);
}

async function ghRequest(url, { method = "GET", headers = {}, body } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      "User-Agent": "levpay-api",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...headers,
    },
    body,
  });
  const txt = await r.text();
  const json = safeJsonParse(txt);
  return { ok: r.ok, status: r.status, json, raw: txt };
}

async function ghReadFile() {
  // GET /repos/{owner}/{repo}/contents/{path}?ref=branch
  const url =
    `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
      GH_REPO
    )}/contents/${encodeURIComponent(GH_PATH)}` + `?ref=${encodeURIComponent(GH_BRANCH)}`;

  const r = await ghRequest(url, { method: "GET" });
  if (!r.ok) return { ok: false, status: r.status, error: r.json?.message || "gh read failed" };

  const contentB64 = r.json?.content || "";
  const sha = r.json?.sha || "";
  const buf = Buffer.from(String(contentB64).replace(/\n/g, ""), "base64");
  const raw = buf.toString("utf8");
  const db = safeJsonParse(raw);
  return { ok: true, status: 200, db, sha };
}

async function ghWriteFile(db, prevSha) {
  // PUT /repos/{owner}/{repo}/contents/{path}
  const url = `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
    GH_REPO
  )}/contents/${encodeURIComponent(GH_PATH)}`;

  const content = Buffer.from(JSON.stringify(db, null, 2), "utf8").toString("base64");
  const payload = {
    message: `levpay db update ${new Date().toISOString()}`,
    content,
    branch: GH_BRANCH,
    committer: { name: GH_COMMITTER_NAME, email: GH_COMMITTER_EMAIL },
    sha: prevSha || undefined,
  };

  const r = await ghRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    return { ok: false, status: r.status, error: r.json?.message || "gh write failed", raw: r.raw };
  }
  return { ok: true, status: 200, sha: r.json?.content?.sha || prevSha || "" };
}

// ====== DB init / ensure ======
function ensure(db) {
  db.vouchers = db.vouchers || {};
  db.promo = db.promo || {};
  db.tx = db.tx || {};

  // monthly promo config + usage tracking
  // - used: { deviceKey: "YYYYMM" }  (per-device 1× per month)
  // - reserved: { deviceKey: {token,month,expiresAt,discountRp} }
  // - unlimited: { deviceKey: true }
  // - maxUses: optional global limit per month (null=unlimited)
  // - usageByMonth: { YYYYMM: number }  (global count per month)
  db.promo.monthly =
    db.promo.monthly || {
      enabled: true,
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
      maxUses: null, // ✅ NEW: global limit per month (admin configurable)
      used: {},
      reserved: {},
      unlimited: {},
      usageByMonth: {}, // ✅ NEW
      updatedAt: null,
    };

  db.promo.monthly.used = db.promo.monthly.used || {};
  db.promo.monthly.reserved = db.promo.monthly.reserved || {};
  db.promo.monthly.unlimited = db.promo.monthly.unlimited || {};
  db.promo.monthly.usageByMonth = db.promo.monthly.usageByMonth || {};

  // seed unlimited keys from env
  for (const k of UNLIMITED_DEVICE_KEYS) db.promo.monthly.unlimited[k] = true;

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

function canUseMonthlyGlobal(db, monthKey) {
  ensure(db);
  const p = db.promo.monthly;
  const maxUses = p.maxUses == null ? null : Number(p.maxUses);
  if (maxUses == null) return true;
  if (!Number.isFinite(maxUses) || maxUses <= 0) return false;

  const used = Number(p.usageByMonth?.[monthKey] || 0);
  return used < maxUses;
}

function reserveMonthlyPromo(db, amount, deviceKey, ttlMs) {
  ensure(db);
  cleanupExpiredReservations(db);

  const p = db.promo.monthly;
  if (!p.enabled) return { ok: false, discountRp: 0, reason: "monthly disabled" };

  const cur = yyyymm();
  const isUnlimited = !!(p.unlimited && p.unlimited[deviceKey]);

  // ✅ global maxUses per month check (skip for unlimited)
  if (!isUnlimited && !canUseMonthlyGlobal(db, cur)) {
    return { ok: false, discountRp: 0, reason: "monthly global limit reached" };
  }

  const lastUsed = p.used[deviceKey] || "";
  if (!isUnlimited && lastUsed === cur) return { ok: false, discountRp: 0, reason: "device already used this month" };

  // kalau sudah reserved bulan ini -> jangan kasih lagi sampai expired
  const rsv = p.reserved[deviceKey];
  if (rsv && rsv.month === cur) return { ok: false, discountRp: 0, reason: "already reserved" };

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
      info: { type: "monthly", name: p.name || "PROMO BULANAN", percent, maxRp, maxUses: p.maxUses ?? null },
      reservation: { type: "monthly", deviceKey, token: t, month: cur, expiresAt, discountRp },
    };
  }

  return { ok: false, discountRp: 0, reason: "no discount" };
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
      maxUses: v.maxUses ?? null,
      expiresAt: v.expiresAt || null,
    },
    reservation: { type: "voucher", code, token: t, expiresAt, discountRp },
  };
}

function applyDiscount({ db, amount, deviceId, voucherCode, reserveTtlMs = 6 * 60 * 1000 }) {
  ensure(db);

  const deviceKey = getDeviceKey(deviceId || "");
  const amountOriginal = Number(amount || 0);

  let finalAmount = amountOriginal;
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

  return {
    amountOriginal,
    finalAmount,
    discountRp,
    applied,
    reservations,
    deviceKey,
  };
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
        // mark device used for month
        db.promo.monthly.used[r.deviceKey] = r.month;
        delete db.promo.monthly.reserved[r.deviceKey];

        // ✅ increment global usage for that month (except unlimited)
        const isUnlimited = !!db.promo.monthly.unlimited?.[r.deviceKey];
        if (!isUnlimited) {
          const k = String(r.month || yyyymm());
          db.promo.monthly.usageByMonth[k] = Number(db.promo.monthly.usageByMonth[k] || 0) + 1;
        }
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

  // ✅ NEW: global maxUses per month (null=unlimited)
  if (Object.prototype.hasOwnProperty.call(body, "maxUses")) {
    if (body.maxUses == null || body.maxUses === "" || body.maxUses === 0) {
      p.maxUses = null;
    } else {
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

  // optional admin ops: reset month usage (global)
  if (body.resetMonth != null) {
    const mk = String(body.resetMonth).trim();
    if (mk && p.usageByMonth) delete p.usageByMonth[mk];
  }

  p.updatedAt = new Date().toISOString();
  return p;
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
    service: "levpay-api (single file, GH DB)",
    storage: ghEnabled()
      ? { type: "github", owner: GH_OWNER, repo: GH_REPO, path: GH_PATH, branch: GH_BRANCH }
      : { type: "tmp", path: TMP_DB_PATH },
    paths: {
      recommended: "/api/levpay?action=...",
    },
    actions: [
      "ping",
      "help",
      "tutor",

      "discount.apply",
      "discount.commit",
      "discount.release",

      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",

      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",

      "tx.upsert (ADMIN)",
      "tx.get (ADMIN)",
      "tx.list (ADMIN)",
      "tx.search (ADMIN)",
      "tx.clear (ADMIN)",

      "paidhook",
    ],
    admin: {
      header: "X-Admin-Key",
      requiredFor: ["voucher.*", "monthly.*", "tx.*"],
    },
  };
}

function tutor() {
  const HOST = "$HOST";
  const ADMIN = "$ADMIN";
  return {
    success: true,
    tutor: {
      ping: {
        curl: `curl -sS "${HOST}/api/levpay?action=ping" | jq`,
        response: { success: true, ok: true, time: "2025-01-01T00:00:00.000Z" },
      },
      discount_apply: {
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=discount.apply" \\\n` +
          `  -H "Content-Type: application/json" \\\n` +
          `  -d '{"amount":10000,"deviceId":"dev_termux_1","voucher":"VIPL"}' | jq`,
        response: {
          success: true,
          data: {
            amountOriginal: 10000,
            finalAmount: 9000,
            discountRp: 1000,
            applied: [{ type: "voucher", code: "VIPL", name: "VIPL", percent: 10, maxRp: 0 }],
            reservations: [],
            deviceKey: "sha256...",
          },
        },
      },
      voucher_upsert: {
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.upsert" \\\n` +
          `  -H "X-Admin-Key: ${ADMIN}" \\\n` +
          `  -H "Content-Type: application/json" \\\n` +
          `  -d '{"code":"VIPL","enabled":true,"name":"VIP LEVEL","percent":10,"maxRp":0,"maxUses":100,"expiresAt":"2026-12-31T23:59:59.000Z"}' | jq`,
        response: { success: true, data: { code: "VIPL", enabled: true } },
      },
      voucher_disable: {
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=voucher.disable" \\\n` +
          `  -H "X-Admin-Key: ${ADMIN}" \\\n` +
          `  -H "Content-Type: application/json" \\\n` +
          `  -d '{"code":"VIPL"}' | jq`,
        response: { success: true, data: { code: "VIPL", enabled: false } },
      },
      monthly_set: {
        curl:
          `curl -sS -X POST "${HOST}/api/levpay?action=monthly.set" \\\n` +
          `  -H "X-Admin-Key: ${ADMIN}" \\\n` +
          `  -H "Content-Type: application/json" \\\n` +
          `  -d '{"enabled":true,"name":"PROMO BULANAN","percent":5,"maxRp":2000,"maxUses":500}' | jq`,
        response: { success: true, data: { enabled: true, maxUses: 500 } },
      },
    },
  };
}

// ====== Storage orchestrator ======
async function loadDB() {
  if (ghEnabled()) {
    const r = await ghReadFile();
    if (r.ok) return { db: ensure(r.db), meta: { mode: "github", sha: r.sha } };
    // fallback to tmp when GH read fails
    const db = ensure(tmpReadDB());
    return { db, meta: { mode: "tmp", sha: "" }, warn: `GH read failed: ${r.error || r.status}` };
  }

  const db = ensure(tmpReadDB());
  return { db, meta: { mode: "tmp", sha: "" } };
}

async function saveDB(db, meta) {
  if (meta?.mode === "github" && ghEnabled()) {
    const w = await ghWriteFile(db, meta.sha);
    if (w.ok) return { ok: true, mode: "github", sha: w.sha };
    // fallback to tmp
    tmpWriteDB(db);
    return { ok: false, mode: "tmp", error: `GH write failed: ${w.error || w.status}` };
  }

  tmpWriteDB(db);
  return { ok: true, mode: "tmp" };
}

// ====== MAIN HANDLER ======
module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  // body
  const body = await readBody(req);

  // db
  const loaded = await loadDB();
  const db = loaded.db;
  const meta = loaded.meta;

  // ping/help/tutor
  if (!action || action === "help") return send(res, 200, help());
  if (action === "tutor") return send(res, 200, tutor());
  if (action === "ping")
    return send(res, 200, {
      success: true,
      ok: true,
      time: new Date().toISOString(),
      storage: meta?.mode || "tmp",
      warn: loaded.warn || null,
    });

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

      const saved = await saveDB(db, meta);

      return send(res, 200, {
        success: true,
        data: {
          amountOriginal: r.amountOriginal,
          finalAmount: r.finalAmount,
          discountRp: r.discountRp,
          applied: r.applied,
          reservations: r.reservations,
          deviceKey: r.deviceKey,
          monthly: {
            month: yyyymm(),
            maxUses: db.promo.monthly.maxUses ?? null,
            usedCountThisMonth: Number(db.promo.monthly.usageByMonth?.[yyyymm()] || 0),
          },
        },
        storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
        warn: loaded.warn || null,
      });
    }

    if (action === "discount.commit" || action === "commit") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      commitReservations(db, reservations);
      const saved = await saveDB(db, meta);

      return send(res, 200, {
        success: true,
        data: {
          committed: reservations.length,
          monthly: {
            month: yyyymm(),
            maxUses: db.promo.monthly.maxUses ?? null,
            usedCountThisMonth: Number(db.promo.monthly.usageByMonth?.[yyyymm()] || 0),
          },
        },
        storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
        warn: loaded.warn || null,
      });
    }

    if (action === "discount.release" || action === "release") {
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];
      releaseReservations(db, reservations);
      const saved = await saveDB(db, meta);

      return send(res, 200, {
        success: true,
        data: { released: reservations.length },
        storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
        warn: loaded.warn || null,
      });
    }

    // ===== VOUCHER (ADMIN) =====
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = adminUpsertVoucher(db, body || {});
        const saved = await saveDB(db, meta);
        return send(res, 200, {
          success: true,
          data: out,
          storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
          warn: loaded.warn || null,
        });
      }

      if (action === "voucher.disable") {
        const out = adminDisableVoucher(db, body || {});
        const saved = await saveDB(db, meta);
        return send(res, 200, {
          success: true,
          data: out,
          storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
          warn: loaded.warn || null,
        });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""))
        );
        return send(res, 200, { success: true, data: items, warn: loaded.warn || null });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "")
          .trim()
          .toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v, warn: loaded.warn || null });
      }

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // ===== MONTHLY (ADMIN) =====
    if (action.startsWith("monthly.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "monthly.get") {
        cleanupExpiredReservations(db);
        const cur = yyyymm();
        const usedCountThisMonth = Number(db.promo.monthly.usageByMonth?.[cur] || 0);
        return send(res, 200, {
          success: true,
          data: {
            ...db.promo.monthly,
            month: cur,
            usedCountThisMonth,
          },
          warn: loaded.warn || null,
        });
      }

      if (action === "monthly.set") {
        const out = adminSetMonthlyPromo(db, body || {});
        const saved = await saveDB(db, meta);
        const cur = yyyymm();
        const usedCountThisMonth = Number(db.promo.monthly.usageByMonth?.[cur] || 0);
        return send(res, 200, {
          success: true,
          data: { ...out, month: cur, usedCountThisMonth },
          storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
          warn: loaded.warn || null,
        });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // ===== TX (ADMIN) =====
    if (action.startsWith("tx.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "tx.upsert") {
        const out = txUpsert(db, body || {});
        const saved = await saveDB(db, meta);
        return send(res, 200, {
          success: true,
          data: out,
          storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
          warn: loaded.warn || null,
        });
      }

      if (action === "tx.get") {
        const id = String(body.idTransaksi || url.searchParams.get("idTransaksi") || "").trim();
        if (!id) return send(res, 400, { success: false, error: "idTransaksi required" });
        const out = txGet(db, id);
        if (!out) return send(res, 404, { success: false, error: "not found" });
        return send(res, 200, { success: true, data: out, warn: loaded.warn || null });
      }

      if (action === "tx.list") {
        const limit = Number(body.limit || url.searchParams.get("limit") || 200);
        const out = txList(db, limit);
        return send(res, 200, { success: true, data: out, warn: loaded.warn || null });
      }

      if (action === "tx.search") {
        const q = body.q || url.searchParams.get("q") || "";
        const out = txSearch(db, q);
        return send(res, 200, { success: true, data: out, warn: loaded.warn || null });
      }

      if (action === "tx.clear") {
        txClear(db);
        const saved = await saveDB(db, meta);
        return send(res, 200, {
          success: true,
          data: { cleared: true },
          storage: { mode: saved.mode, ok: saved.ok, error: saved.error || null },
          warn: loaded.warn || null,
        });
      }

      return send(res, 400, { success: false, error: "Unknown tx action" });
    }

    // ===== PAIDHOOK (optional secret) =====
    if (action === "paidhook") {
      if (!checkCallbackSecret(req)) return send(res, 401, { success: false, error: "bad secret" });

      // simpan minimal ke tx store (kalau ada idTransaksi)
      const id = String(body.idTransaksi || body.id || "").trim();
      if (id) {
        txUpsert(db, { ...body, idTransaksi: id });
        await saveDB(db, meta);
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