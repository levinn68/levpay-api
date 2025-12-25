// api/v2/cqr.js
const axios = require("axios");
const base64 = require("base-64");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

// ===== HARDCODE CONFIG (samain kaya index.js lu) =====
const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  merchant: "NEVERMOREOK1331927",
  timeoutMs: 12000,
};

function bad(res, status, message, extra = {}) {
  res.status(status).json({ success: false, message, ...extra });
}
function ok(res, data) {
  res.status(200).json({ success: true, ...data });
}

function parseCookieHeader(setCookies) {
  const raw = (setCookies || []).join(", ") || "";
  const cookieChunks = [...raw.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return cookieChunks.map((m) => m[0]).join("; ");
}

async function getCookieAndReferer(auth_username, auth_token) {
  const redirectTarget = "https://app.orderkuota.com/digital_app/qris";
  const encodedRedirect = base64.encode(redirectTarget);

  const headersBase = {
    "User-Agent": "WebView",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
    "x-requested-with": "com.orderkuota.app",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  // autologin -> cookie
  const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: headersBase,
    maxRedirects: 0,
    timeout: CONFIG.timeoutMs,
    validateStatus: (s) => s === 302,
  });

  const cookieHeader = parseCookieHeader(loginResp.headers["set-cookie"]);

  // digital_app/qris -> referer location (302)
  const qrisResp = await axios.get(redirectTarget, {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: { ...headersBase, Cookie: cookieHeader },
    maxRedirects: 0,
    timeout: CONFIG.timeoutMs,
    validateStatus: (s) => s === 302,
  });

  return { cookieHeader, refererUrl: qrisResp.headers["location"], headersBase };
}

async function fetchQrisPngBuffer(merchant, nominal, session) {
  const resp = await axios.get("https://kasir.orderkuota.com/qris/curl/create_qris_image.php", {
    params: { merchant, nominal },
    headers: {
      ...session.headersBase,
      Accept: "image/*,*/*",
      Referer: session.refererUrl,
      Cookie: session.cookieHeader,
    },
    responseType: "arraybuffer",
    timeout: CONFIG.timeoutMs,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  return { upstreamStatus: resp.status, buffer: Buffer.from(resp.data) };
}

function decodeQrFromPng(buffer) {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png; // RGBA
  const code = jsQR(new Uint8ClampedArray(data), width, height);
  return code?.data ? String(code.data).trim() : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return bad(res, 405, "Method Not Allowed. Use POST JSON.", {
      example: { nominal: 1 },
    });
  }

  const nominal = Number(req.body?.nominal ?? req.body?.amount ?? 0);
  if (!Number.isFinite(nominal) || nominal < 1) {
    return bad(res, 400, "nominal invalid", { example: { nominal: 1 } });
  }

  const merchant = String(req.body?.merchant || CONFIG.merchant).trim() || CONFIG.merchant;

  try {
    const session = await getCookieAndReferer(CONFIG.auth_username, CONFIG.auth_token);
    const img = await fetchQrisPngBuffer(merchant, nominal, session);

    if (img.upstreamStatus >= 400) {
      return ok(res, {
        merchant,
        nominal,
        upstreamStatus: img.upstreamStatus,
        error: "create_qris_image upstream not OK",
      });
    }

    const qr_string = decodeQrFromPng(img.buffer);
    if (!qr_string) {
      return ok(res, {
        merchant,
        nominal,
        upstreamStatus: img.upstreamStatus,
        error: "QR decode failed (png ok tapi QR ga kebaca)",
      });
    }

    // opsional buat frontend: base64 png
    const png_base64 = img.buffer.toString("base64");

    return ok(res, {
      merchant,
      nominal,
      upstreamStatus: img.upstreamStatus,
      qr_string,
      png_base64,
    });
  } catch (e) {
    return bad(res, 500, "internal error", { error: e?.message || "unknown" });
  }
};
