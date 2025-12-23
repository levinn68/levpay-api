// api/orkut.js — FULL FINAL (DISCOUNT WORKING END-TO-END)
// Matches scripts/api.js endpoints:
// - POST  /api/orkut?action=createqr
// - GET   /api/orkut?action=status&idTransaksi=...
// - POST  /api/orkut?action=cancel
// - GET   /api/orkut?action=qr&idTransaksi=...        (PNG proxy)
//
// + internal callback (optional but IMPORTANT for committing discounts):
// - POST  /api/orkut?action=paidhook  (commit/release reservations)
//
// ENV:
// - VPS_BASE="http://193.23.209.47:7032"   (REQUIRED, no trailing slash)
// - CALLBACK_SECRET="..."                  (optional, protect paidhook)
// - VPS_TIMEOUT_MS=20000                   (optional)
// - VPS_CREATEQR_PATH="/api/createqr"      (optional)
// - VPS_CANCEL_PATH="/api/cancel"          (optional)
// - VPS_QR_PATH="/api/qr"                  (optional)

const axios = require("axios");
const { loadDb, saveDb } = require("../lib/github");

// voucher engine
const {
  getDeviceKey,
  applyDiscount,
  commitReservations,
  releaseReservations,
} = require("../lib/voucher");

// ===== ENV =====
const VPS_BASE = String(process.env.VPS_BASE || "").trim().replace(/\/+$/, "");
const CALLBACK_SECRET = String(process.env.CALLBACK_SECRET || "").trim();

const VPS_TIMEOUT_MS = Number(process.env.VPS_TIMEOUT_MS || 20000);
const VPS_CREATEQR_PATH = String(process.env.VPS_CREATEQR_PATH || "/api/createqr").trim();
const VPS_CANCEL_PATH = String(process.env.VPS_CANCEL_PATH || "/api/cancel").trim();
const VPS_QR_PATH = String(process.env.VPS_QR_PATH || "/api/qr").trim();

// ===== helpers =====
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

function joinUrl(base, p) {
  const b = String(base || "").replace(/\/+$/, "");
  const pp = String(p || "");
  return pp.startsWith("/") ? `${b}${pp}` : `${b}/${pp}`;
}

