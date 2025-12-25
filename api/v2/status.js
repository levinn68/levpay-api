// api/v2/status.js
const axios = require("axios");
const base64 = require("base-64");

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
function accept200_399(status) {
  return status >= 200 && status < 400;
}
function parseCookieHeader(setCookies) {
  const raw = (setCookies || []).join(", ") || "";
  const cookieChunks = [...raw.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return cookieChunks.map((m) => m[0]).join("; ");
}
function getResponseUrl(resp) {
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

  const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: headersBase,
    maxRedirects: 0,
    timeout: CONFIG.timeoutMs,
    validateStatus: accept200_399,
  });

  const cookieHeader = parseCookieHeader(loginResp.headers["set-cookie"]);

  const qrisResp = await axios.get(redirectTarget, {
    params: { auth_username, auth_token, redirect: encodedRedirect },
    headers: { ...headersBase, Cookie: cookieHeader },
    maxRedirects: 0,
    timeout: CONFIG.timeoutMs,
    validateStatus: accept200_399,
  });

  let refererUrl = qrisResp.headers?.location || null;
  if (!refererUrl) refererUrl = getResponseUrl(qrisResp);
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return bad(res, 405, "Method Not Allowed. Use POST JSON.", { example: { nominal: 1 } });
  }

  const nominal = Number(req.body?.nominal ?? req.body?.amount ?? 0);
  if (!Number.isFinite(nominal) || nominal < 1) {
    return bad(res, 400, "nominal invalid", { example: { nominal: 1 } });
  }

  const merchant = String(req.body?.merchant || CONFIG.merchant).trim() || CONFIG.merchant;

  try {
    const session = await getCookieAndReferer(CONFIG.auth_username, CONFIG.auth_token);

    const timestamp = Date.now().toString();
    const resp = await axios.get("https://kasir.orderkuota.com/qris/curl/status_pembayaran.php", {
      params: { timestamp, merchant, nominal },
      headers: {
        ...session.headersBase,
        Accept: "application/json",
        "content-type": "application/json",
        referer: session.refererUrl,
        Cookie: session.cookieHeader,
      },
      timeout: CONFIG.timeoutMs,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    return ok(res, {
      merchant,
      nominal,
      upstreamStatus: resp.status,
      debug: session.upstream,
      data: resp.data,
    });
  } catch (e) {
    return bad(res, 500, "internal error", { error: e?.message || "unknown" });
  }
};
