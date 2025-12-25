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
  timeoutMs: 15000,
};

function bad(res, status, message, extra = {}) {
  res.status(status).json({ success: false, message, ...extra });
}
function ok(res, data) {
  res.status(200).json({ success: true, ...data });
}

// terima 200-399 biar gak kelempar "status code 200"
function accept200_399(status) {
  return status >= 200 && status < 400;
}

function parseCookieHeader(setCookies) {
  const raw = (setCookies || []).join(", ") || "";
  const cookieChunks = [...raw.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return cookieChunks.map((m) => m[0]).join("; ");
}

function getResponseUrl(resp) {
  // axios node: biasanya ada responseUrl di request.res
  return (
    resp?.request?.res?.responseUrl ||
    resp?.request?._redirectable?._currentUrl ||
    null
  );
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

  // 1) autologin (bisa 302 / bisa 200)
  const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: headersBase,
    maxRedirects: 0, // biar kita bisa ambil set-cookie kalau 302
    timeout: CONFIG.timeoutMs,
    validateStatus: accept200_399,
  });

  const cookieHeader = parseCookieHeader(loginResp.headers["set-cookie"]);

  // 2) buka digital_app/qris (bisa 302 / bisa 200)
  const qrisResp = await axios.get(redirectTarget, {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: { ...headersBase, Cookie: cookieHeader },
    maxRedirects: 0,
    timeout: CONFIG.timeoutMs,
    validateStatus: accept200_399,
  });

  // referer utama: location kalau ada
  let refererUrl = qrisResp.headers?.location || null;

  // fallback: responseUrl kalau tidak ada location
  if (!refererUrl) refererUrl = getResponseUrl(qrisResp);

  // fallback terakhir: halaman qris itu sendiri
  if (!refererUrl) refererUrl = redirectTarget;

  return {
    cookieHeader,
    refererUrl,
    headersBase,
    upstream: {
      autologinStatus: loginResp.status,
      qrisStatus: qrisResp.status,
      qrisHasLocation: !!qrisResp.headers?.location,
    },
  };
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

  return { upstreamStatus: resp.status, buffer: Buffer.from(resp.data || []) };
}

function decodeQrFromPng(buffer) {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png; // RGBA
  const code = jsQR(new Uint8ClampedArray(data), width, height);
  return code?.data ? String(code.data).trim() : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return bad(res, 405, "Method Not Allowed. Use POST JSON.", { example: { nominal: 1 } });
  }

  const nominal = Number(req.body?.nominal ?? req.body?.amount ?? 0);
  if (!Number.isFinite(nominal) || nominal < 1) {
    return bad(res, 400, "nominal invalid", { example: { nominal: 1 } });
  }

  // hardcode merchant by default
  const merchant = String(req.body?.merchant || CONFIG.merchant).trim() || CONFIG.merchant;

  try {
    const session = await getCookieAndReferer(CONFIG.auth_username, CONFIG.auth_token);

    const img = await fetchQrisPngBuffer(merchant, nominal, session);

    // kalau upstream ngembaliin HTML 200, QR decode bakal gagal -> kasih debug kecil
    if (img.upstreamStatus >= 400) {
      return ok(res, {
        merchant,
        nominal,
        upstreamStatus: img.upstreamStatus,
        debug: session.upstream,
        error: "create_qris_image upstream not OK",
      });
    }

    const qr_string = decodeQrFromPng(img.buffer);
    if (!qr_string) {
      // deteksi cepat kalau ternyata HTML (bukan PNG)
      const head = img.buffer.slice(0, 40).toString("utf8");
      const looksHtml = head.includes("<!DOCTYPE") || head.includes("<html") || head.includes("<HTML");
      return ok(res, {
        merchant,
        nominal,
        upstreamStatus: img.upstreamStatus,
        debug: session.upstream,
        error: looksHtml ? "Upstream returned HTML (bot/blocked?)" : "QR decode failed",
        headPreview: head,
      });
    }

    return ok(res, {
      merchant,
      nominal,
      upstreamStatus: img.upstreamStatus,
      debug: session.upstream,
      qr_string,
      png_base64: img.buffer.toString("base64"),
    });
  } catch (e) {
    return bad(res, 500, "internal error", { error: e?.message || "unknown" });
  }
};
