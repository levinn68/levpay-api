// api/tx/list.js
const { jsonGet, listDeviceTxIds } = require("../_lib/kvjson");

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

  const deviceId = safeStr(req.query.deviceId);
  const limit = Number(req.query.limit || 50);

  if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });

  const ids = await listDeviceTxIds(deviceId, limit);

  // ambil detailnya
  const out = [];
  for (const id of ids) {
    const tx = await jsonGet(`tx:${id}`, null);
    if (tx) out.push(tx);
  }

  res.json({ success: true, deviceId, count: out.length, data: out });
};
