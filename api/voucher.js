// api/voucher.js
const { loadDb, saveDb } = require("../lib/github");
const {
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
} = require("../lib/voucher");

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

function isAdmin(req) {
  const k = String(req.headers["x-admin-key"] || "").trim();
  const ADMIN_KEY = String(process.env.ADMIN_KEY || "");
  return !!ADMIN_KEY && !!k && k === ADMIN_KEY;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;

  if (!isAdmin(req)) {
    return json(res, 401, { success: false, error: "unauthorized" });
  }

  const action = String(req.query?.action || "").toLowerCase().trim();

  try {
    const db = await loadDb();

    if (req.method === "POST" && action === "upsert") {
      const v = adminUpsertVoucher(db, req.body || {});
      await saveDb(db);
      return json(res, 200, { success: true, data: v });
    }

    if (req.method === "POST" && action === "disable") {
      const v = adminDisableVoucher(db, req.body || {});
      await saveDb(db);
      return json(res, 200, { success: true, data: v });
    }

    // optional: set promo bulanan (kalau butuh)
    if (req.method === "POST" && action === "monthly") {
      const p = adminSetMonthlyPromo(db, req.body || {});
      await saveDb(db);
      return json(res, 200, { success: true, data: p });
    }

    if (req.method === "GET" && action === "list") {
      // list voucher custom
      const list = Object.values(db.vouchers || {});
      return json(res, 200, { success: true, data: list });
    }

    return json(res, 404, { success: false, error: "unknown action", hint: "action=upsert|disable|list|monthly" });
  } catch (e) {
    return json(res, 500, { success: false, error: e?.message || "error" });
  }
};
