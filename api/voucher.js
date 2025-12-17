const { loadDb, saveDb } = require("../lib/store");
const {
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
} = require("../lib/voucher");

const { requireCallback, requireAdmin, bad, ok, parseUrl, readJson } = require("../lib/auth");

module.exports = async (req, res) => {
  const u = parseUrl(req);
  const action = String(u.searchParams.get("action") || "").toLowerCase().trim();

  if (req.method === "OPTIONS") return ok(res, { ok: true });

  try {
    // ===== apply/commit/release dipanggil VPS => wajib callback secret
    if (action === "apply") {
      if (!requireCallback(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const amount = Number(body.amount || 0);
      const deviceId = String(body.deviceId || "").trim();
      const voucher = String(body.voucher || body.voucherCode || "").trim();
      const reserveTtlMs = body.reserveTtlMs != null ? Number(body.reserveTtlMs) : 6 * 60 * 1000;

      if (!deviceId) return bad(res, 400, "deviceId required");
      if (!Number.isFinite(amount) || amount < 1) return bad(res, 400, "amount invalid");

      const db = await loadDb();
      const deviceKey = getDeviceKey(deviceId, process.env.DEVICE_PEPPER || "");

      const out = applyDiscount({
        db,
        amount,
        deviceKey,
        voucherCode: voucher,
        reserveTtlMs,
      });

      // simpan reserved state
      await saveDb(db);

      const amountFinal = Number(out.finalAmount ?? amount);
      const discountRp = Number(out.discountRp ?? 0);
      const applied = Array.isArray(out.applied) ? out.applied : [];
      const reservations = Array.isArray(out.reservations) ? out.reservations : [];

      return ok(res, {
        amountFinal,
        discountRp,
        applied,
        reservations,
        voucher: voucher ? voucher.trim().toUpperCase() : null,
      });
    }

    if (action === "commit") {
      if (!requireCallback(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];

      const db = await loadDb();
      commitReservations(db, reservations);
      await saveDb(db);

      return ok(res, { committed: true });
    }

    if (action === "release") {
      if (!requireCallback(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const reservations = Array.isArray(body.reservations) ? body.reservations : [];

      const db = await loadDb();
      releaseReservations(db, reservations);
      await saveDb(db);

      return ok(res, { released: true });
    }

    // ===== admin upsert/disable/monthly => wajib admin key
    if (action === "upsert") {
      if (!requireAdmin(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const db = await loadDb();
      const v = adminUpsertVoucher(db, body);
      await saveDb(db);
      return ok(res, v);
    }

    if (action === "disable") {
      if (!requireAdmin(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const db = await loadDb();
      const v = adminDisableVoucher(db, body);
      await saveDb(db);
      return ok(res, v);
    }

    if (action === "monthly") {
      if (!requireAdmin(req)) return bad(res, 401, "unauthorized");
      if (req.method !== "POST") return bad(res, 405, "Method Not Allowed");

      const body = await readJson(req);
      const db = await loadDb();
      const p = adminSetMonthlyPromo(db, body);
      await saveDb(db);
      return ok(res, p);
    }

    return bad(res, 404, "Unknown action", {
      hint: "use ?action=apply|commit|release|upsert|disable|monthly",
    });
  } catch (e) {
    return bad(res, 500, e?.message || "server error");
  }
};