function assertVpsBase() {
  if (!VPS_BASE) throw new Error('VPS_BASE kosong. Set env VPS_BASE contoh: "http://193.23.209.47:7032"');
  if (!/^https?:\/\//i.test(VPS_BASE)) throw new Error(`VPS_BASE invalid. Sekarang: "${VPS_BASE}"`);
}

function requireSecret(req, res) {
  if (!CALLBACK_SECRET) return true; // secret off
  const got =
    (req.headers["x-callback-secret"] || "").toString().trim() ||
    (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  if (got !== CALLBACK_SECRET) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

const http = axios.create({
  timeout: VPS_TIMEOUT_MS,
  validateStatus: () => true,
  headers: { "Content-Type": "application/json" },
});

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

function pickIdTransaksi(provider) {
  const d = provider?.data || provider || {};
  return String(pick(d, ["idTransaksi", "idtransaksi", "transactionId", "trxId", "id"]) || "").trim();
}

function pickExpiredAt(provider) {
  const d = provider?.data || provider || {};
  return pick(d, ["expiredAt", "expired"]);
}

function pickQrPngUrl(provider) {
  const d = provider?.data || provider || {};
  return pick(d, ["qrPngUrl", "qrpngurl"]);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "").toLowerCase().trim();
  const baseUrl = getBaseUrl(req);

  // ===== ping =====
  if (!action || action === "ping") {
    return res.status(200).json({
      success: true,
      service: "orkut-proxy",
      vpsBase: VPS_BASE || "(VPS_BASE not set)",
      routes: [
        "POST /api/orkut?action=createqr",
        "GET  /api/orkut?action=status&idTransaksi=...",
        "POST /api/orkut?action=cancel",
        "GET  /api/orkut?action=qr&idTransaksi=...",
        "POST /api/orkut?action=paidhook (optional)",
      ],
    });
  }

  // =====================
  // CREATE QR (DISCOUNT APPLIED HERE)
  // =====================
  if (action === "createqr") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      assertVpsBase();

      const amountOriginal = Number(req.body?.amount);
      const deviceId = String(req.body?.deviceId || "").trim();

      // NOTE: frontend kirim "voucher" + fallback typo "vouccer"
      const voucherCode = String(
        req.body?.voucher || req.body?.code || req.body?.vouccer || ""
      ).trim();

      const theme = req.body?.theme === "theme1" ? "theme1" : "theme2";

      if (!Number.isFinite(amountOriginal) || amountOriginal < 1) {
        return res.status(400).json({ success: false, error: "amount invalid" });
      }
      if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });

      const db = await loadDb();
      db.tx = db.tx || {};

      const deviceKey = getDeviceKey(deviceId);

      // ✅ DISKON CUMA JALAN KALAU USER MASUKIN KODE (voucherCode)
      // kalau kosong, applied = [] dan discountRp = 0
      const { finalAmount, discountRp, applied, reservations } = applyDiscount(db, {
        amount: amountOriginal,
        deviceKey,
        voucherCode: voucherCode || null,
        reserveTtlMs: 6 * 60 * 1000,
      });

      // call VPS createqr with FINAL AMOUNT
      const vpsUrl = joinUrl(VPS_BASE, VPS_CREATEQR_PATH);
      const r = await http.post(vpsUrl, { amount: finalAmount, theme });

      if (r.status < 200 || r.status >= 300) {
        // gagal bikin QR => release reservation biar gak "ke-lock"
        releaseReservations(db, reservations || []);
        await saveDb(db);
        return res.status(r.status).json({
          success: false,
          error: "VPS createqr failed",
          vpsUrl,
          provider: r.data,
        });
      }

      const provider = r.data;
      const idTransaksi = pickIdTransaksi(provider);
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

      const createdAt = new Date().toISOString();
      const expiredAt = pickExpiredAt(provider) || null;
      const qrPngUrl = pickQrPngUrl(provider) || null;

      // scripts/api.js expects qrUrl (proxy https) + qrVpsUrl (direct vps)
      const qrUrl = `${baseUrl}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`;
      const qrVpsUrl = joinUrl(
        VPS_BASE,
        qrPngUrl ? String(qrPngUrl) : `${VPS_QR_PATH}/${encodeURIComponent(idTransaksi)}.png`
      );

      // save tx to DB (important for status + commit later)
      db.tx[idTransaksi] = {
        idTransaksi,
        deviceKey,
        deviceIdMasked: deviceId.slice(0, 3) + "***",

        voucherCode: voucherCode || null,
        amountOriginal,
        amountFinal: finalAmount,
        discountRp: discountRp || 0,
        applied: applied || [],

        reservations: reservations || [],
        discountCommitted: false,

        status: "pending",
        createdAt,
        expiredAt,
        paidAt: null,
        paidVia: null,
        updatedAt: createdAt,

        qrUrl,
        qrVpsUrl,
        qrPngUrl,
      };

      await saveDb(db);

      return res.status(200).json({
        success: true,
        data: {
          idTransaksi,
          createdAt,
          expiredAt,
          qrUrl,
          qrVpsUrl,
          qrPngUrl,

          // ✅ ini yang dibaca normalizePricing() di scripts/api.js
          pricing: {
            amountOriginal,
            amountFinal: finalAmount,
            discountRp: discountRp || 0,
            applied: applied || [],
          },
        },
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  }

  // =====================
  // STATUS
  // =====================
  if (action === "status") {
    const idTransaksi = String(req.query?.idTransaksi || "").trim();
    if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

    const db = await loadDb();
    const tx = db?.tx?.[idTransaksi];
    if (!tx) return res.status(404).json({ success: false, error: "tx not found" });

    return res.status(200).json({
      success: true,
      data: {
        ...tx,
        pricing: {
          amountOriginal: tx.amountOriginal,
          amountFinal: tx.amountFinal,
          discountRp: tx.discountRp || 0,
          applied: tx.applied || [],
        },
      },
    });
  }

  // =====================
  // CANCEL (release reservations)
  // =====================
  if (action === "cancel") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      assertVpsBase();

      const idTransaksi = String(req.body?.idTransaksi || req.query?.idTransaksi || "").trim();
      if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

      const vpsUrl = joinUrl(VPS_BASE, VPS_CANCEL_PATH);
      const r = await http.post(vpsUrl, { idTransaksi });

      // always update local DB
      const db = await loadDb();
      const tx = db?.tx?.[idTransaksi];
      if (tx) {
        // ✅ kalau belum paid => release diskon
        if (!tx.discountCommitted) releaseReservations(db, tx.reservations || []);
        tx.discountCommitted = false;
        tx.status = "cancelled";
        tx.updatedAt = new Date().toISOString();
        await saveDb(db);
      }

      return res.status(r.status).json(r.data);
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  }

  // =====================
  // QR IMAGE PROXY (PNG)
  // =====================
  if (action === "qr") {
    if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

    try {
      assertVpsBase();

      const idTransaksi = String(req.query?.idTransaksi || "").trim();
      if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

      const url = joinUrl(VPS_BASE, `${VPS_QR_PATH}/${encodeURIComponent(idTransaksi)}.png`);
      const r = await http.get(url, { responseType: "arraybuffer" });

      if (r.status < 200 || r.status >= 300) return res.status(r.status).send("QR not found");

      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.send(Buffer.from(r.data));
      return;
    } catch (e) {
      return res.status(500).send(String(e?.message || e));
    }
  }

  // =====================
  // PAIDHOOK (commit/release reservations)
  // IMPORTANT: ini yang bikin voucher/monthly "kepake" beneran.
  // =====================
  if (action === "paidhook") {
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
    if (!requireSecret(req, res)) return;

    try {
      const idTransaksi = String(req.body?.idTransaksi || "").trim();
      const status = String(req.body?.status || "").trim().toLowerCase();
      const paidAt = req.body?.paidAt ? String(req.body.paidAt) : null;
      const paidVia = req.body?.paidVia ? String(req.body.paidVia) : null;

      if (!idTransaksi || !status) {
        return res.status(400).json({ success: false, error: "idTransaksi & status required" });
      }

      const terminal = new Set(["paid", "expired", "cancelled", "failed"]);
      if (!terminal.has(status)) {
        return res.status(400).json({ success: false, error: "status must be paid|expired|cancelled|failed" });
      }

      const db = await loadDb();
      db.tx = db.tx || {};
      const tx = db.tx[idTransaksi];
      if (!tx) return res.status(404).json({ success: false, error: "tx not found" });

      tx.status = status;
      if (paidAt) tx.paidAt = paidAt;
      if (paidVia) tx.paidVia = paidVia;
      tx.updatedAt = new Date().toISOString();

      if (status === "paid") {
        // ✅ COMMIT reservations => voucher/monthly use count naik
        if (!tx.discountCommitted) {
          commitReservations(db, tx.reservations || []);
          tx.discountCommitted = true;
        }
      } else {
        // ✅ kalau bukan paid => release (kalau belum commit)
        if (!tx.discountCommitted) releaseReservations(db, tx.reservations || []);
        tx.discountCommitted = false;
      }

      await saveDb(db);
      return res.status(200).json({ success: true, saved: true, status });
    } catch (e) {
      return res.status(500).json({ success: false, error: String(e?.message || e) });
    }
  }

  return res.status(404).json({ success: false, error: "Unknown action" });
};