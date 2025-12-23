// api/orkut.js — FINAL (ONLY VPS_BASE from ENV, NO DEFAULT, NO ALIAS)
//
// WAJIB ENV:
// - VPS_BASE = "http://193.23.209.47:7032"   (tanpa trailing slash)
//
// OPTIONAL:
// - VPS_CREATEQR_PATH (default "/api/createqr")
// - VPS_CANCEL_PATH   (default "/api/cancel")
// - VPS_QR_PATH       (default "/api/qr")    => GET {VPS_QR_PATH}/{id}.png
// - CALLBACK_SECRET   (optional protect paidhook/setstatus)
// - ADMIN_KEY         (optional protect admin actions)
// - VPS_TIMEOUT_MS    (default 20000)

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

// ===================== ENV / CONFIG =====================
const VPS_BASE = String(process.env.VPS_BASE || "").trim().replace(/\/+$/, ""); // ONLY THIS
const VPS_CREATEQR_PATH = String(process.env.VPS_CREATEQR_PATH || "/api/createqr").trim();
const VPS_CANCEL_PATH = String(process.env.VPS_CANCEL_PATH || "/api/cancel").trim();
const VPS_QR_PATH = String(process.env.VPS_QR_PATH || "/api/qr").trim();

const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim();
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();

const VPS_TIMEOUT_MS = Number(process.env.VPS_TIMEOUT_MS || 20000);

const http = axios.create({
  timeout: VPS_TIMEOUT_MS,
  validateStatus: () => true,
  headers: { "Content-Type": "application/json" },
});

// ===================== HELPERS =====================
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
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().trim();
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

function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/, "");
  const pp = String(p || "").startsWith("/") ? String(p || "") : `/${p || ""}`;
  return `${b}${pp}`;
}

function assertVpsBase() {
  if (!VPS_BASE) {
    const err = new Error('VPS_BASE kosong. Set env VPS_BASE contoh: "http://193.23.209.47:7032"');
    err.code = "VPS_BASE_MISSING";
    throw err;
  }
  if (!/^https?:\/\//i.test(VPS_BASE)) {
    const err = new Error(`VPS_BASE invalid (harus http/https). Sekarang: "${VPS_BASE}"`);
    err.code = "VPS_BASE_INVALID";
    throw err;
  }
}

