// api/v2/status.js
// LevPay V2 - Status via QRIS Mutasi (Orderkuota API v2)
// Ada CACHE + COOLDOWN (biar ga kena 469 terus)

const axios = require("axios");
const crypto = require("crypto");

// ===== HARDCODE CONFIG (sama kayak index.js lu) =====
const CONFIG = {
  userId: "1331927",
  auth_username: "vinzyy",
  auth_token: "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh",
};

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function generateSignature(authToken, timestamp) {
  const cleanedToken = String(authToken || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
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

async function fetchMutasiV2() {
  const timestamp = Date.now().toString();
  const signature = generateSignature(CONFIG.auth_token, timestamp);
  const url = `https://app.orderkuota.com/api/v2/qris/mutasi/${CONFIG.userId}`;

  const payload = new URLSearchParams();
  payload.append("auth_username", CONFIG.auth_username);
  payload.append("requests[qris_history][jenis]", "kredit");
  payload.append("requests[qris_history][page]", "1");
  payload.append("auth_token", CONFIG.auth_token);

  const headers = {
    "User-Agent": "okhttp/4.12.0",
    Connection: "Keep-Alive",
    "Accept-Encoding": "gzip",
    Signature: signature,
    Timestamp: timestamp,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const r = await axios.post(url, payload.toString(), {
    headers,
    timeout: 15000,
    validateStatus: () => true,
  });

  return { status: r.status, data: r.data };
}

// ====== cache & cooldown (global in lambda instance) ======
let CACHE = { at: 0, data: null, status: 0 };
let COOLDOWN_UNTIL = 0;

// dd/mm/yyyy hh:mm -> ms (WIB)
function parseTanggalWIB(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
  const HH = Number(m[4]), MI = Number(m[5]);
  // bikin Date UTC dari WIB (UTC+7)
  const utcMs = Date.UTC(yy, mm - 1, dd, HH - 7, MI, 0);
  return Number.isFinite(utcMs) ? utcMs : null;
}

// ambil array mutasi dari struktur apapun (biar tahan perubahan)
function findMutasiArray(root) {
  // umumnya: root.results.qris_history.data (atau mirip)
  const walk = (obj, depth = 0) => {
    if (!obj || depth > 6) return null;
    if (Array.isArray(obj) && obj.length && typeof obj[0] === "object") return obj;
    if (typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      const got = walk(obj[k], depth + 1);
      if (got) return got;
    }
    return null;
  };
  return walk(root);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Method Not Allowed. Use POST JSON.",
      example: { nominal: 1000, sinceMs: Date.now() - 5 * 60 * 1000 },
    });
  }

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const nominal = Math.floor(Number(body?.nominal || 0));
    const sinceMs = Number.isFinite(Number(body?.sinceMs)) ? Number(body.sinceMs) : Date.now() - 10 * 60 * 1000;

    if (!Number.isFinite(nominal) || nominal < 1) {
      return json(res, 400, { success: false, message: "nominal invalid", example: { nominal: 1 } });
    }

    const now = Date.now();

    // cooldown aktif (kalau sebelumnya kena 469)
    if (now < COOLDOWN_UNTIL) {
      const retryAfterSec = Math.ceil((COOLDOWN_UNTIL - now) / 1000);
      return json(res, 200, {
        success: true,
        paid: false,
        cooldown: true,
        retryAfterSec,
        note: "Kena limit 469 dari upstream. Tunggu dulu sebelum cek lagi.",
        cacheAgeMs: CACHE.at ? now - CACHE.at : null,
        cached: !!CACHE.data,
      });
    }

    // cache 3 detik biar ga spam
    if (CACHE.data && now - CACHE.at < 3000) {
      const arr = findMutasiArray(CACHE.data) || [];
      const match = arr.find((x) => {
        const kredit = Math.floor(Number(x?.kredit || 0));
        const t = parseTanggalWIB(x?.tanggal);
        return kredit === nominal && (t ? t >= sinceMs : true);
      });

      return json(res, 200, {
        success: true,
        paid: !!match,
        cached: true,
        cacheAgeMs: now - CACHE.at,
        match: match || null,
      });
    }

    const up = await fetchMutasiV2();

    // simpen cache
    CACHE = { at: now, data: up.data, status: up.status };

    // detek limit 469 dari pesan
    const msg = String(up?.data?.message || up?.data?.data?.message || "");
    if (up.status === 469 || /terlalu sering/i.test(msg)) {
      COOLDOWN_UNTIL = now + 5 * 60 * 1000; // 5 menit
      return json(res, 200, {
        success: true,
        paid: false,
        cooldown: true,
        retryAfterSec: 300,
        upstreamStatus: up.status,
        upstreamMessage: msg || "Rate limited",
      });
    }

    const arr = findMutasiArray(up.data) || [];
    const match = arr.find((x) => {
      const kredit = Math.floor(Number(x?.kredit || 0));
      const t = parseTanggalWIB(x?.tanggal);
      return kredit === nominal && (t ? t >= sinceMs : true);
    });

    return json(res, 200, {
      success: true,
      paid: !!match,
      upstreamStatus: up.status,
      match: match || null,
    });
  } catch (e) {
    return json(res, 500, { success: false, message: "internal error", error: e?.message || "unknown" });
  }
};
