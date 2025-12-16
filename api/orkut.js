const axios = require("axios");
const { applyVoucher, requireAdminKey, adminSetPromo, adminListPromos } = require("../lib/voucher");

const VPS_BASE = process.env.VPS_BASE || "http://82.27.2.229:5021";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Callback-Secret, X-Admin-Key");
  res.setHeader("Cache-Control", "no-store");
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function errJson(error) {
  const status = error?.response?.status || 500;
  const data = error?.response?.data || null;
  return { status, data, message: error?.message || "Unknown error" };
}

function requireCallbackSecret(req, res) {
  if (!CALLBACK_SECRET) return true;
  const got =
    (req.headers["x-callback-secret"] || "").toString().trim() ||
    (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  if (got !== CALLBACK_SECRET) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "").toLowerCase().trim();
  const baseUrl = getBaseUrl(req);

  if (!action || action === "ping") {
    return res.status(200).json({
      success: true,
      service: "levpay-vercel-proxy",
      vps: VPS_BASE,
      routes: [
        "POST /api/orkut?action=createqr",
        "GET  /api/orkut?action=status&idTransaksi=...",
        "POST /api/orkut?action=cancel",
        "GET  /api/orkut?action=qr&idTransaksi=...",
        "POST /api/orkut?action=setstatus",
        "POST /api/orkut?action=voucher_preview",
        "POST /api/orkut?action=admin_setpromo  (x-admin-key / Bearer ADMIN_KEY)",
        "GET  /api/orkut?action=admin_listpromo (x-admin-key / Bearer ADMIN_KEY)",
      ],
    });
  }

  // ===== VOUCHER PREVIEW (optional) =====
  // body: { amount, deviceId, voucherCode?, autoMonthly? }
  if (action === "voucher_preview") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 1) {
        return res.status(400).json({ success: false, error: "amount invalid" });
      }

      const deviceId = String(req.body?.deviceId || "");
      const voucherCode = String(req.body?.voucherCode || "");
      const autoMonthly = req.body?.autoMonthly !== false;

      const ip =
        (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "unknown";
      const ua = (req.headers["user-agent"] || "").toString();

      const out = await applyVoucher({ amount, deviceId, ip, ua, voucherCode, autoMonthly });
      return res.status(200).json({ success: true, data: out });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // ===== ADMIN: SET PROMO =====
  if (action === "admin_setpromo") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdminKey(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

    try {
      const { code, type, value, expiresAt, active, maxUses, perDeviceOnce } = req.body || {};
      const r = await adminSetPromo({ code, type, value, expiresAt, active, maxUses, perDeviceOnce });
      return res.status(200).json({ success: true, data: r });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  // ===== ADMIN: LIST PROMO =====
  if (action === "admin_listpromo") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdminKey(req)) return res.status(401).json({ success: false, error: "Unauthorized" });

    try {
      const promos = await adminListPromos();
      return res.status(200).json({ success: true, data: promos });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // ===== CREATE QR (voucher integrated) =====
  if (action === "createqr") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      const amount = Number(req.body?.amount);
      const theme = req.body?.theme === "theme2" ? "theme2" : "theme1";

      if (!Number.isFinite(amount) || amount < 1) {
        return res.status(400).json({ success: false, error: "amount invalid" });
      }

      const deviceId = String(req.body?.deviceId || "");
      const voucherCode = String(req.body?.voucherCode || "");
      const autoMonthly = req.body?.autoMonthly !== false;

      const ip =
        (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "unknown";
      const ua = (req.headers["user-agent"] || "").toString();

      let amountPay = amount;
      let voucherInfo = null;

      if (deviceId || voucherCode) {
        try {
          const v = await applyVoucher({ amount, deviceId, ip, ua, voucherCode, autoMonthly });
          if (v.ok) {
            amountPay = Number(v.amountPay);
            voucherInfo = v;
          }
        } catch {
          // kalau github down, QR tetap jalan tanpa promo
        }
      }

      const r = await axios.post(
        `${VPS_BASE}/api/createqr`,
        { amount: amountPay, theme },
        {
          timeout: 20000,
          validateStatus: () => true,
          headers: { "Content-Type": "application/json" },
        }
      );

      const data = r?.data;

      if (r.status !== 200) {
        return res.status(r.status).json({
          success: false,
          error: "VPS createqr failed",
          provider: data,
        });
      }

      const idTransaksi = data?.data?.idTransaksi || data?.idTransaksi;
      const vpsQrPngUrl =
        data?.data?.qrPngUrl || data?.qrPngUrl || (idTransaksi ? `/api/qr/${idTransaksi}.png` : null);

      const vercelQrUrl = idTransaksi
        ? `${baseUrl}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`
        : null;

      return res.status(200).json({
        ...data,
        data: {
          ...(data?.data || {}),
          idTransaksi,
          qrUrl: vercelQrUrl,
          qrVpsUrl: idTransaksi ? `${VPS_BASE}${vpsQrPngUrl}` : null,

          amountOriginal: amount,
          amountPay,
          voucher: voucherInfo ? voucherInfo.promo : null,
          discount: voucherInfo ? voucherInfo.discount : 0,
        },
      });
    } catch (e) {
      const er = errJson(e);
      return res.status(er.status).json({
        success: false,
        error: er.message,
        provider: er.data,
      });
    }
  }

  // ===== STATUS (GET) =====
  if (action === "status") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    try {
      const r = await axios.get(
        `${VPS_BASE}/api/status?idTransaksi=${encodeURIComponent(idTransaksi)}`,
        { timeout: 15000, validateStatus: () => true }
      );
      return res.status(r.status).json(r.data);
    } catch (e) {
      const er = errJson(e);
      return res.status(er.status).json({ success: false, error: er.message, provider: er.data });
    }
  }

  // ===== CANCEL (POST) =====
  if (action === "cancel") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const idTransaksi = String(req.body?.idTransaksi || req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    try {
      const r = await axios.post(
        `${VPS_BASE}/api/cancel`,
        { idTransaksi },
        { timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
      );
      return res.status(r.status).json(r.data);
    } catch (e) {
      const er = errJson(e);
      return res.status(er.status).json({ success: false, error: er.message, provider: er.data });
    }
  }

  // ===== QR PNG STREAM (GET) =====
  if (action === "qr") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    try {
      const r = await axios({
        method: "GET",
        url: `${VPS_BASE}/api/qr/${encodeURIComponent(idTransaksi)}.png`,
        responseType: "stream",
        timeout: 20000,
        validateStatus: () => true,
      });

      if (r.status !== 200) return res.status(r.status).json({ success: false, error: "QR not found on VPS" });

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return r.data.pipe(res);
    } catch (e) {
      const er = errJson(e);
      return res.status(er.status).json({ success: false, error: er.message, provider: er.data });
    }
  }

  // ===== SET STATUS (POST) =====
  if (action === "setstatus") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireCallbackSecret(req, res)) return;

    const { idTransaksi, status, paidAt, note, paidVia } = req.body || {};
    if (!idTransaksi || !status) return res.status(400).json({ success: false, error: "idTransaksi & status required" });

    try {
      const r = await axios.post(
        `${VPS_BASE}/api/status`,
        { idTransaksi, status, paidAt, note, paidVia },
        { timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
      );
      return res.status(r.status).json(r.data);
    } catch (e) {
      const er = errJson(e);
      return res.status(er.status).json({ success: false, error: er.message, provider: er.data });
    }
  }

  return res.status(404).json({ success: false, error: "Unknown action", hint: "action=createqr|status|cancel|qr|setstatus|voucher_preview|admin_setpromo|admin_listpromo" });
};
