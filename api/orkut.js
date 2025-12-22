// api/orkut.js
const axios = require("axios");

// DB via GitHub (shared with admin)
const { loadDb, saveDb } = require("../lib/github");

// Voucher/promo logic (shared)
const {
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,
  adminUpsertVoucher,
  adminDisableVoucher,
  adminSetMonthlyPromo,
} = require("../lib/voucher");

// ✅ FIX: default VPS_BASE ke IP+PORT yang kebukti bisa (193.23.209.47:7032)
const VPS_BASE = (process.env.VPS_BASE || "http://193.23.209.47:7032").replace(/\/+$/, "");
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Callback-Secret, X-Admin-Key"
  );
  res.setHeader("Cache-Control", "no-store");
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
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
      dbPath: process.env.GH_PATH || "(GH_PATH not set)",
      routes: [
        "POST /api/orkut?action=createqr",
        "POST /api/orkut?action=discount.apply (ADMIN dry-run)",
        "GET  /api/orkut?action=status&idTransaksi=...",
        "POST /api/orkut?action=cancel",
        "GET  /api/orkut?action=qr&idTransaksi=...",
        "POST /api/orkut?action=setstatus",
        "POST /api/orkut?action=paidhook",
        "GET  /api/orkut?action=voucher.list (ADMIN)",
        "POST /api/orkut?action=voucher.upsert (ADMIN)",
        "POST /api/orkut?action=voucher.disable (ADMIN)",
        "GET  /api/orkut?action=monthly.get (ADMIN)",
        "POST /api/orkut?action=monthly.set (ADMIN)",
      ],
    });
  }

  // ===================== DISCOUNT PREVIEW (ADMIN) =====================
  // Admin tester: hit /api/orkut?action=discount.apply (POST)
  // body: { amount, deviceId, voucher }
  if (action === "discount.apply") {
    if (req.method !== "POST")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireAdmin(req, res)) return;

    const amount = Number(req.body?.amount);
    const deviceId = String(req.body?.deviceId || "").trim();
    const code = String(req.body?.voucher || req.body?.code || "").trim();

    if (!Number.isFinite(amount) || amount < 1)
      return res.status(400).json({ success: false, error: "amount invalid" });
    if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });

    const db = await loadDb();
    const dbClone = JSON.parse(JSON.stringify(db || {})); // dry-run: jangan nulis reservation ke DB asli

    const deviceKey = getDeviceKey(deviceId);
    const out = applyDiscount(dbClone, {
      amount,
      deviceKey,
      voucherCode: code || null,
      reserveTtlMs: 6 * 60 * 1000,
    });

    return res.status(200).json({ success: true, data: out });
  }

  // ===================== CREATE QR =====================
  // body: { amount, theme, deviceId, voucher? }
  // - voucher kosong => TIDAK ADA POTONGAN
  // - voucher terisi => bisa jadi voucher custom ATAU promo bulanan (kode wajib)
  if (action === "createqr") {
    if (req.method !== "POST")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const amount = Number(req.body?.amount);
    const theme = req.body?.theme === "theme1" ? "theme1" : "theme2";
    const deviceId = String(req.body?.deviceId || "").trim();
    const code = String(req.body?.voucher || req.body?.code || "").trim();

    if (!Number.isFinite(amount) || amount < 1)
      return res.status(400).json({ success: false, error: "amount invalid" });
    if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });

    const db = await loadDb();
    const deviceKey = getDeviceKey(deviceId);

    // reserve voucher/monthly (kalau code valid) — no auto discount
    const { finalAmount, discountRp, applied, reservations } = applyDiscount(db, {
      amount,
      deviceKey,
      voucherCode: code || null,
      reserveTtlMs: 6 * 60 * 1000,
    });

    let r;
    try {
      // ✅ FIX: endpoint yang bener sesuai curl lu -> /api/orkut?action=createqr
      // + kirim X-Admin-Key supaya match provider requirement (kalau provider minta)
      r = await axios.post(
        `${VPS_BASE}/api/orkut?action=createqr`,
        { amount: finalAmount, deviceId, voucher: code || "", theme },
        {
          timeout: 20000,
          validateStatus: () => true,
          headers: {
            "Content-Type": "application/json",
            ...(ADMIN_KEY ? { "X-Admin-Key": ADMIN_KEY } : {}),
          },
        }
      );
    } catch (err) {
      releaseReservations(db, reservations || []);
      await saveDb(db);
      return res.status(502).json({
        success: false,
        error: "VPS createqr network error",
        detail: String(err?.message || err),
        vps: VPS_BASE,
      });
    }

    const data = r.data;

    if (r.status < 200 || r.status >= 300) {
      releaseReservations(db, reservations || []);
      await saveDb(db);
      return res.status(r.status).json({ success: false, error: "VPS createqr failed", provider: data });
    }

    const idTransaksi = String(data?.data?.idTransaksi || data?.idTransaksi || "").trim();
    if (!idTransaksi) {
      releaseReservations(db, reservations || []);
      await saveDb(db);
      return res.status(502).json({ success: false, error: "VPS createqr missing idTransaksi", provider: data });
    }

    // dari response provider kadang udah ada path png; fallback ke /api/qr/{id}.png
    const vpsQrPngUrl =
      data?.data?.qrPngUrl ||
      data?.qrPngUrl ||
      `/api/qr/${encodeURIComponent(idTransaksi)}.png`;

    db.tx = db.tx || {};
    db.tx[idTransaksi] = {
      idTransaksi,
      deviceKey,
      deviceIdMasked: deviceId.slice(0, 3) + "***",

      amountOriginal: amount,
      amountFinal: finalAmount,
      discountRp,
      applied,

      reservations: reservations || [],
      discountCommitted: false,

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
        qrVpsUrl: `${VPS_BASE}${vpsQrPngUrl}`,
        pricing: { amountOriginal: amount, amountFinal: finalAmount, discountRp, applied },
      },
    });
  }

  // ===================== PAIDHOOK (commit/release diskon) =====================
  if (action === "paidhook") {
    if (req.method !== "POST")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    const { idTransaksi, status, paidAt, paidVia, note } = req.body || {};
    if (!idTransaksi || !status)
      return res.status(400).json({ success: false, error: "idTransaksi & status required" });

    const st = String(status).toLowerCase();
    const terminal = new Set(["paid", "expired", "cancelled", "failed"]);
    if (!terminal.has(st))
      return res.status(400).json({ success: false, error: "status must be paid|expired|cancelled|failed" });

    const db = await loadDb();
    db.tx = db.tx || {};
    const tx = db.tx[idTransaksi];
    if (!tx) return res.status(404).json({ success: false, error: "tx not found" });

    tx.status = st;
    if (paidAt) tx.paidAt = paidAt;
    if (paidVia) tx.paidVia = paidVia;
    if (note) tx.note = note;
    tx.updatedAt = new Date().toISOString();

    if (st === "paid") {
      if (!tx.discountCommitted) {
        commitReservations(db, tx.reservations || []);
        tx.discountCommitted = true;
      }
    } else {
      if (!tx.discountCommitted) releaseReservations(db, tx.reservations || []);
      tx.discountCommitted = false;
    }

    await saveDb(db);
    return res.status(200).json({ success: true, saved: true, status: st });
  }

  // ===================== LOCAL STATUS =====================
  if (action === "status") {
    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    const db = await loadDb();
    const tx = db?.tx?.[idTransaksi];
    if (!tx) return res.status(404).json({ success: false, error: "tx not found" });

    return res.status(200).json({ success: true, data: tx });
  }

  // ===================== CANCEL =====================
  if (action === "cancel") {
    if (req.method !== "POST")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const idTransaksi = String(req.body?.idTransaksi || req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    let r;
    try {
      r = await axios.post(
        `${VPS_BASE}/api/cancel`,
        { idTransaksi },
        {
          timeout: 15000,
          validateStatus: () => true,
          headers: {
            "Content-Type": "application/json",
            ...(ADMIN_KEY ? { "X-Admin-Key": ADMIN_KEY } : {}),
          },
        }
      );
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: "VPS cancel network error",
        detail: String(err?.message || err),
        vps: VPS_BASE,
      });
    }

    const db = await loadDb();
    const tx = db?.tx?.[idTransaksi];
    if (tx && !tx.discountCommitted) {
      releaseReservations(db, tx.reservations || []);
      tx.status = "cancelled";
      tx.updatedAt = new Date().toISOString();
      await saveDb(db);
    }

    return res.status(r.status).json(r.data);
  }

  // ===================== QR IMAGE PROXY =====================
  if (action === "qr") {
    if (req.method !== "GET")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });

    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    let r;
    try {
      r = await axios.get(`${VPS_BASE}/api/qr/${encodeURIComponent(idTransaksi)}.png`, {
        responseType: "arraybuffer",
        timeout: 20000,
        validateStatus: () => true,
      });
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: "VPS qr network error",
        detail: String(err?.message || err),
        vps: VPS_BASE,
      });
    }

    if (r.status < 200 || r.status >= 300) return res.status(r.status).send("QR not found");

    res.status(200);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(r.data));
    return;
  }

  // ===================== SETSTATUS (internal) =====================
  if (action === "setstatus") {
    if (req.method !== "POST")
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    const { idTransaksi, status } = req.body || {};
    if (!idTransaksi || !status)
      return res.status(400).json({ success: false, error: "idTransaksi & status required" });

    const db = await loadDb();
    const tx = db?.tx?.[idTransaksi];
    if (!tx) return res.status(404).json({ success: false, error: "tx not found" });

    tx.status = String(status).toLowerCase();
    tx.updatedAt = new Date().toISOString();
    await saveDb(db);

    return res.status(200).json({ success: true, data: tx });
  }

  // ===================== ADMIN: voucher + monthly =====================
  const isAdminAction = new Set([
    "voucher.list",
    "voucher.upsert",
    "voucher.disable",
    "monthly.get",
    "monthly.set",
    "admin_upsert_voucher",
    "admin_disable_voucher",
    "admin_set_monthly_promo",
  ]);

  if (isAdminAction.has(action)) {
    if (!requireAdmin(req, res)) return;

    const db = await loadDb();

    if (action === "voucher.list") {
      const list = Object.values(db.vouchers || {}).sort((a, b) =>
        String(a.code).localeCompare(String(b.code))
      );
      return res.status(200).json({ success: true, data: list });
    }

    if (action === "voucher.upsert" || action === "admin_upsert_voucher") {
      if (req.method !== "POST")
        return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminUpsertVoucher(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }

    if (action === "voucher.disable" || action === "admin_disable_voucher") {
      if (req.method !== "POST")
        return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminDisableVoucher(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }

    if (action === "monthly.get") {
      const p = db?.promo?.monthly || {};
      return res.status(200).json({ success: true, data: p });
    }

    if (action === "monthly.set" || action === "admin_set_monthly_promo") {
      if (req.method !== "POST")
        return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminSetMonthlyPromo(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }
  }

  return res.status(404).json({ success: false, error: "Unknown action" });
};