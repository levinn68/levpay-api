function ensureTx(db) {
  db.tx = db.tx || {};
  db.txByDevice = db.txByDevice || {};
}

function upsertTx(db, rec) {
  ensureTx(db);
  const id = String(rec?.idTransaksi || "").trim();
  if (!id) throw new Error("idTransaksi required");

  const now = new Date().toISOString();
  const prev = db.tx[id] || {};

  db.tx[id] = {
    ...prev,
    ...rec,
    idTransaksi: id,
    updatedAt: now,
  };

  const deviceId = rec?.deviceId ? String(rec.deviceId) : "";
  if (deviceId) {
    const arr = Array.isArray(db.txByDevice[deviceId]) ? db.txByDevice[deviceId] : [];
    const next = [id, ...arr.filter((x) => x !== id)].slice(0, 200); // keep last 200
    db.txByDevice[deviceId] = next;
  }

  return db.tx[id];
}

module.exports = { upsertTx };
