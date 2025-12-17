const { loadDb: ghLoadDb, saveDb: ghSaveDb } = require("./github");

let kv = null;
try {
  // optional: kalau lu install @vercel/kv + env KV_REST_API_URL & KV_REST_API_TOKEN
  kv = require("@vercel/kv").kv;
} catch {}

const KV_OK = !!(
  kv &&
  process.env.KV_REST_API_URL &&
  process.env.KV_REST_API_TOKEN
);

const KV_KEY = process.env.KV_KEY || "levpay:db";

async function loadDb() {
  if (KV_OK) {
    const v = await kv.get(KV_KEY);
    const db = typeof v === "string" ? safeJson(v) : (v || {});
    db.vouchers = db.vouchers || {};
    db.promo = db.promo || {};
    db.tx = db.tx || {};
    return db;
  }
  return ghLoadDb();
}

async function saveDb(db) {
  if (KV_OK) {
    const copy = { ...db };
    delete copy._sha; // irrelevant kalau KV
    await kv.set(KV_KEY, copy);
    return true;
  }
  return ghSaveDb(db);
}

function safeJson(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

module.exports = { loadDb, saveDb, KV_OK };
