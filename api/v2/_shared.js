// api/v2/_shared.js
const axios = require("axios");
const base64 = require("base-64");

// === HARDCODE CONFIG (sama seperti index.js kamu) ===
const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  userId: "1331927",
  merchant: "NEVERMOREOK1331927",
};

const UA = "WebView";
const XRW = "com.orderkuota.app";
const REDIRECT_URL = "https://app.orderkuota.com/digital_app/qris";

function encRedirect() {
  return base64.encode(REDIRECT_URL);
}

function parseCookieHeader(setCookieArr) {
  const raw = Array.isArray(setCookieArr) ? setCookieArr.join(", ") : (setCookieArr || "");
  // ambil cookie key=val sampai sebelum koma cookie berikutnya
  const chunks = [...raw.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  return chunks.map(m => m[0]).join("; ");
}

function ok200to399(s) {
  return s >= 200 && s < 400;
}

// cari URL kasir atau endpoint dari HTML
function extractKasirFromHtml(html) {
  const s = String(html || "");

  // 1) cari full URL kasir
  const m1 = s.match(/https:\/\/kasir\.orderkuota\.com\/[^"'\\\s<>]+/i);
  if (m1) return { kasirUrl: m1[0] };

  // 2) kadang ada redirect via location.href / window.location
  const m2 = s.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (m2 && m2[1]) return { kasirUrl: m2[1] };

  return { kasirUrl: null };
}

// dari HTML kasir, cari path endpoint create/status
function extractEndpointsFromKasirHtml(html) {
  const s = String(html || "");
  const out = {};

  // ambil yang mengandung create_qris_image / status_pembayaran
  const create = s.match(/\/qris\/[^"'\\\s<>]*create_qris_image[^"'\\\s<>]*/i);
  const status = s.match(/\/qris\/[^"'\\\s<>]*status_pembayaran[^"'\\\s<>]*/i);

  if (create) out.createPath = create[0];
  if (status) out.statusPath = status[0];

  return out;
}

async function autologin() {
  const url = "https://app.orderkuota.com/api/v2/autologin";
  const r = await axios.get(url, {
    params: {
      auth_username: CONFIG.auth_username,
      auth_token: CONFIG.auth_token,
      redirect: encRedirect(),
    },
    headers: {
      "User-Agent": UA,
      "x-requested-with": XRW,
      "Accept": "*/*",
    },
    maxRedirects: 0,
    validateStatus: ok200to399, // FIX: terima 200..399
    timeout: 15000,
  });

  const cookieHeader = parseCookieHeader(r.headers["set-cookie"]);
  return { status: r.status, cookieHeader };
}

async function getRefererAndKasir(cookieHeader) {
  // buka halaman qris webview
  const r = await axios.get(REDIRECT_URL, {
    params: {
      auth_username: CONFIG.auth_username,
      auth_token: CONFIG.auth_token,
      redirect: encRedirect(),
    },
    headers: {
      "User-Agent": UA,
      "x-requested-with": XRW,
      "Cookie": cookieHeader,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    maxRedirects: 0,
    validateStatus: ok200to399, // FIX
    timeout: 15000,
  });

  // kalau 302 ada location -> itu biasanya referer kasir
  const loc = r.headers["location"];
  if (loc) {
    return {
      qrisStatus: r.status,
      referer: loc,
      kasirUrl: loc.includes("kasir.orderkuota.com") ? loc : null,
      qrisHasLocation: true,
      qrisHtmlBytes: 0,
    };
  }

  // kalau 200 -> parse HTML cari link kasir
  const html = typeof r.data === "string" ? r.data : "";
  const found = extractKasirFromHtml(html);

  return {
    qrisStatus: r.status,
    referer: found.kasirUrl || REDIRECT_URL,
    kasirUrl: found.kasirUrl,
    qrisHasLocation: false,
    qrisHtmlBytes: Buffer.byteLength(html || "", "utf8"),
    qrisHtml: html || "",
  };
}

async function fetchKasirHtml(kasirUrl, cookieHeader) {
  if (!kasirUrl) return { ok: false, status: 0, html: "" };

  const r = await axios.get(kasirUrl, {
    headers: {
      "User-Agent": UA,
      "x-requested-with": XRW,
      "Cookie": cookieHeader,
      "Accept": "text/html,*/*",
      "Referer": REDIRECT_URL,
    },
    maxRedirects: 0,
    validateStatus: s => s >= 200 && s < 500,
    timeout: 15000,
  });

  const html = typeof r.data === "string" ? r.data : "";
  return { ok: r.status >= 200 && r.status < 400, status: r.status, html };
}

module.exports = {
  CONFIG,
  UA,
  XRW,
  REDIRECT_URL,
  autologin,
  getRefererAndKasir,
  fetchKasirHtml,
  extractEndpointsFromKasirHtml,
};
