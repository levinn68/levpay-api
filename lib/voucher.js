// api/orkut.js — FINAL
// Proxy ke VPS_BASE + apply discount dari /api/levpay db (GH)
// Balikin pricing biar frontend kepotong beneran.

const { loadDb, saveDb } = require("../lib/store"); // kalau repo lu punya lib/store.js
const { applyDiscount } = require("../lib/voucher"); // kalau repo lu punya lib/voucher.js

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

async function readBody(req) {
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

function pickIdTrx(up) {
  // support banyak shape biar gak "missing idTransaksi" lagi
  return (
    up?.data?.idTransaksi ||
    up?.data?.idtrx ||
    up?.data?.idTrx ||
    up?.idTransaksi ||
    up?.idtrx ||
    up?.idTrx ||
    null
  );
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();
  const body = await readBody(req);

  // VPS base (INI YANG LU MAU)
  const VPS_BASE = String(process.env.VPS_BASE || process.env.ORKUT_BASE || "").trim(); // contoh: http://193.23.209.47:7032
  const VPS_ADMIN_KEY = String(process.env.VPS_ADMIN_KEY || process.env.ADMIN_KEY || "").trim();

  if (!VPS_BASE) {
    return send(res, 500, { success: false, error: "VPS_BASE not set (env VPS_BASE)" });
  }

  // ===== createqr =====
  if (action === "createqr") {
    const amount = Number(body.amount);
    const deviceId = String(body.deviceId || body.deviceid || "").trim();
    const code = String(body.voucher || body.code || body.vouccer || "").trim(); // voucher/promo code

    if (!Number.isFinite(amount) || amount < 1) {
      return send(res, 400, { success: false, error: "amount invalid" });
    }
    if (!deviceId) {
      return send(res, 400, { success: false, error: "deviceId required" });
    }

    // load DB (same with admin)
    const db = await loadDb().catch(() => ({}));

    // apply discount (IMPORTANT)
    const r = applyDiscount({
      db,
      amount,
      deviceId,
      voucherCode: code,
      reserveTtlMs: 6 * 60 * 1000,
    });

    await saveDb(db).catch(() => {});

    // call VPS createqr
    const endpoint = `${VPS_BASE.replace(/\/+$/, "")}/api/orkut?action=createqr`;
    const payload = {
      amount: r.finalAmount, // <=== INI YANG BIKIN QR NOMINAL NYA UDAH KEPOTONG
      deviceId,
      voucher: code || "",
      theme: body.theme || "levpay",
    };

    const headers = { "Content-Type": "application/json" };
    if (VPS_ADMIN_KEY) headers["X-Admin-Key"] = VPS_ADMIN_KEY;

    let upStatus = 0;
    let upJson = null;
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      upStatus = resp.status;
      const txt = await resp.text().catch(() => "");
      try {
        upJson = txt ? JSON.parse(txt) : {};
      } catch {
        upJson = { raw: txt };
      }
    } catch (e) {
      return send(res, 502, { success: false, error: `VPS unreachable: ${e?.message || e}` });
    }

    // if upstream returns success:false but HTTP 200, treat as error
    if (upJson?.success === false) {
      return send(res, 502, { success: false, error: upJson?.error || "Upstream createqr failed" });
    }
    if (upStatus < 200 || upStatus >= 300) {
      return send(res, 502, { success: false, error: `Upstream HTTP ${upStatus}`, up: upJson });
    }

    const idTransaksi = pickIdTrx(upJson);
    if (!idTransaksi) {
      return send(res, 502, {
        success: false,
        error: "Upstream createqr schema mismatch (missing idTransaksi)",
        up: upJson,
      });
    }

    const createdAt = upJson?.data?.createdAt || upJson?.createdAt || new Date().toISOString();
    const expiredAt = upJson?.data?.expiredAt || upJson?.expiredAt || null;

    return send(res, 200, {
      success: true,
      data: {
        idTransaksi,
        status: "PENDING",
        amountOriginal: amount,
        amountFinal: r.finalAmount,
        discountRp: r.discountRp,
        promoApplied: r.applied || [],
        reservations: r.reservations || [],
        deviceId,
        voucher: code || null,

        // passthrough QR data if exists
        qrString: upJson?.data?.qrString || upJson?.qrString || null,
        createdAt,
        expiredAt,

        // IMPORTANT for frontend
        pricing: {
          amountOriginal: amount,
          amountFinal: r.finalAmount,
          discountRp: r.discountRp,
          applied: r.applied || [],
        },
      },
    });
  }

  // default
  return send(res, 404, { success: false, error: "Unknown action" });
};