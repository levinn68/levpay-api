// api/paidlog.js  (CommonJS)
const { createClient } = require("@supabase/supabase-js");

// ⚠️ paling bener pakai ENV, tapi lu minta hardcode yaudah.
// NOTE: jangan pake "service_role" di client/public. Ini cuma di server (Vercel function).
const SUPABASE_URL = "https://agwaxaejnnszunccmftm.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnd2F4YWVqbm5zenVuY2NtZnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMjI0NDUsImV4cCI6MjA4MTU5ODQ0NX0.fB_-VKL6CyjYa3jaG_6Pmag-Za-DEQhRujSiEmk1l-I";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Key"
  );
}

function safeJsonBody(req) {
  // Vercel kadang udah parse -> object
  if (req.body && typeof req.body === "object") return req.body;

  // kadang string
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  return {};
}

module.exports = async (req, res) => {
  try {
    cors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    // ✅ ping biar lu bisa "ngecek hidup"
    if (req.method === "GET" && String(req.query?.ping || "") === "1") {
      return send(res, 200, { ok: true, name: "paidlog", ts: Date.now() });
    }

    // GET /api/paidlog?limit=10&q=...
    if (req.method === "GET") {
      const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 10)));
      const q = String(req.query?.q || "").trim();

      let query = sb
        .from("levpay_paidlog")
        .select("idTransaksi,paidAt,paidVia,payerName,amountFinal,voucher,reference")
        .order("paidAt", { ascending: false })
        .limit(limit);

      if (q) {
        const like = `%${q}%`;
        query = query.or(
          [
            `idTransaksi.ilike.${like}`,
            `payerName.ilike.${like}`,
            `paidVia.ilike.${like}`,
            `voucher.ilike.${like}`,
            `reference.ilike.${like}`,
          ].join(",")
        );
      }

      const { data, error } = await query;
      if (error) return send(res, 500, { success: false, error: error.message, data: [] });
      return send(res, 200, { success: true, data: data || [] });
    }

    // POST /api/paidlog (upsert by idTransaksi)
    if (req.method === "POST") {
      const body = safeJsonBody(req);

      const idTransaksi = String(body.idTransaksi || "").trim();
      if (!idTransaksi) return send(res, 400, { success: false, error: "missing idTransaksi" });

      const row = {
        idTransaksi,
        paidAt: body.paidAt || new Date().toISOString(),
        paidVia: body.paidVia || "UNKNOWN",
        payerName: body.payerName || "",
        amountFinal: body.amountFinal ?? null,
        voucher: body.voucher || "",
        reference: body.reference || null,
        raw: body.raw || body,
      };

      const { data, error } = await sb
        .from("levpay_paidlog")
        .upsert(row, { onConflict: "idTransaksi" })
        .select("idTransaksi")
        .single();

      if (error) return send(res, 500, { success: false, error: error.message });
      return send(res, 200, { success: true, data });
    }

    return send(res, 405, { success: false, error: "method not allowed" });
  } catch (e) {
    return send(res, 500, { success: false, error: String(e?.message || e) });
  }
};
