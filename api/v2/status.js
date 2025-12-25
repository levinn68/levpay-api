// api/v2/status.js
const axios = require("axios");
const base64 = require("base-64");

const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  merchant: "NEVERMOREOK1331927",
  timeoutMs: 20000,
  maxHops: 8,
};

function parseSetCookieToHeader(setCookies) {
  const raw = (setCookies || []).join(", ") || "";
  const cookieChunks = [...raw.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return cookieChunks.map((m) => m[0]).join("; ");
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

function absolutize(baseUrl, maybeRelative) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractKasirUrlFromHtml(html, baseUrl) {
  const s = String(html || "");

  const meta = s.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i);
  if (meta && meta[1]) return absolutize(baseUrl, meta[1]);

  const loc1 = s.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (loc1 && loc1[1]) return absolutize(baseUrl, loc1[1]);

  const loc2 = s.match(/location\.href\s*=\s*["']([^"']+)["']/i);
  if (loc2 && loc2[1]) return absolutize(baseUrl, loc2[1]);

  const kasirAbs = s.match(/https?:\/\/kasir\.orderkuota\.com\/[^"'<> ]+/i);
  if (kasirAbs && kasirAbs[0]) return kasirAbs[0];

  const kasirRel = s.match(/["'](\/qris\/[^"']+)["']/i);
  if (kasirRel && kasirRel[1]) return absolutize("https://kasir.orderkuota.com", kasirRel[1]);

  return null;
}

async function followRedirectsGet(startUrl, headersBase, cookieStart) {
  let url = startUrl;
  let cookie = cookieStart || "";
  const chain = [];

  for (let hop = 0; hop < CONFIG.maxHops; hop++) {
    const resp = await axios.get(url, {
      headers: { ...headersBase, Cookie: cookie || undefined },
      maxRedirects: 0,
      timeout: CONFIG.timeoutMs,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    chain.push({ hop, url, status: resp.status, hasLocation: !!resp.headers?.location });

    const setC = parseSetCookieToHeader(resp.headers?.["set-cookie"]);
    cookie = mergeCookies(cookie, setC);

    const loc = resp.headers?.location ? absolutize(url, resp.headers.location) : null;

    if (loc && resp.status >= 300 && resp.status < 400) {
      url = loc;
      continue;
    }

    if (resp.status === 200 && typeof resp.data === "string") {
      const maybeKasir = extractKasirUrlFromHtml(resp.data, url);
      if (maybeKasir && maybeKasir !== url) {
        url = maybeKasir;
        continue;
      }
    }

    return { finalUrl: url, cookie, chain };
  }

  return { finalUrl: url, cookie, chain };
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

  const redirectTarget = "https://app.orderkuota.com/digital_app/qris";
  const encodedRedirect = base64.encode(redirectTarget);

  const headersBase = {
    "User-Agent": "WebView",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate",
    "x-requested-with": "com.orderkuota.app",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  try {
    const loginResp = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
      params: {
        auth_username: CONFIG.auth_username,
        auth_token: CONFIG.auth_token,
        redirect: encodedRedirect,
      },
      headers: headersBase,
      maxRedirects: 0,
      timeout: CONFIG.timeoutMs,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const appCookie = parseSetCookieToHeader(loginResp.headers?.["set-cookie"]);
    const startLoc =
      loginResp.headers?.location
        ? absolutize("https://app.orderkuota.com/api/v2/autologin", loginResp.headers.location)
        : redirectTarget;

    const follow = await followRedirectsGet(startLoc, headersBase, appCookie);
    const refererUrl = follow.finalUrl || redirectTarget;
    const cookieHeader = follow.cookie || appCookie;

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
        startLoc,
        finalUrl: follow.finalUrl,
        finalIsKasir: String(follow.finalUrl || "").includes("kasir.orderkuota.com"),
        chain: follow.chain,
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
