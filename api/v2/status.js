// api/v2/status.js
const axios = require("axios");
const base64 = require("base-64");

const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  merchant: "NEVERMOREOK1331927",
  timeoutMs: 20000,
};

function accept200_399(status) {
  return status >= 200 && status < 400;
}

function mergeCookies(cookieA, cookieB) {
  const m = new Map();
  function add(s) {
    String(s || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((kv) => {
        const eq = kv.indexOf("=");
        if (eq <= 0) return;
        const k = kv.slice(0, eq).trim();
        const v = kv.slice(eq + 1).trim();
        if (k) m.set(k, v);
      });
  }
  add(cookieA);
  add(cookieB);
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function parseSetCookieToHeader(setCookies) {
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

function extractKasirUrlFromHtml(html) {
  const s = String(html || "");
  const meta = s.match(/url\s*=\s*([^"'>\s]+)/i);
  if (meta && meta[1] && meta[1].startsWith("http")) return meta[1];

  const loc1 = s.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (loc1 && loc1[1] && loc1[1].startsWith("http")) return loc1[1];

  const loc2 = s.match(/location\.href\s*=\s*["']([^"']+)["']/i);
  if (loc2 && loc2[1] && loc2[1].startsWith("http")) return loc2[1];

  const kasir = s.match(/https?:\/\/kasir\.orderkuota\.com\/[^"'<> ]+/i);
  if (kasir && kasir[0]) return kasir[0];

  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST JSON.",
      example: { nominal: 1 },
    });
  }

  const nominal = Number(req.body?.nominal ?? req.body?.amount ?? 0);
  if (!Number.isFinite(nominal) || nominal < 1) {
    return res.status(400).json({
      success: false,
      message: "nominal invalid",
      example: { nominal: 1 },
    });
  }

  const merchant = String(req.body?.merchant || CONFIG.merchant).trim() || CONFIG.merchant;

  const headersBase = {
    "User-Agent": "WebView",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate",
    "x-requested-with": "com.orderkuota.app",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  try {
    const redirectTarget = "https://app.orderkuota.com/digital_app/qris";
    const encodedRedirect = base64.encode(redirectTarget);

    const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
      params: {
        auth_username: CONFIG.auth_username,
        auth_token: CONFIG.auth_token,
        redirect: encodedRedirect,
      },
      headers: headersBase,
      maxRedirects: 0,
      timeout: CONFIG.timeoutMs,
      validateStatus: accept200_399,
    });

    const appCookie = parseSetCookieToHeader(loginResp.headers["set-cookie"]);

    const qrisResp = await axios.get(redirectTarget, {
      params: {
        auth_username: CONFIG.auth_username,
        auth_token: CONFIG.auth_token,
        redirect: encodedRedirect,
      },
      headers: { ...headersBase, Cookie: appCookie },
      maxRedirects: 0,
      timeout: CONFIG.timeoutMs,
      validateStatus: accept200_399,
    });

    let refererUrl = qrisResp.headers?.location || null;
    if (!refererUrl && qrisResp.status === 200) {
      refererUrl = extractKasirUrlFromHtml(qrisResp.data) || null;
    }
    if (!refererUrl) refererUrl = getResponseUrl(qrisResp) || redirectTarget;

    // buka kasir page biar cookie kasir ada
    const kasirPageResp = await axios.get(refererUrl, {
      headers: { ...headersBase, Cookie: appCookie },
      maxRedirects: 5,
      timeout: CONFIG.timeoutMs,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    const kasirCookie = parseSetCookieToHeader(kasirPageResp.headers["set-cookie"]);
    const cookieHeader = mergeCookies(appCookie, kasirCookie);

    const timestamp = Date.now().toString();
    const stResp = await axios.get("https://kasir.orderkuota.com/qris/curl/status_pembayaran.php", {
      params: { timestamp, merchant, nominal },
      headers: {
        ...headersBase,
        Accept: "application/json",
        "content-type": "application/json",
        referer: refererUrl,
        Cookie: cookieHeader,
      },
      timeout: CONFIG.timeoutMs,
      validateStatus: (s) => s >= 200 && s < 500,
    });

    return res.json({
      success: true,
      merchant,
      nominal,
      upstreamStatus: stResp.status,
      debug: {
        autologinStatus: loginResp.status,
        qrisStatus: qrisResp.status,
        qrisHasLocation: !!qrisResp.headers?.location,
        refererUsed: refererUrl,
        kasirPageStatus: kasirPageResp.status,
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
