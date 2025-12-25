// api/mutasi.js — Vercel Serverless Function (Hardcoded Auth + Default userId)
// POST /api/mutasi
//
// Body (JSON):
// {
//   "mode": "kasir" | "v2",            // default: "kasir"
//   "merchant": "NEVERMOREOK1331927",  // wajib kalau mode=kasir
//   "userId": "1331927"               // optional kalau mode=v2 (default hardcoded)
// }
//
// Return:
// { success: true, mode, upstreamStatus, data } atau { success:false, error, message }

const axios = require("axios");
const crypto = require("crypto");
const base64 = require("base-64");

// ========= HARDCODE CONFIG =========
const CONFIG = {
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
  DEFAULT_USER_ID: "1331927",
};

// ---------- CORS ----------
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// =====================
// MODE V2 (Signature)
// =====================
function generateSignature(authToken, timestamp) {
  const cleanedToken = authToken.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const message = `${cleanedToken}:${timestamp}`;
  const key = `000${timestamp}`;

  const sha = crypto.createHash("sha512");
  sha.update(key);
  const shaClone = sha.copy();
  shaClone.update(message);
  const digest = shaClone.digest("hex");

  const last10 = digest.slice(-10);
  const middle = digest.slice(10, -10);
  const first10 = digest.slice(0, 10);

  return last10 + middle + first10;
}

async function fetchQrisMutasi(userId) {
  const authUsername = CONFIG.auth_username;
  const authToken = CONFIG.auth_token;

  const timestamp = Date.now().toString();
  const signature = generateSignature(authToken, timestamp);
  const url = `https://app.orderkuota.com/api/v2/qris/mutasi/${userId}`;

  const payload = new URLSearchParams();
  payload.append("auth_username", authUsername);
  payload.append("requests[qris_history][jenis]", "kredit");
  payload.append("requests[qris_history][page]", "1");
  payload.append("auth_token", authToken);

  const headers = {
    "User-Agent": "okhttp/4.12.0",
    Connection: "Keep-Alive",
    "Accept-Encoding": "gzip",
    Signature: signature,
    Timestamp: timestamp,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const response = await axios.post(url, payload.toString(), {
    headers,
    timeout: 12000,
    validateStatus: () => true,
  });

  return { httpStatus: response.status, data: response.data };
}

// ========================
// MODE KASIR (Autologin)
// ========================
async function cekMutasiKasir(merchant) {
  const auth_username = CONFIG.auth_username;
  const auth_token = CONFIG.auth_token;

  const redirectUrl = "https://app.orderkuota.com/digital_app/qris";
  const encodedRedirect = base64.encode(redirectUrl);

  // 🔐 Autologin untuk mendapatkan cookie
  const autologinResponse = await axios.get("https://app.orderkuota.com/api/v2/autologin", {
    params: {
      auth_username,
      auth_token,
      redirect: encodedRedirect,
    },
    headers: {
      "User-Agent": "WebView",
      "x-requested-with": "com.orderkuota.app",
    },
    maxRedirects: 0,
    timeout: 12000,
    validateStatus: (status) => status === 302 || status === 200,
  });

  const rawCookie = autologinResponse.headers["set-cookie"]?.join(", ") || "";
  const cookieChunks = [...rawCookie.matchAll(/\b[\w_]+=.*?(?=,\s\w+=|$)/g)];
  const cookieHeader = cookieChunks.map((m) => m[0]).join("; ");

  // 🔗 Ambil referer QRIS
  const qrisResponse = await axios.get("https://app.orderkuota.com/digital_app/qris", {
    params: {
      auth_username,
      auth_token,
      redirect: encodedRedirect,
    },
    headers: {
      "User-Agent": "WebView",
      "x-requested-with": "com.orderkuota.app",
      Cookie: cookieHeader,
    },
    maxRedirects: 0,
    timeout: 12000,
    validateStatus: (status) => status === 302 || status === 200,
  });

  const refererUrl = qrisResponse.headers["location"] || "https://app.orderkuota.com/digital_app/qris";
  const timestamp = Date.now().toString();

  // 📥 Request ke mutasi.php
  const response = await axios.get("https://kasir.orderkuota.com/qris/curl/mutasi.php", {
    params: {
      timestamp,
      merchant,
    },
    headers: {
      "User-Agent": "WebView",
      Accept: "application/json",
      "content-type": "application/json",
      "x-requested-with": "com.orderkuota.app",
      referer: refererUrl,
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    timeout: 12000,
    validateStatus: () => true,
  });

  return { httpStatus: response.status, data: response.data };
}

// ======================
// VERCEL HANDLER
// ======================
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      error: "Method Not Allowed",
      hint: "POST /api/mutasi JSON",
      exampleKasir: { mode: "kasir", merchant: "NEVERMOREOK1331927" },
      exampleV2: { mode: "v2", userId: CONFIG.DEFAULT_USER_ID },
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const mode = String(body.mode || "kasir").toLowerCase().trim();

  try {
    if (!CONFIG.auth_username || !CONFIG.auth_token) {
      return sendJson(res, 500, { success: false, error: "Hardcoded auth kosong" });
    }

    if (mode === "v2") {
      const userId = String(body.userId || CONFIG.DEFAULT_USER_ID || "").trim();
      if (!userId) return sendJson(res, 400, { success: false, error: "mode=v2 butuh userId" });

      const out = await fetchQrisMutasi(userId);

      return sendJson(res, 200, {
        success: true,
        mode: "v2",
        userId,
        upstreamStatus: out.httpStatus,
        data: out.data,
      });
    }

    // default: kasir
    const merchant = String(body.merchant || "").trim();
    if (!merchant) return sendJson(res, 400, { success: false, error: "mode=kasir butuh merchant" });

    const out = await cekMutasiKasir(merchant);

    return sendJson(res, 200, {
      success: true,
      mode: "kasir",
      merchant,
      upstreamStatus: out.httpStatus,
      data: out.data,
    });
  } catch (e) {
    return sendJson(res, 500, {
      success: false,
      error: "Server error",
      message: e?.message || String(e),
    });
  }
};
