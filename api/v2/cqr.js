// api/v2/cqr.js
const axios = require("axios");
const {
  CONFIG,
  UA,
  XRW,
  REDIRECT_URL,
  autologin,
  getRefererAndKasir,
  fetchKasirHtml,
  extractEndpointsFromKasirHtml,
} = require("./_shared");

function sendJson(res, code, obj) {
  res.status(code).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj, null, 2));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, {
        success: false,
        message: "Method Not Allowed. Use POST JSON.",
        example: { nominal: 1 },
      });
    }

    const body = typeof req.body === "object" ? req.body : {};
    const nominal = Number(body.nominal);
    if (!Number.isFinite(nominal) || nominal < 1) {
      return sendJson(res, 400, { success: false, message: "nominal invalid", example: { nominal: 1 } });
    }

    // 1) autologin ambil cookie
    const login = await autologin();
    const cookieHeader = login.cookieHeader || "";

    // 2) buka qris page ambil referer/kasirUrl (FIX terima 200/302)
    const step2 = await getRefererAndKasir(cookieHeader);

    // 3) kalau dapat kasirUrl, fetch HTML kasir untuk cari endpoint yang bener (biar ga 404)
    let kasirHtml = "";
    let kasirStatus = 0;
    let endpoints = {};
    if (step2.kasirUrl) {
      const kas = await fetchKasirHtml(step2.kasirUrl, cookieHeader);
      kasirStatus = kas.status;
      kasirHtml = kas.html || "";
      endpoints = extractEndpointsFromKasirHtml(kasirHtml);
    }

    // 4) tentuin path create endpoint
    // - kalau ketemu di HTML kasir -> pakai itu
    // - fallback: path lama
    const createPath =
      endpoints.createPath ||
      "/qris/curl/create_qris_image.php";

    const createUrl = `https://kasir.orderkuota.com${createPath}`;

    // 5) request gambar QR (arraybuffer)
    const r = await axios.get(createUrl, {
      params: { merchant: CONFIG.merchant, nominal: String(nominal) },
      headers: {
        "User-Agent": UA,
        "x-requested-with": XRW,
        "Accept": "image/*,*/*",
        "Referer": step2.referer || REDIRECT_URL,
        "Cookie": cookieHeader,
      },
      responseType: "arraybuffer",
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 500,
      timeout: 20000,
    });

    const ct = String(r.headers["content-type"] || "").toLowerCase();
    const isImage = ct.includes("image/");

    if (!isImage) {
      // biasanya 404 html / blokir / dll
      const headPreview = Buffer.from(r.data || "").toString("utf8").slice(0, 220);

      return sendJson(res, 200, {
        success: true,
        merchant: CONFIG.merchant,
        nominal,
        upstreamStatus: r.status,
        debug: {
          autologinStatus: login.status,
          qrisStatus: step2.qrisStatus,
          qrisHasLocation: step2.qrisHasLocation,
          qrisHtmlBytes: step2.qrisHtmlBytes,
          kasirPageStatus: kasirStatus || null,
          createPathUsed: createPath,
          createContentType: ct || null,
          refererUsed: step2.referer || null,
        },
        error: "create_qris_image upstream not OK",
        headPreview,
      });
    }

    // return base64 PNG (biar gampang dipakai)
    const buf = Buffer.from(r.data);
    const b64 = buf.toString("base64");

    return sendJson(res, 200, {
      success: true,
      merchant: CONFIG.merchant,
      nominal,
      upstreamStatus: r.status,
      contentType: ct,
      pngBase64: b64,
      bytes: buf.length,
      debug: {
        autologinStatus: login.status,
        qrisStatus: step2.qrisStatus,
        qrisHasLocation: step2.qrisHasLocation,
        kasirPageStatus: kasirStatus || null,
        createPathUsed: createPath,
        refererUsed: step2.referer || null,
      },
    });
  } catch (e) {
    return sendJson(res, 200, {
      success: false,
      message: "internal error",
      error: e?.message || "unknown",
    });
  }
};
