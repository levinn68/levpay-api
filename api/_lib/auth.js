// api/_lib/auth.js
function assertCallbackSecret(req, res) {
  const expect = String(process.env.CALLBACK_SECRET || "").trim();
  if (!expect) return true; // kalau belum set, jangan block (tapi ini kurang aman)

  const got =
    String(req.headers["x-callback-secret"] || req.headers["X-Callback-Secret"] || "").trim();

  if (!got || got !== expect) {
    res.status(401).json({ success: false, error: "Unauthorized (bad callback secret)" });
    return false;
  }
  return true;
}

module.exports = { assertCallbackSecret };
