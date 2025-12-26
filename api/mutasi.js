// /api/mutasi.js
const axios = require("axios");
const crypto = require("crypto");

// ✅ HARD-CODE (sesuai request lu)
const AUTH_USERNAME = "vinzyy";
const AUTH_TOKEN = "1331927:cCVk0A4be8WL2ONriangdHJvU7utmfTh";
const USER_ID = "1331927"; // v2 pake userId

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

function toStr(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

function normalizeAmount(kredit) {
  // "120.000" -> "120000"
  return toStr(kredit).replace(/\./g, "").replace(/,/g, "");
}

function mapOrderkuotaToLite(item) {
  return {
    id: toStr(item?.id),
    date: toStr(item?.tanggal).replace(/\//g, "-"), // biar enak dibaca aja
    amount: normalizeAmount(item?.kredit),
    type: "CR", // v2 request lu kredit doang
    brand: toStr(item?.brand?.name),
    note: toStr(item?.keterangan),
    balance: normalizeAmount(item?.saldo_akhir),
    status: toStr(item?.status),
    fee: toStr(item?.fee),
    logo: toStr(item?.brand?.logo),
  };
}

async function fetchQrisMutasiV2() {
  const timestamp = Date.now().toString();
  const signature = generateSignature(AUTH_TOKEN, timestamp);

  const url = `https://app.orderkuota.com/api/v2/qris/mutasi/${USER_ID}`;

  const payload = new URLSearchParams();
  payload.append("auth_username", AUTH_USERNAME);
  payload.append("requests[qris_history][jenis]", "kredit");
  payload.append("requests[qris_history][page]", "1");
  payload.append("auth_token", AUTH_TOKEN);

  const headers = {
    "User-Agent": "okhttp/4.12.0",
    Connection: "Keep-Alive",
    "Accept-Encoding": "gzip",
    Signature: signature,
    Timestamp: timestamp,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  try {
    const resp = await axios.post(url, payload.toString(), { headers });
    return { upstreamStatus: resp.status, data: resp.data };
  } catch (err) {
    const st = err?.response?.status || 500;
    const dt = err?.response?.data || { success: false, message: err.message };
    return { upstreamStatus: st, data: dt };
  }
}

module.exports = async (req, res) => {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
      hint: "POST /api/mutasi JSON",
      example: {},
    });
  }

  // ✅ IGNORE mode apapun (kasir/v2/dll) -> selalu V2
  const { upstreamStatus, data } = await fetchQrisMutasiV2();

  const ok = !!data?.success;
  const msg = data?.message || null;

  const results = data?.qris_history?.results || [];
  const mutasi = Array.isArray(results) ? results.map(mapOrderkuotaToLite) : [];

  // account kadang ada (tergantung respon lu sebelumnya)
  const accountRaw = data?.account?.results || null;
  const account = accountRaw
    ? {
        id: toStr(accountRaw?.id),
        username: toStr(accountRaw?.username),
        name: toStr(accountRaw?.name),
        email: toStr(accountRaw?.email),
        phone: toStr(accountRaw?.phone),
        balance: normalizeAmount(accountRaw?.balance_str || accountRaw?.balance),
        qris_balance: normalizeAmount(
          accountRaw?.qris_balance_str || accountRaw?.qris_balance
        ),
        qris_name: toStr(accountRaw?.qris_name),
        qris_url: toStr(accountRaw?.qris),
      }
    : null;

  // merchant id model sawargi biar mirip (OK1331927)
  const merchant = `OK${USER_ID}`;

  // ✅ response rapih + raw tetep disimpen biar gampang debug
  return res.status(200).json({
    ok,
    message: ok ? "OK" : msg,
    merchant,
    userId: USER_ID,
    mutasi,
    count: mutasi.length,
    account,
    upstreamStatus,
    raw: data,
  });
};
