// api/tx/search.js
const { jsonGet, listDeviceTxIds } = require("../_lib/kvjson");

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method Not Allowed" });

  const deviceId = safeStr(req.query.deviceId);
  const q = safeStr(req.query.q);
  const limit = Number(req.query.limit || 80);

  if (!deviceId) return res.status(400).json({ success: false, error: "deviceId required" });
  if (!q) return res.status(400).json({ success: false, error: "q required" });

  const ids = await listDeviceTxIds(deviceId, limit);
  const qq = q.toUpperCase();

  const matchedIds = ids.filter((id) => String(id).toUpperCase().includes(qq)).slice(0, 30);

  const out = [];
  for (const id of matchedIds) {
    const tx = await jsonGet(`tx:${id}`, null);
    if (tx) out.push(tx);
  }

  res.json({ success: true, deviceId, q, count: out.length, data: out });
};
