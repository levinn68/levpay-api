const axios = require("axios");
const { loadDb, saveDb } = require("../lib/github");
const {
  getDeviceKey,
  applyDiscount,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
} = require("../lib/voucher");

const VPS_BASE = process.env.VPS_BASE || "http://82.27.2.229:5021";
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DEVICE_PEPPER = process.env.DEVICE_PEPPER || "change_me";

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

function requireSecret(req, res) {
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

function requireAdmin(req, res) {
  if (!ADMIN_KEY) {
    res.status(500).json({ success: false, error: "ADMIN_KEY not set" });
    return false;
  }
  const got =
    (req.headers["x-admin-key"] || "").toString().trim() ||
    (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  if (got !== ADMIN_KEY) {
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
        "POST /api/orkut?action=paidhook",
        "POST /api/orkut?action=admin_upsert_voucher",
        "POST /api/orkut?action=admin_disable_voucher",
        "POST /api/orkut?action=admin_set_monthly_promo",
      ],
    });
  }

  if (action === "createqr") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const amount = Number(req.body?.amount);
    const theme = req.body?.theme === "theme1" ? "theme1" : "theme2";
    const deviceId = String(req.body?.deviceId || "").trim();
    const voucher = String(req.body?.voucher || "").trim();

    if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ success: false, error: "amount invalid" });
    if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });

    const db = await loadDb();
    const deviceKey = getDeviceKey(deviceId, DEVICE_PEPPER);

    const { finalAmount, discountRp, applied } = applyDiscount({
      db,
      amount,
      deviceKey,
      voucherCode: voucher || null,
    });

    const r = await axios.post(
      `${VPS_BASE}/api/createqr`,
      { amount: finalAmount, theme },
      { timeout: 20000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
    );

    const data = r.data;
    if (r.status !== 200) return res.status(r.status).json({ success: false, error: "VPS createqr failed", provider: data });

    const idTransaksi = data?.data?.idTransaksi || data?.idTransaksi;
    const vpsQrPngUrl = data?.data?.qrPngUrl || data?.qrPngUrl || (idTransaksi ? `/api/qr/${idTransaksi}.png` : null);

    db.tx = db.tx || {};
    db.tx[idTransaksi] = {
      idTransaksi,
      deviceKey,
      deviceIdMasked: deviceId.slice(0, 3) + "***",
      amountOriginal: amount,
      amountFinal: finalAmount,
      discountRp,
      applied,
      status: "pending",
      createdAt: new Date().toISOString(),
      paidAt: null,
      paidVia: null,
    };

    await saveDb(db);

    return res.status(200).json({
      ...data,
      data: {
        ...(data?.data || {}),
        idTransaksi,
        qrUrl: `${baseUrl}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`,
        qrVpsUrl: idTransaksi ? `${VPS_BASE}${vpsQrPngUrl}` : null,
        pricing: { amountOriginal: amount, amountFinal: finalAmount, discountRp, applied },
      },
    });
  }

  if (action === "paidhook") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    const { idTransaksi, status, paidAt, paidVia, note } = req.body || {};
    if (!idTransaksi || String(status).toLowerCase() !== "paid") {
      return res.status(400).json({ success: false, error: "idTransaksi & status=paid required" });
    }

    const db = await loadDb();
    db.tx = db.tx || {};
    db.tx[idTransaksi] = db.tx[idTransaksi] || { idTransaksi };

    db.tx[idTransaksi].status = "paid";
    db.tx[idTransaksi].paidAt = paidAt || new Date().toISOString();
    db.tx[idTransaksi].paidVia = paidVia || null;
    if (note) db.tx[idTransaksi].note = String(note);

    await saveDb(db);
    return res.status(200).json({ success: true, saved: true });
  }

  if (action === "status") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    const r = await axios.get(`${VPS_BASE}/api/status?idTransaksi=${encodeURIComponent(idTransaksi)}`, {
      timeout: 15000,
      validateStatus: () => true,
    });
    return res.status(r.status).json(r.data);
  }

  if (action === "cancel") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    const idTransaksi = String(req.body?.idTransaksi || req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    const r = await axios.post(`${VPS_BASE}/api/cancel`, { idTransaksi }, {
      timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" },
    });
    return res.status(r.status).json(r.data);
  }

  if (action === "qr") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    const r = await axios({
      method: "GET",
      url: `${VPS_BASE}/api/qr/${encodeURIComponent(idTransaksi)}.png`,
      responseType: "stream",
      timeout: 20000,
      validateStatus: () => true,
    });
    if (r.status !== 200) return res.status(r.status).json({ success: false, error: "QR not found on VPS" });
    res.setHeader("Content-Type", "image/png");
    return r.data.pipe(res);
  }

  if (action === "setstatus") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;
    const { idTransaksi, status, paidAt, note, paidVia } = req.body || {};
    if (!idTransaksi || !status) return res.status(400).json({ success: false, error: "idTransaksi & status required" });

    const r = await axios.post(`${VPS_BASE}/api/status`, { idTransaksi, status, paidAt, note, paidVia }, {
      timeout: 15000, validateStatus: () => true, headers: { "Content-Type": "application/json" },
    });
    return res.status(r.status).json(r.data);
  }

  if (action === "admin_upsert_voucher") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdmin(req, res)) return;
    const db = await loadDb();
    const out = adminUpsertVoucher(db, req.body || {});
    await saveDb(db);
    return res.status(200).json({ success: true, data: out });
  }

  if (action === "admin_disable_voucher") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdmin(req, res)) return;
    const db = await loadDb();
    const out = adminDisableVoucher(db, req.body || {});
    await saveDb(db);
    return res.status(200).json({ success: true, data: out });
  }

  if (action === "admin_set_monthly_promo") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdmin(req, res)) return;
    const db = await loadDb();
    const out = adminSetMonthlyPromo(db, req.body || {});
    await saveDb(db);
    return res.status(200).json({ success: true, data: out });
  }

  return res.status(404).json({ success: false, error: "Unknown action" });
};