// ===================== HANDLER =====================
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "").toLowerCase().trim();
  const baseUrl = getBaseUrl(req);

  // ping/help
  if (!action || action === "ping") {
    return res.status(200).json({
      success: true,
      service: "levpay-vercel-proxy",
      vpsBase: VPS_BASE || "(VPS_BASE not set)",
      vpsPaths: { createqr: VPS_CREATEQR_PATH, cancel: VPS_CANCEL_PATH, qr: VPS_QR_PATH },
      routes: [
        "POST /api/orkut?action=createqr",
        "GET  /api/orkut?action=status&idTransaksi=...",
        "POST /api/orkut?action=cancel",
        "GET  /api/orkut?action=qr&idTransaksi=...",
        "POST /api/orkut?action=paidhook (secret optional)",
        "POST /api/orkut?action=setstatus (secret optional)",
        "GET  /api/orkut?action=voucher.list (ADMIN)",
        "POST /api/orkut?action=voucher.upsert (ADMIN)",
        "POST /api/orkut?action=voucher.disable (ADMIN)",
        "GET  /api/orkut?action=monthly.get (ADMIN)",
        "POST /api/orkut?action=monthly.set (ADMIN)",
      ],
    });
  }

  // ===================== CREATE QR =====================
  if (action === "createqr") {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    try {
      assertVpsBase();

      const amount = Number(req.body?.amount);
      const theme = req.body?.theme === "theme1" ? "theme1" : "theme2";
      const deviceId = String(req.body?.deviceId || "").trim();
      const code = String(req.body?.voucher || req.body?.code || req.body?.vouccer || "").trim();

      if (!Number.isFinite(amount) || amount < 1) {
        return res.status(400).json({ success: false, error: "amount invalid" });
      }
      if (!deviceId) {
        return res.status(400).json({ success: false, error: "deviceId required" });
      }

      const db = await loadDb();
      const deviceKey = getDeviceKey(deviceId);

      // reserve voucher/monthly (kalau code valid) — kalau code kosong => no diskon
      const { finalAmount, discountRp, applied, reservations } = applyDiscount(db, {
        amount,
        deviceKey,
        voucherCode: code || null,
        reserveTtlMs: 6 * 60 * 1000,
      });

      const vpsUrl = joinUrl(VPS_BASE, VPS_CREATEQR_PATH);

      let r;
      try {
        r = await http.post(vpsUrl, { amount: finalAmount, theme });
      } catch (e) {
        releaseReservations(db, reservations || []);
        await saveDb(db);
        return res.status(502).json({
          success: false,
          error: "VPS createqr network error",
          detail: String(e?.message || e),
          vpsUrl,
        });
      }

      const provider = r.data;

      if (r.status < 200 || r.status >= 300) {
        releaseReservations(db, reservations || []);
        await saveDb(db);
        return res.status(r.status).json({
          success: false,
          error: "VPS createqr failed",
          vpsUrl,
          provider,
        });
      }

      const idTransaksi = String(provider?.data?.idTransaksi || provider?.idTransaksi || "").trim();
      if (!idTransaksi) {
        releaseReservations(db, reservations || []);
        await saveDb(db);
        return res.status(502).json({
          success: false,
          error: "VPS createqr missing idTransaksi",
          vpsUrl,
          provider,
        });
      }

      const vpsQrPngUrl =
        provider?.data?.qrPngUrl ||
        provider?.qrPngUrl ||
        `${VPS_QR_PATH}/${encodeURIComponent(idTransaksi)}.png`;

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
        ...provider,
        data: {
          ...(provider?.data || {}),
          idTransaksi,
          qrUrl: `${baseUrl}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`,
          qrVpsUrl: joinUrl(VPS_BASE, vpsQrPngUrl),
          pricing: { amountOriginal: amount, amountFinal: finalAmount, discountRp, applied },
        },
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e?.message || "server error" });
    }
  }

  // ===================== PAIDHOOK =====================
  if (action === "paidhook") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    const { idTransaksi, status, paidAt, paidVia, note } = req.body || {};
    if (!idTransaksi || !status) return res.status(400).json({ success: false, error: "idTransaksi & status required" });

    const st = String(status).toLowerCase();
    const terminal = new Set(["paid", "expired", "cancelled", "failed"]);
    if (!terminal.has(st)) return res.status(400).json({ success: false, error: "status must be paid|expired|cancelled|failed" });

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
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      assertVpsBase();

      const idTransaksi = String(req.body?.idTransaksi || req.query?.idTransaksi || "").trim();
      if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

      const vpsUrl = joinUrl(VPS_BASE, VPS_CANCEL_PATH);
      const r = await http.post(vpsUrl, { idTransaksi });

      const db = await loadDb();
      const tx = db?.tx?.[idTransaksi];
      if (tx && !tx.discountCommitted) {
        releaseReservations(db, tx.reservations || []);
        tx.status = "cancelled";
        tx.updatedAt = new Date().toISOString();
        await saveDb(db);
      }

      return res.status(r.status).json(r.data);
    } catch (e) {
      return res.status(500).json({ success: false, error: e?.message || "server error" });
    }
  }

  // ===================== QR IMAGE PROXY =====================
  if (action === "qr") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      assertVpsBase();

      const idTransaksi = String(req.query?.idTransaksi || "").trim();
      if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

      const url = joinUrl(VPS_BASE, `${VPS_QR_PATH}/${encodeURIComponent(idTransaksi)}.png`);
      const r = await http.get(url, { responseType: "arraybuffer", headers: {} });

      if (r.status < 200 || r.status >= 300) return res.status(r.status).send("QR not found");

      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.send(Buffer.from(r.data));
      return;
    } catch (e) {
      return res.status(500).send(String(e?.message || e));
    }
  }

  // ===================== SETSTATUS (internal) =====================
  if (action === "setstatus") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    const { idTransaksi, status } = req.body || {};
    if (!idTransaksi || !status) return res.status(400).json({ success: false, error: "idTransaksi & status required" });

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

    if (action === "voucher.upsert") {
      if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminUpsertVoucher(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }

    if (action === "voucher.disable") {
      if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminDisableVoucher(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }

    if (action === "monthly.get") {
      const p = db?.promo?.monthly || {};
      return res.status(200).json({ success: true, data: p });
    }

    if (action === "monthly.set") {
      if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
      const out = adminSetMonthlyPromo(db, req.body || {});
      await saveDb(db);
      return res.status(200).json({ success: true, data: out });
    }
  }

  return res.status(404).json({ success: false, error: "Unknown action" });
};
```0