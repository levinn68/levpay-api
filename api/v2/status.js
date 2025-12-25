// api/v2/status.js
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

    const login = await autologin();
    const cookieHeader = login.cookieHeader || "";

    const step2 = await getRefererAndKasir(cookieHeader);

    let kasirHtml = "";
    let kasirStatus = 0;
    let endpoints = {};
    if (step2.kasirUrl) {
      const kas = await fetchKasirHtml(step2.kasirUrl, cookieHeader);
      kasirStatus = kas.status;
      kasirHtml = kas.html || "";
      endpoints = extractEndpointsFromKasirHtml(kasirHtml);
    }

    const statusPath =
      endpoints.statusPath ||
      "/qris/curl/status_pembayaran.php";

    const statusUrl = `https://kasir.orderkuota.com${statusPath}`;

    const timestamp = Date.now().toString();

    const r = await axios.get(statusUrl, {
      params: { timestamp, merchant: CONFIG.merchant, nominal: String(nominal) },
      headers: {
        "User-Agent": UA,
        "x-requested-with": XRW,
        "Accept": "application/json",
        "content-type": "application/json",
        "Referer": step2.referer || REDIRECT_URL,
        "Cookie": cookieHeader,
      },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 500,
      timeout: 20000,
    });

    // jangan “auto paid” dari sini — return raw aja, index.js yang decide
    return sendJson(res, 200, {
      success: true,
      merchant: CONFIG.merchant,
      nominal,
      upstreamStatus: r.status,
      data: r.data,
      debug: {
        autologinStatus: login.status,
        qrisStatus: step2.qrisStatus,
        qrisHasLocation: step2.qrisHasLocation,
        qrisHtmlBytes: step2.qrisHtmlBytes,
        kasirPageStatus: kasirStatus || null,
        statusPathUsed: statusPath,
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
