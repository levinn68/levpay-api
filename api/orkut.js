// api/orkut.js — FINAL (QR + Voucher/Promo + Admin UI compatible)
// - Frontend LP#1.0.0 default pake /api/orkut => biar diskon kepake di frontend.
// - /api/levpay nanti cukup jadi alias ke file ini.
//
// Actions:
// - ping | help
// - createqr | status | cancel | qr
// - discount.apply | discount.commit | discount.release
// - voucher.upsert (ADMIN) | voucher.disable (ADMIN) | voucher.delete (ADMIN) | voucher.list (ADMIN) | voucher.get (ADMIN)
// - monthly.get (ADMIN) | monthly.set (ADMIN)
// - unlimited.get (ADMIN) | unlimited.set (ADMIN)   <-- toggle unlimited device (tanpa sha/pepper di UI)

const { loadDb, saveDb } = require("../lib/github");
const voucherEngine = require("../lib/voucher");

const ORKUT_BASE = process.env.ORKUT_BASE || "http://193.23.209.47:7032"; // base VPS (contoh: https://cp.yupra.me/server/xxxx)
const ADMIN_KEY = process.env.ADMIN_KEY || "LEVIN6824";

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Key, X-Callback-Secret"
  );
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end("");
    return true;
  }
  return false;
}

