const { loadDb, saveDb } = require("../../lib/store");
const { upsertTx } = require("../../lib/tx");
const { requireCallback, bad, ok, readJson } = require("../../lib/auth");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return ok(res, { ok: true });

  if (!requireCallback(req)) return bad(res, 401, "unauthorized");
  if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

  try {
    const body = await readJson(req);
    const db = await loadDb();
    const saved = upsertTx(db, body);
    await saveDb(db);
    return ok(res, saved);
  } catch (e) {
    return bad(res, 500, e?.message || "server error");
  }
};
