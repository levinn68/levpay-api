const { loadDb, saveDb } = require("../lib/store");
const { upsertTx } = require("../lib/tx");
const { requireCallback, bad, ok, readJson } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return ok(res, { ok: true });

  if (!requireCallback(req)) return bad(res, 401, "unauthorized");
  if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

  try {
    const body = await readJson(req);

    // body dari VPS: idTransaksi, deviceId, status, paidAt, paidVia, note, amountOriginal, amountFinal, discountRp, voucher, applied
    const db = await loadDb();
    const saved = upsertTx(db, {
      ...body,
      lastUpdateAt: new Date().toISOString(),
    });
    await saveDb(db);

    return ok(res, { received: true, idTransaksi: saved.idTransaksi, status: saved.status });
  } catch (e) {
    return bad(res, 500, e?.message || "server error");
  }
};
