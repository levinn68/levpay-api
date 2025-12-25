// api/v2/cqr.js
// LevPay V2 - Create QR (tanpa kasir.create_qris_image.php karena upstream 404)
// Output: qrString + pngBase64

const QRCode = require("qrcode");

// ===== HARDCODE CONFIG (sama kayak index.js lu) =====
const CONFIG = {
  storeName: "NEVERMORE",
  merchant: "NEVERMOREOK1331927",

  // base QRIS lu (yang udah ada CRC di ekor)
  baseQrString:
    "00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214503370116723410303UMI51440014ID.CO.QRIS.WWW0215ID20232921353400303UMI5204541153033605802ID5919NEVERMORE OK13319276013JAKARTA UTARA61051411062070703A0163046C64",
};

// ===== CRC16-CCITT (FALSE) =====
function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Parse EMV TLV simple (tag 2 digit, len 2 digit)
function parseTLV(payload) {
  const out = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    const start = i + 4;
    const end = start + (Number.isFinite(len) ? len : 0);
    if (!Number.isFinite(len) || end > payload.length) break;
    const value = payload.slice(start, end);
    out.push({ tag, len, value });
    i = end;
  }
  return out;
}

function buildTLV(items) {
  return items
    .map(({ tag, value }) => {
      const v = String(value ?? "");
      const len = String(v.length).padStart(2, "0");
      return `${tag}${len}${v}`;
    })
    .join("");
}

function stripCRC(base) {
  // CRC tag 63 harusnya di ujung: ...6304FFFF
  const idx = base.lastIndexOf("6304");
  if (idx >= 0 && idx + 8 <= base.length) return base.slice(0, idx); // buang "6304XXXX"
  return base;
}

function injectAmount(baseQr, nominal) {
  const amt = Math.max(1, Math.floor(Number(nominal || 0)));
  const amtStr = String(amt);

  const baseNoCrc = stripCRC(String(baseQr || "").trim());
  const items = parseTLV(baseNoCrc);

  // buang tag 54 (amount) kalau udah ada
  const filtered = items.filter((x) => x.tag !== "54" && x.tag !== "63");

  // sisipkan amount setelah tag 53 (currency) kalau ada
  const out = [];
  let inserted = false;
  for (const it of filtered) {
    out.push({ tag: it.tag, value: it.value });
    if (!inserted && it.tag === "53") {
      out.push({ tag: "54", value: amtStr });
      inserted = true;
    }
  }
  if (!inserted) out.push({ tag: "54", value: amtStr });

  // build + CRC
  const payload = buildTLV(out);
  const withCrcTag = payload + "6304";
  const crc = crc16ccitt(withCrcTag);
  return withCrcTag + crc;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Method Not Allowed. Use POST JSON.",
      example: { nominal: 1000 },
    });
  }

  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const nominal = Number(body?.nominal);

    if (!Number.isFinite(nominal) || nominal < 1) {
      return json(res, 400, { success: false, message: "nominal invalid", example: { nominal: 1 } });
    }

    const qrString = injectAmount(CONFIG.baseQrString, nominal);

    const png = await QRCode.toBuffer(qrString, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
    });

    return json(res, 200, {
      success: true,
      merchant: CONFIG.merchant,
      storeName: CONFIG.storeName,
      nominal: Math.floor(nominal),
      qrString,
      pngBase64: png.toString("base64"),
      // biar gampang dipake di FE:
      dataUrl: "data:image/png;base64," + png.toString("base64"),
    });
  } catch (e) {
    return json(res, 500, { success: false, message: "internal error", error: e?.message || "unknown" });
  }
};