function isAdmin(req) {
  const k = String(req.headers["x-admin-key"] || "").trim();
  return !!(k && k === ADMIN_KEY);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function proxyJson(url, method, body) {
  if (!url) throw new Error("ORKUT_BASE kosong. Set env ORKUT_BASE.");
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const txt = await r.text().catch(() => "");
  let j = {};
  try {
    j = txt ? JSON.parse(txt) : {};
  } catch {
    j = { raw: txt };
  }
  if (!r.ok) throw new Error(j?.error || j?.message || `Upstream HTTP ${r.status}`);
  return j;
}

function actionHelp() {
  return {
    success: true,
    service: "orkut (qr + voucher/promo)",
    actions: [
      "ping",
      "help",
      "createqr",
      "status",
      "cancel",
      "qr",
      "discount.apply",
      "discount.commit",
      "discount.release",
      "voucher.upsert (ADMIN)",
      "voucher.disable (ADMIN)",
      "voucher.delete (ADMIN)",
      "voucher.list (ADMIN)",
      "voucher.get (ADMIN)",
      "monthly.get (ADMIN)",
      "monthly.set (ADMIN)",
      "unlimited.get (ADMIN)",
      "unlimited.set (ADMIN)",
    ],
    adminHeader: "X-Admin-Key",
    notes: [
      "Frontend LP#1.0.0 harusnya otomatis kepotong karena createqr di sini sudah apply discount.",
      "Unlimited device toggle pakai deviceId (tanpa sha/pepper di UI). Backend yang hash.",
    ],
  };
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  const url = new URL(req.url, "http://localhost");
  const action = String(url.searchParams.get("action") || "").trim();

  if (!action || action === "help") return send(res, 200, actionHelp());
  if (action === "ping") return send(res, 200, { success: true, ok: true, time: new Date().toISOString() });

  const body = await readBody(req);

  // ===== DB =====
  const db = await loadDb();
  voucherEngine.ensureDb(db);

  try {
    // =========================
    // PUBLIC: DISCOUNT ENGINE
    // =========================
    if (action === "discount.apply") {
      const amount = Number(body.amount);
      const deviceId = body.deviceId || body.deviceid || body.device_id || "";
      const voucherCode = body.voucher || body.voucherCode || body.code || "";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      const r = voucherEngine.applyDiscount(db, {
        amount,
        deviceId: String(deviceId || ""),
        voucherCode: String(voucherCode || ""),
        ttlMs: Number(body.ttlMs || body.reserveTtlMs || 6 * 60 * 1000),
      });

      await saveDb(db);

      return send(res, 200, {
        success: true,
        data: {
          amountOriginal: r.amountOriginal,
          amountFinal: r.amountFinal,
          discountRp: r.discountRp,
          applied: r.applied,
          reservations: r.reservations,
          deviceKey: r.deviceKey, // boleh buat debug, frontend ga wajib pake
        },
      });
    }

    if (action === "discount.release") {
      voucherEngine.releaseReservations(db, Array.isArray(body.reservations) ? body.reservations : []);
      await saveDb(db);
      return send(res, 200, { success: true, data: { released: true } });
    }

    if (action === "discount.commit") {
      voucherEngine.commitReservations(db, Array.isArray(body.reservations) ? body.reservations : []);
      await saveDb(db);
      return send(res, 200, { success: true, data: { committed: true } });
    }

    // =========================
    // ADMIN: UNLIMITED DEVICE (global, berlaku voucher+monthly)
    // =========================
    if (action === "unlimited.get") {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });
      const deviceId = String(body.deviceId || url.searchParams.get("deviceId") || "").trim();
      if (!deviceId) return send(res, 400, { success: false, error: "deviceId required" });

      const enabled = voucherEngine.isUnlimitedDeviceById(db, deviceId);
      const count = Object.keys(db?.promo?.unlimitedDevices || {}).length;

      return send(res, 200, { success: true, data: { deviceId, enabled, count } });
    }

    if (action === "unlimited.set") {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });
      const deviceId = String(body.deviceId || "").trim();
      const enabled = !!body.enabled;
      if (!deviceId) return send(res, 400, { success: false, error: "deviceId required" });

      const out = voucherEngine.adminSetUnlimitedDeviceById(db, { deviceId, enabled });
      await saveDb(db);

      return send(res, 200, { success: true, data: out });
    }

    // =========================
    // ADMIN: VOUCHER
    // =========================
    if (action.startsWith("voucher.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "voucher.upsert") {
        const out = voucherEngine.adminUpsertVoucher(db, body || {});
        await saveDb(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.disable") {
        const out = voucherEngine.adminDisableVoucher(db, body || {});
        await saveDb(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.delete") {
        const out = voucherEngine.adminDeleteVoucher(db, body || {});
        await saveDb(db);
        return send(res, 200, { success: true, data: out });
      }

      if (action === "voucher.list") {
        const items = Object.values(db.vouchers || {}).sort((a, b) =>
          String(a.code || "").localeCompare(String(b.code || ""))
        );
        return send(res, 200, { success: true, data: items });
      }

      if (action === "voucher.get") {
        const code = String(body.code || url.searchParams.get("code") || "").trim().toUpperCase();
        if (!code) return send(res, 400, { success: false, error: "code required" });
        const v = db.vouchers?.[code];
        if (!v) return send(res, 404, { success: false, error: "voucher not found" });
        return send(res, 200, { success: true, data: v });
      }

      return send(res, 400, { success: false, error: "Unknown voucher action" });
    }

    // =========================
    // ADMIN: MONTHLY
    // =========================
    if (action.startsWith("monthly.")) {
      if (!isAdmin(req)) return send(res, 401, { success: false, error: "unauthorized" });

      if (action === "monthly.get") {
        voucherEngine.cleanupExpiredReservations(db);
        return send(res, 200, { success: true, data: db.promo.monthly });
      }

      if (action === "monthly.set") {
        const out = voucherEngine.adminSetMonthlyPromo(db, body || {});
        await saveDb(db);
        return send(res, 200, { success: true, data: out });
      }

      return send(res, 400, { success: false, error: "Unknown monthly action" });
    }

    // =========================
    // QR FLOW (create/status/cancel/qr)
    // =========================
    if (action === "createqr") {
      const amount = Number(body.amount);
      const deviceId = String(body.deviceId || "").trim();
      const voucher = String(body.voucher || body.vouccer || "").trim();
      const theme = body.theme === "theme1" ? "theme1" : "theme2";

      if (!Number.isFinite(amount) || amount < 1) {
        return send(res, 400, { success: false, error: "amount invalid" });
      }

      // apply discount di server (ini kuncinya biar frontend kepotong)
      const discountRes = voucherEngine.applyDiscount(db, {
        amount,
        deviceId,
        voucherCode: voucher,
        ttlMs: 6 * 60 * 1000,
      });

      // create QR ke VPS pakai amountFinal
      const created = await proxyJson(`${ORKUT_BASE}/api/createqr`, "POST", {
        amount: discountRes.amountFinal,
        theme,
      });

      // simpan tx map (buat status + commit)
      const idTransaksi =
        created?.idTransaksi || created?.idtransaksi || created?.transactionId || created?.trxId || created?.id;
      if (!idTransaksi) throw new Error("Upstream createqr schema mismatch (missing idTransaksi)");

      db.tx = db.tx || {};
      db.tx[idTransaksi] = {
        idTransaksi,
        createdAt: created?.createdAt || new Date().toISOString(),
        expiredAt: created?.expiredAt || created?.expired || null,
        amountOriginal: discountRes.amountOriginal,
        amountFinal: discountRes.amountFinal,
        discountRp: discountRes.discountRp,
        applied: discountRes.applied,
        reservations: discountRes.reservations,
        voucherInput: voucher || null,
        deviceId: deviceId || null,
        deviceKey: discountRes.deviceKey || null,
        status: "PENDING",
        updatedAt: new Date().toISOString(),
      };

      await saveDb(db);

      const qrUrl = `/api/orkut?action=qr&idTransaksi=${encodeURIComponent(idTransaksi)}`;

      return send(res, 200, {
        success: true,
        data: {
          ...created,
          idTransaksi,
          qrUrl,
          pricing: {
            amountOriginal: discountRes.amountOriginal,
            amountFinal: discountRes.amountFinal,
            discountRp: discountRes.discountRp,
            applied: discountRes.applied,
          },
        },
      });
    }

    if (action === "status") {
      const idTransaksi = String(url.searchParams.get("idTransaksi") || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "idTransaksi required" });

      const st = await proxyJson(
        `${ORKUT_BASE}/api/status?idTransaksi=${encodeURIComponent(idTransaksi)}`,
        "GET"
      );

      const tx = db.tx?.[idTransaksi] || null;
      return send(res, 200, {
        success: true,
        data: {
          ...st,
          idTransaksi,
          pricing: tx
            ? {
                amountOriginal: tx.amountOriginal,
                amountFinal: tx.amountFinal,
                discountRp: tx.discountRp,
                applied: tx.applied || [],
              }
            : undefined,
        },
      });
    }

    if (action === "cancel") {
      const idTransaksi = String(body.idTransaksi || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "idTransaksi required" });

      const out = await proxyJson(`${ORKUT_BASE}/api/cancel`, "POST", { idTransaksi });

      // release reservation kalau batal
      const tx = db.tx?.[idTransaksi];
      if (tx?.reservations) {
        voucherEngine.releaseReservations(db, tx.reservations);
        tx.status = "CANCELED";
        tx.updatedAt = new Date().toISOString();
        await saveDb(db);
      }

      return send(res, 200, { success: true, data: out });
    }

    if (action === "qr") {
      const idTransaksi = String(url.searchParams.get("idTransaksi") || "").trim();
      if (!idTransaksi) {
        res.statusCode = 400;
        res.end("idTransaksi required");
        return;
      }

      // proxy image/png dari VPS
      if (!ORKUT_BASE) {
        res.statusCode = 500;
        res.end("ORKUT_BASE kosong");
        return;
      }

      const up = await fetch(`${ORKUT_BASE}/api/qr?idTransaksi=${encodeURIComponent(idTransaksi)}`);
      res.statusCode = up.status;
      res.setHeader("Cache-Control", "no-store");

      // copy content-type
      const ct = up.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", ct);

      const buf = Buffer.from(await up.arrayBuffer());
      res.end(buf);
      return;
    }

    return send(res, 404, { success: false, error: "Unknown action" });
  } catch (e) {
    return send(res, 500, { success: false, error: e?.message || "server error" });
  }
};