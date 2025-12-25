// api/v2/status.js
const axios = require("axios");
const base64 = require("base-64");

// ===== HARDCODE CONFIG =====
const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  merchant: "NEVERMOREOK1331927",
};

function extractCookieHeader(setCookieArr) {
  if (!setCookieArr || !Array.isArray(setCookieArr)) return "";
  const rawCookie = setCookieArr.join(", ");
  const cookieChunks = [...rawCookie.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return cookieChunks.map((m) => m[0]).join("; ");
}

function ok200or302(status) {
  return status === 200 || status === 302;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method Not Allowed. Use POST JSON.",
        example: { nominal: 1 },
      });
    }

    const nominal = Number(req.body?.nominal);
    const merchant = String(req.body?.merchant || CONFIG.merchant).trim();

    if (!Number.isFinite(nominal) || nominal < 1) {
      return res.status(400).json({ success: false, message: "nominal invalid", example: { nominal: 1 } });
    }

    const redirectTarget = "https://app.orderkuota.com/digital_app/qris";
    const encodedRedirect = base64.encode(redirectTarget);

    const headersBase = {
      "User-Agent": "WebView",
      "x-requested-with": "com.orderkuota.app",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Connection: "keep-alive",
    };

    // autologin
    const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
      params: {
        auth_username: CONFIG.auth_username,
        auth_token: CONFIG.auth_token,
        redirect: encodedRedirect,
      },
      headers: headersBase,
      maxRedirects: 0,
      validateStatus: ok200or302,
    });

    const cookieHeader = extractCookieHeader(loginResp.headers["set-cookie"]);

    // qris page
    const qrisResp = await axios.get(redirectTarget, {
      params: {
        auth_username: CONFIG.auth_username,
        auth_token: CONFIG.auth_token,
        redirect: encodedRedirect,
      },
      headers: { ...headersBase, Cookie: cookieHeader },
      maxRedirects: 0,
      validateStatus: ok200or302,
    });

    const refererUsed = qrisResp.headers?.location || redirectTarget;

    // status pembayaran
    const timestamp = Date.now().toString();
    const stResp = await axios.get("https://kasir.orderkuota.com/qris/curl/status_pembayaran.php", {
      params: { timestamp, merchant, nominal },
      headers: {
        ...headersBase,
        Accept: "application/json",
        "content-type": "application/json",
        referer: refererUsed,
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    return res.status(200).json({
      success: true,
      merchant,
      nominal,
      upstreamStatus: stResp.status,
      debug: {
        autologinStatus: loginResp.status,
        qrisStatus: qrisResp.status,
        qrisHasLocation: !!qrisResp.headers?.location,
        refererUsed,
      },
      data: stResp.data,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "internal error",
      error: e?.message || "unknown",
    });
  }
};
