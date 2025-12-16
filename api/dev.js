const axios = require("axios");
const fs = require("fs");
const path = require("path");

const VPS_BASE = process.env.VPS_BASE || "http://82.27.2.229:5021";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
  res.setHeader("Cache-Control", "no-store");
}

function requireAdmin(req, res) {
  if (!ADMIN_KEY) return true;
  const got =
    (req.headers["x-admin-key"] || "").toString().trim() ||
    (req.headers.authorization || "").toString().replace(/^Bearer\s+/i, "").trim();
  if (got !== ADMIN_KEY) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function getAutoftPaths() {
  const entry = require.resolve("autoft-qris");
  let dir = path.dirname(entry);
  while (dir && path.basename(dir) !== "autoft-qris") dir = path.dirname(dir);
  const srcDir = fs.existsSync(path.join(dir, "src")) ? path.join(dir, "src") : dir;
  const qr1 = path.join(srcDir, "qr-generator.cjs");
  const qr2 = path.join(srcDir, "qr-generator2.cjs");
  return { entry, dir, srcDir, qr1, qr2 };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query?.action || "page").toLowerCase().trim();

  // PAGE: preview tema (no admin)
  if (action === "page") {
    const amount = Number(req.query?.amount || 1000);
    const safeAmt = Number.isFinite(amount) && amount > 0 ? amount : 1000;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>LevPay QR Preview</title>
<style>
  body{font-family:system-ui;margin:24px;background:#0b0f17;color:#e7eaf0}
  .wrap{max-width:980px;margin:0 auto}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{background:#121a2a;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px}
  h1{font-size:20px;margin:0 0 12px}
  h2{font-size:14px;margin:0 0 10px;opacity:.9}
  img{width:100%;height:auto;border-radius:14px;background:#fff}
  .muted{opacity:.7;font-size:12px;margin-top:10px}
  input,button{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#0b0f17;color:#e7eaf0}
  button{cursor:pointer}
  .top{display:flex;gap:10px;align-items:center;margin-bottom:14px}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Preview QR Generator (theme1 vs theme2)</h1>
    <div class="top">
      <div>Amount:</div>
      <input id="amt" value="${safeAmt}" inputmode="numeric" />
      <button id="go">Reload</button>
    </div>

    <div class="row">
      <div class="card">
        <h2>theme1</h2>
        <img id="img1" src="/api/dev?action=qr_preview&theme=theme1&amount=${safeAmt}&_=${Date.now()}" />
      </div>
      <div class="card">
        <h2>theme2</h2>
        <img id="img2" src="/api/dev?action=qr_preview&theme=theme2&amount=${safeAmt}&_=${Date.now()}" />
      </div>
    </div>

    <div class="muted">
      Endpoint ini nge-proxy ke VPS createqr → ambil PNG → tampil di sini.
    </div>
  </div>

<script>
  document.getElementById("go").onclick = () => {
    const v = (document.getElementById("amt").value || "").replace(/[^0-9]/g,"");
    const n = v ? Number(v) : 1000;
    location.href = "/api/dev?action=page&amount=" + encodeURIComponent(n);
  };
</script>
</body>
</html>`);
  }

  // QR_PREVIEW: generate di VPS, ambil PNG, balikin PNG
  if (action === "qr_preview") {
    const amount = Number(req.query?.amount || 1000);
    const theme = req.query?.theme === "theme2" ? "theme2" : "theme1";
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ ok: false, error: "amount invalid" });
    }

    const r = await axios.post(
      `${VPS_BASE}/api/createqr`,
      { amount, theme },
      { timeout: 20000, validateStatus: () => true, headers: { "Content-Type": "application/json" } }
    );

    if (r.status !== 200) {
      return res.status(r.status).json({ ok: false, error: "VPS createqr failed", provider: r.data });
    }

    const idTransaksi = r.data?.data?.idTransaksi || r.data?.idTransaksi;
    if (!idTransaksi) {
      return res.status(500).json({ ok: false, error: "missing idTransaksi", provider: r.data });
    }

    const png = await axios.get(`${VPS_BASE}/api/qr/${encodeURIComponent(idTransaksi)}.png`, {
      responseType: "arraybuffer",
      timeout: 20000,
      validateStatus: () => true,
    });

    if (png.status !== 200) {
      return res.status(png.status).json({ ok: false, error: "QR not found on VPS" });
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(png.data));
  }

  // SOURCE: lihat isi qr-generator.cjs (admin only)
  if (action === "source") {
    if (!requireAdmin(req, res)) return;

    const which = String(req.query?.which || "1");
    const { qr1, qr2, entry, srcDir } = getAutoftPaths();
    const file = which === "2" ? qr2 : qr1;

    if (!fs.existsSync(file)) {
      return res.status(404).json({ ok: false, error: "file not found", file, entry, srcDir });
    }

    const maxLines = Math.min(2000, Math.max(50, Number(req.query?.maxLines || 400)));
    const text = fs.readFileSync(file, "utf8");
    const out = text.split("\n").slice(0, maxLines).join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(out);
  }

  return res.status(404).json({
    ok: false,
    error: "Unknown action",
    routes: [
      "GET /api/dev?action=page&amount=1000",
      "GET /api/dev?action=qr_preview&theme=theme1|theme2&amount=1000",
      "GET /api/dev?action=source&which=1|2&maxLines=400 (ADMIN)",
    ],
  });
};
