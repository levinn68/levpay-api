// api/paidhook.js
const crypto = require("crypto");
const { jsonSet, pushDeviceTx } = require("./_lib/kvjson");
const { assertCallbackSecret } = require("./_lib/auth");

function isoNow() {
  return new Date().toISOString();
}

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method Not Allowed" });
  if (!assertCallbackSecret(req, res)) return;

  const body = req.body || {};

  const idTransaksi = safeStr(body.idTransaksi);
  const status = String(body.status || "").toLowerCase().trim();

  // kita cuma simpen paid (sesuai permintaan lu)
  if (!idTransaksi) return res.status(400).json({ success: false, error: "idTransaksi required" });
  if (status !== "paid") return res.json({ success: true, ignored: true, reason: "not paid" });

  // ⚠️ penting buat per-device: VPS WAJIB kirim deviceId
  const deviceId = safeStr(body.deviceId) || "unknown";

  const tx = {
    idTransaksi,
    status: "paid",
    deviceId,

    paidAt: safeStr(body.paidAt) || isoNow(),
    paidVia: safeStr(body.paidVia) || "UNKNOWN",
    note: safeStr(body.note),

    amountOriginal: num(body.amountOriginal, 0),
    amountFinal: num(body.amountFinal ?? body.amount ?? 0, 0),
    discountRp: num(body.discountRp, 0),

    voucher: safeStr(body.voucher),           // kalau null ya null (nanti UI bisa tulis "Tidak pakai voucher")
    applied: Array.isArray(body.applied) ? body.applied : [],

    savedAt: isoNow(),
    sig: crypto.createHash("sha1").update(idTransaksi + "|" + deviceId + "|" + isoNow()).digest("hex").slice(0, 10),
  };

  // simpan detail transaksi
  await jsonSet(`tx:${idTransaksi}`, tx);

  // index per-device (buat list & search)
  await pushDeviceTx(deviceId, idTransaksi);

  return res.json({ success: true, saved: true, idTransaksi, deviceId });
};
