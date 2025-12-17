// api/tx/get.js
const { jsonGet } = require("../_lib/kvjson");

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

  const idTransaksi = safeStr(req.query.idTransaksi);
  if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });

  const tx = await jsonGet(`tx:${idTransaksi}`, null);
  if (!tx) return res.status(404).json({ success: false, error: "not found" });

  res.json({ success: true, data: tx });
};
