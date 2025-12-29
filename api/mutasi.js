// api/mutasi.js (Vercel) - HTTPS + CORS proxy ke VPS /api/mutasi
// Env wajib: VPS_BASE (contoh: http://193.23.209.47:7032)

const axios = require("axios");

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}${path}`;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({
      status: false,
      message: "Method Not Allowed",
      author: "levin68",
      data: [],
    });
  }

  const VPS_BASE = process.env.VPS_BASE;
  if (!VPS_BASE) {
    return res.status(500).json({
      status: false,
      message: "Missing VPS_BASE env",
      author: "levin68",
      data: [],
    });
  }

  const url = joinUrl(VPS_BASE, "/api/mutasi");

  try {
    const resp = await axios.post(url, req.body || {}, {
      timeout: 25000,
      validateStatus: () => true,
      headers: { "Content-Type": "application/json" },
    });

    const body = resp?.data || {};
    // Pastikan shape mirip Sawargipay + author
    const out = {
      status: typeof body.status === "boolean" ? body.status : !!body.ok,
      message: body.message || (body.status ? "OK" : "FAIL"),
      author: body.author || "levin68",
      data: Array.isArray(body.data) ? body.data : Array.isArray(body.mutasi) ? body.mutasi : [],
    };

    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({
      status: false,
      message: e?.message || "Proxy error",
      author: "levin68",
      data: [],
    });
  }
};
