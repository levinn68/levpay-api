// api/_lib/kvjson.js
const { kv } = require("@vercel/kv");

const MAX_TX_PER_DEVICE = 1500;

async function jsonGet(key, fallback = null) {
  const v = await kv.get(key);
  return v ?? fallback;
}

async function jsonSet(key, value) {
  await kv.set(key, value);
}

async function pushDeviceTx(deviceId, idTransaksi) {
  const listKey = `dev:${deviceId}:paid`;

  // coba pakai Redis list command (kalau tersedia)
  try {
    // hapus duplikat lalu push ke depan
    await kv.lrem(listKey, 0, idTransaksi);
    await kv.lpush(listKey, idTransaksi);
    await kv.ltrim(listKey, 0, MAX_TX_PER_DEVICE - 1);
    return;
  } catch (_) {
    // fallback: simpan array JSON
    const arr = (await jsonGet(listKey, [])) || [];
    const next = [idTransaksi, ...arr.filter((x) => x !== idTransaksi)].slice(0, MAX_TX_PER_DEVICE);
    await jsonSet(listKey, next);
  }
}

async function listDeviceTxIds(deviceId, limit = 50) {
  const listKey = `dev:${deviceId}:paid`;
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));

  try {
    const ids = await kv.lrange(listKey, 0, lim - 1);
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    const arr = (await jsonGet(listKey, [])) || [];
    return Array.isArray(arr) ? arr.slice(0, lim) : [];
  }
}

module.exports = {
  kv,
  jsonGet,
  jsonSet,
  pushDeviceTx,
  listDeviceTxIds,
};
