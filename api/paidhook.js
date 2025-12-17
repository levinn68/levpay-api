// api/paidhook.js
// CommonJS (aman buat Node 20 di Vercel tanpa "type":"module")

const { kv } = require("@vercel/kv");

const ALLOWED = new Set(["paid", "expired", "cancelled", "failed", "pending"]);

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Callback-Secret");
}

function safeParseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

function toIsoOrNull(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

module.exports = async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { success: false, error: "Method Not Allowed" });

  // ✅ verify secret (harus sama dengan yang VPS kirim)
  const SECRET = String(process.env.CALLBACK_SECRET || "").trim();
  const got = String(req.headers["x-callback-secret"] || "").trim();

  if (SECRET) {
    if (!got || got !== SECRET) {
      return json(res, 401, { success: false, error: "Unauthorized (bad secret)" });
    }
  }

  const body = safeParseBody(req);

  const idTransaksi = String(body.idTransaksi || "").trim();
  const status = String(body.status || "").trim().toLowerCase();

  if (!idTransaksi) return json(res, 400, { success: false, error: "idTransaksi required" });
  if (!ALLOWED.has(status)) return json(res, 400, { success: false, error: "invalid status" });

  // normalize fields (ngikut payload dari VPS)
  const nowIso = new Date().toISOString();

  const rec = {
    idTransaksi,
    status,

    paidAt: toIsoOrNull(body.paidAt) || (status === "paid" ? nowIso : null),
    paidVia: body.paidVia ? String(body.paidVia).trim() : null,
    note: body.note ? String(body.note).trim() : null,

    amountOriginal: Number.isFinite(Number(body.amountOriginal)) ? Number(body.amountOriginal) : null,
    amountFinal: Number.isFinite(Number(body.amountFinal)) ? Number(body.amountFinal) : null,
    discountRp: Number.isFinite(Number(body.discountRp)) ? Number(body.discountRp) : 0,

    voucher: body.voucher ? String(body.voucher).trim() : null,
    applied: Array.isArray(body.applied) ? body.applied : [],

    createdAt: toIsoOrNull(body.createdAt) || null,
    expiredAt: toIsoOrNull(body.expiredAt) || null,

    updatedAt: nowIso,
  };

  // timestamp buat urutan history
  const tsMs =
    Date.parse(rec.paidAt || rec.updatedAt || nowIso) ||
    Date.now();

  try {
    // 1) simpan record by id (overwrite update)
    await kv.set(`tx:${idTransaksi}`, rec);

    // 2) history: sorted set by time (urutan rapi)
    await kv.zadd("tx:history", { score: tsMs, member: idTransaksi });

    // 3) simpan latest pointer (opsional)
    await kv.set("tx:last", { idTransaksi, status, ts: tsMs });

    return json(res, 200, { success: true, data: { idTransaksi, status } });
  } catch (e) {
    return json(res, 500, { success: false, error: "kv_write_failed", message: String(e?.message || e) });
  }
};
