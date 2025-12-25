// api/v2/cqr.js
const axios = require("axios");
const base64 = require("base-64");

// ===== HARDCODE CONFIG (sama kaya index.js lu) =====
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
      return res.status(400).json({
        success: false,
        message: "nominal invalid",
        example: { nominal: 1 },
      });
    }

    const redirectTarget = "https://app.orderkuota.com/digital_app/qris";
    const encodedRedirect = base64.encode(redirectTarget);

    const headersBase = {
      "User-Agent": "WebView",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      "x-requested-with": "com.orderkuota.app",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Connection: "keep-alive",
    };

    // STEP 1: autologin (TERIMA 200/302, jangan ngunci 302 doang)
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

    // STEP 2: buka /digital_app/qris (kadang 200, kadang 302)
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

    // kalau dapet location (302), pake itu sebagai referer.
    // kalau 200 (no location), fallback ke redirectTarget (ini FIX penting).
    const refererUsed = qrisResp.headers?.location || redirectTarget;

    // STEP 3: hit create_qris_image.php
    const imgResp = await axios.get("https://kasir.orderkuota.com/qris/curl/create_qris_image.php", {
      params: { merchant, nominal },
      headers: {
        ...headersBase,
        Accept: "image/*,*/*",
        Referer: refererUsed,
      },
      responseType: "arraybuffer",
      timeout: 15000,
      // terima status apa aja biar kita bisa debug HTML 404 juga
      validateStatus: () => true,
    });

    const ct = String(imgResp.headers["content-type"] || "").toLowerCase();
    const upstreamStatus = imgResp.status;

    // Kalau balik HTML (biasanya 404 fake), return debug headPreview
    if (!ct.includes("image/")) {
      const headPreview = Buffer.from(imgResp.data || "")
        .toString("utf8")
        .slice(0, 250);

      return res.status(200).json({
        success: true,
        merchant,
        nominal,
        upstreamStatus,
        debug: {
          autologinStatus: loginResp.status,
          qrisStatus: qrisResp.status,
          qrisHasLocation: !!qrisResp.headers?.location,
          refererUsed,
        },
        error: "create_qris_image upstream not OK",
        headPreview,
      });
    }

    // OK image/png
    const b64 = Buffer.from(imgResp.data).toString("base64");

    // option: kalau client minta raw image (biar gampang dipake front)
    if (String(req.query?.raw || "") === "1") {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(Buffer.from(imgResp.data));
    }

    return res.status(200).json({
      success: true,
      merchant,
      nominal,
      upstreamStatus,
      debug: {
        autologinStatus: loginResp.status,
        qrisStatus: qrisResp.status,
        qrisHasLocation: !!qrisResp.headers?.location,
        refererUsed,
      },
      // kirim base64 biar bisa langsung render:
      // <img src="data:image/png;base64,...." />
      imageBase64: b64,
      contentType: "image/png",
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "internal error",
      error: e?.message || "unknown",
    });
  }
};
