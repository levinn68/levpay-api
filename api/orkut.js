// api/orkut.js
const axios = require("axios");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Key, X-Callback-Secret"
  );
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function getSelfBase(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers.host || "").trim();
  return `${proto}://${host}`;
}

async function readJsonFromAxios(resp) {
  // axios already parses json if content-type json, but keep safe:
  return resp?.data ?? {};
}

function unwrap(x) {
  // support {success:true,data:{...}} or {data:{...}} or direct object
  const a = x?.data ?? x;
  const b = a?.data ?? a;
  return b ?? {};
}

function pickIdTransaksi(d) {
  return (
    d?.idTransaksi ||
    d?.idtransaksi ||
    d?.transactionId ||
    d?.trxId ||
    d?.id ||
    d?.orderId ||
    d?.referenceId ||
    ""
  );
}

async function vpsTryGet(vpsBase, paths, axiosOpts = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      const r = await axios.get(`${vpsBase}${p}`, axiosOpts);
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function vpsTryPost(vpsBase, paths, body, axiosOpts = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      const r = await axios.post(`${vpsBase}${p}`, body, axiosOpts);
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.end("");

  const VPS_BASE = String(process.env.VPS_BASE || "").trim().replace(/\/+$/, "");
  if (!VPS_BASE) {
    return send(res, 500, { success: false, error: "VPS_BASE env belum di-set" });
  }

  const action = String(req.query?.action || "").trim().toLowerCase();
  const selfBase = getSelfBase(req);

  try {
    // =========================
    // CREATE QR
    // =========================
    if (action === "createqr") {
      if (req.method !== "POST") return send(res, 405, { success: false, error: "Method not allowed" });

      const amount = Number(req.body?.amount);
      const deviceId = String(req.body?.deviceId || "").trim();
      const voucher = String(req.body?.voucher || req.body?.code || "").trim();
      const theme = String(req.body?.theme || "theme2").trim();

      if (!Number.isFinite(amount) || amount <= 0) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }
      if (!deviceId) return send(res, 400, { success: false, error: "deviceId wajib" });

      // 1) Apply discount via /api/levpay (biar 100% sama dengan admin/curl)
      const discResp = await axios.post(
        `${selfBase}/api/levpay?action=discount.apply`,
        { amount, deviceId, voucher },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );

      const discRaw = await readJsonFromAxios(discResp);
      if (!discResp.status || discResp.status >= 400) {
        return send(res, 500, { success: false, error: discRaw?.error || "discount.apply failed" });
      }
      if (discRaw?.success === false) {
        return send(res, 400, { success: false, error: discRaw?.error || "discount.apply rejected" });
      }

      const disc = unwrap(discRaw);
      const amountOriginal = Number(disc?.amountOriginal ?? amount);
      const amountFinal = Number(disc?.amountFinal ?? amount);
      const discountRp = Number(disc?.discountRp ?? Math.max(0, amountOriginal - amountFinal));
      const applied = Array.isArray(disc?.applied) ? disc.applied : [];
      const promoTerpakai = String(disc?.promoTerpakai || voucher || "").trim() || null;
      const reservations = Array.isArray(disc?.reservations) ? disc.reservations : [];

      // 2) Call VPS createqr (UPSTREAM)
      //    (try multiple possible upstream paths biar nggak "ga sinkron" lagi)
      const upstream = await vpsTryPost(
        VPS_BASE,
        ["/api/createqr", "/api/orkut?action=createqr"],
        {
          amount: amountFinal,
          deviceId,
          voucher, // optional, biar upstream tau kode yg dipakai
          theme: theme === "theme1" ? "theme1" : "theme2",
        },
        { timeout: 20000, headers: { "Content-Type": "application/json" } }
      );

      const upRaw = await readJsonFromAxios(upstream);
      if (upRaw?.success === false) {
        // kalau VPS balikin {success:false,error:"..."}
        return send(res, 502, { success: false, error: upRaw?.error || "Upstream createqr failed" });
      }

      const up = unwrap(upRaw);
      const idTransaksi = String(pickIdTransaksi(up)).trim();
      if (!idTransaksi) {
        return send(res, 502, { success: false, error: "Upstream createqr schema mismatch (missing idTransaksi)" });
      }

      // 3) Simpan TX + reservations ke DB via /api/levpay (ADMIN) supaya bisa commit/release nanti.
      //    Ini butuh ADMIN_KEY di env (yang sama kayak curl kamu).
      const adminKey = String(process.env.ADMIN_KEY || "").trim();
      if (adminKey) {
        // best-effort, kalau gagal tetep return QR (biar user bisa bayar)
        try {
          await axios.post(
            `${selfBase}/api/levpay?action=tx.upsert`,
            {
              idTransaksi,
              status: "PENDING",
              deviceId,
              voucher,
              promoTerpakai,
              amountOriginal,
              amountFinal,
              discountRp,
              applied,
              reservations,
              createdAt: up?.createdAt || new Date().toISOString(),
              expiredAt: up?.expiredAt || up?.expired || null,
            },
            {
              headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
              timeout: 15000,
            }
          );
        } catch (_) {
          // ignore
        }
      }

      // 4) Return to client (proxy QR biar aman https)
      const qrUrl = `${selfBase}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`;
      const qrVpsUrl =
        up?.qrVpsUrl || up?.qrPngUrl || up?.qrUrl || up?.qr || null;

      return send(res, 200, {
        success: true,
        data: {
          ...up,
          idTransaksi,
          voucher: promoTerpakai,
          promoTerpakai,
          pricing: { amountOriginal, amountFinal, discountRp, applied },
          amountOriginal,
          amountFinal,
          discountRp,
          applied,
          qrUrl,     // ✅ selalu pakai proxy ini di frontend
          qrVpsUrl,  // optional info
        },
      });
    }

    // =========================
    // STATUS
    // =========================
    if (action === "status") {
      const idTransaksi = String(req.query?.idTransaksi || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "idTransaksi wajib" });

      const upstream = await vpsTryGet(
        VPS_BASE,
        [`/api/status?idTransaksi=${encodeURIComponent(idTransaksi)}`, `/api/status/${encodeURIComponent(idTransaksi)}`],
        { timeout: 15000 }
      );

      const upRaw = await readJsonFromAxios(upstream);
      const up = unwrap(upRaw);

      // auto-commit / release diskon berdasarkan status upstream (best-effort)
      const status = String(up?.status || up?.state || "").toUpperCase();
      const paid = Boolean(up?.paid || status === "PAID" || status === "SUCCESS");

      // kalau paid -> commit diskon (kalau tx nyimpen reservations)
      // commit/release akan aman walau dipanggil ulang (levpay.js yang handle)
      if (paid) {
        try {
          await axios.post(
            `${selfBase}/api/levpay?action=discount.commit`,
            { idTransaksi },
            { headers: { "Content-Type": "application/json" }, timeout: 12000 }
          );
        } catch (_) {}
      }

      const qrUrl = `${selfBase}/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`;

      return send(res, 200, {
        success: true,
        data: {
          ...up,
          idTransaksi,
          qrUrl,
        },
      });
    }

    // =========================
    // CANCEL
    // =========================
    if (action === "cancel") {
      if (req.method !== "POST") return send(res, 405, { success: false, error: "Method not allowed" });

      const idTransaksi = String(req.body?.idTransaksi || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "idTransaksi wajib" });

      const upstream = await vpsTryPost(
        VPS_BASE,
        ["/api/cancel", "/api/orkut?action=cancel"],
        { idTransaksi },
        { timeout: 15000, headers: { "Content-Type": "application/json" } }
      );

      const upRaw = await readJsonFromAxios(upstream);

      // release diskon (best-effort)
      try {
        await axios.post(
          `${selfBase}/api/levpay?action=discount.release`,
          { idTransaksi },
          { headers: { "Content-Type": "application/json" }, timeout: 12000 }
        );
      } catch (_) {}

      return send(res, 200, upRaw?.success === false ? upRaw : { success: true, data: unwrap(upRaw) });
    }

    // =========================
    // QR (proxy image)
    // =========================
    if (action === "qr") {
      const idTransaksi = String(req.query?.idTransaksi || "").trim();
      if (!idTransaksi) {
        res.statusCode = 400;
        return res.end("missing idTransaksi");
      }

      const upstream = await vpsTryGet(
        VPS_BASE,
        [
          `/api/qr?idTransaksi=${encodeURIComponent(idTransaksi)}`,
          `/api/qr/${encodeURIComponent(idTransaksi)}`,
          `/api/qr/${encodeURIComponent(idTransaksi)}.png`,
        ],
        { timeout: 20000, responseType: "arraybuffer" }
      );

      const buf = upstream.data;
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.end(Buffer.from(buf));
    }

    return send(res, 400, { success: false, error: "Unknown action" });
  } catch (e) {
    const msg =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      e?.message ||
      "Server error";
    return send(res, 500, { success: false, error: String(msg) });
  }
};