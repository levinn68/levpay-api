function header(req, name) {
  const key = String(name || "").toLowerCase();
  const h = req.headers || {};
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === key) return h[k];
  }
  return undefined;
}

function getCallbackSecret(req) {
  return String(header(req, "x-callback-secret") || "").trim();
}

function getAdminKey(req) {
  return String(header(req, "x-admin-key") || "").trim();
}

function requireCallback(req) {
  const need = String(process.env.CALLBACK_SECRET || "").trim();
  if (!need) return true; // kalau env kosong, skip
  return getCallbackSecret(req) === need;
}

function requireAdmin(req) {
  const need = String(process.env.ADMIN_KEY || "").trim();
  if (!need) return false;
  return getAdminKey(req) === need;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function ok(res, data) {
  return send(res, 200, { success: true, data });
}

function bad(res, code, error, extra = {}) {
  return send(res, code, { success: false, error, ...extra });
}

function parseUrl(req) {
  const u = new URL(req.url, "http://localhost");
  return u;
}

async function readJson(req) {
  // Next.js biasanya udah ada req.body, tapi ini biar aman di Vercel Functions juga
  if (req.body && typeof req.body === "object") return req.body;

  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c.toString("utf8")));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = {
  header,
  getCallbackSecret,
  getAdminKey,
  requireCallback,
  requireAdmin,
  send,
  ok,
  bad,
  parseUrl,
  readJson,
};
