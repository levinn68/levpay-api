// api/paid.js
export default async function handler(req, res) {
  // ====== CONFIG (hardcode) ======
  // NOTE: hardcode key itu bahaya kalau repo public. Minimal repo private + jangan bocor.
  const SUPABASE_URL = "https://agwaxaejnnszunccmftm.supabase.co";
  const SUPABASE_SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnd2F4YWVqbm5zenVuY2NtZnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMjI0NDUsImV4cCI6MjA4MTU5ODQ0NX0.fB_-VKL6CyjYa3jaG_6Pmag-Za-DEQhRujSiEmk1l-I"; // paling enak buat server (JANGAN taro di frontend)
  const TABLE = "paid_tx";

  // biar orang random gak bisa spam insert
  const WRITE_KEY = "LEVIN6824"; // bebas lu ganti, nanti dipake di frontend header

  // ====== CORS (biar frontend aman) ======
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LevPay-Key");

  if (req.method === "OPTIONS") return res.status(204).end();

  const supa = {
    url: `${SUPABASE_URL}/rest/v1/${TABLE}`,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
  };

  // ====== helper ======
  const bad = (code, msg) => res.status(code).json({ ok: false, error: msg });

  // ====== POST: simpan paid (upsert by id_transaksi) ======
  if (req.method === "POST") {
    const key = req.headers["x-levpay-key"];
    if (key !== WRITE_KEY) return bad(401, "Nope. Salah X-LevPay-Key.");

    let body = req.body;
    // Vercel kadang body udah object; kadang string
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const idTransaksi = String(body?.idTransaksi || body?.id_transaksi || "").trim();
    if (!idTransaksi) return bad(400, "idTransaksi wajib.");

    const row = {
      id_transaksi: idTransaksi,
      paid_at: body?.paidAt || body?.paid_at || null,
      paid_via: body?.paidVia || body?.paid_via || null,
      amount_final: body?.amountFinal ?? body?.amount_final ?? null,
      voucher: body?.voucher ?? null,
      payer_name: body?.payerName ?? body?.payer_name ?? null,
      reference: body?.reference ?? null,
      device_id: body?.deviceId ?? body?.device_id ?? null,
    };

    // upsert: insert kalau belum ada, update kalau udah ada
    const url = `${supa.url}?on_conflict=id_transaksi`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        ...supa.headers,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([row]),
    });

    const txt = await r.text();
    if (!r.ok) return bad(r.status, txt || "Supabase error");

    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.status(200).json({ ok: true, data });
  }

  // ====== GET: list paid (limit + search) ======
  if (req.method === "GET") {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const q = String(req.query.q || "").trim();

    // base: order newest
    let url = `${supa.url}?select=*&order=paid_at.desc.nullslast,created_at.desc&limit=${limit}`;

    // search simple: cari di id_transaksi/payer_name/paid_via/voucher/reference
    if (q) {
      const esc = q.replace(/[%_]/g, (m) => "\\" + m);
      // or=(col.ilike.*q*,col2.ilike.*q*)
      url +=
        `&or=(` +
        [
          `id_transaksi.ilike.*${encodeURIComponent(esc)}*`,
          `payer_name.ilike.*${encodeURIComponent(esc)}*`,
          `paid_via.ilike.*${encodeURIComponent(esc)}*`,
          `voucher.ilike.*${encodeURIComponent(esc)}*`,
          `reference.ilike.*${encodeURIComponent(esc)}*`,
        ].join(",") +
        `)`;
    }

    const r = await fetch(url, { headers: supa.headers });
    const txt = await r.text();
    if (!r.ok) return bad(r.status, txt || "Supabase error");

    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.status(200).json({ ok: true, data });
  }

  return bad(405, "Method not allowed");
}"id_transaksi" });

      if (error) return json(res, 500, { ok: false, error: error.message });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message || e) });
    }
  }

  return json(res, 405, { ok: false, error: "Method not allowed" });
    }
// api/paid.js
export default async function handler(req, res) {
  // ====== CONFIG (hardcode) ======
  // NOTE: hardcode key itu bahaya kalau repo public. Minimal repo private + jangan bocor.
  const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
  const SUPABASE_SERVICE_ROLE = "YOUR_SERVICE_ROLE_KEY"; // paling enak buat server (JANGAN taro di frontend)
  const TABLE = "paid_tx";

  // biar orang random gak bisa spam insert
  const WRITE_KEY = "LEVPLAY_SECRET_123"; // bebas lu ganti, nanti dipake di frontend header

  // ====== CORS (biar frontend aman) ======
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LevPay-Key");

  if (req.method === "OPTIONS") return res.status(204).end();

  const supa = {
    url: `${SUPABASE_URL}/rest/v1/${TABLE}`,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
  };

  // ====== helper ======
  const bad = (code, msg) => res.status(code).json({ ok: false, error: msg });

  // ====== POST: simpan paid (upsert by id_transaksi) ======
  if (req.method === "POST") {
    const key = req.headers["x-levpay-key"];
    if (key !== WRITE_KEY) return bad(401, "Nope. Salah X-LevPay-Key.");

    let body = req.body;
    // Vercel kadang body udah object; kadang string
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const idTransaksi = String(body?.idTransaksi || body?.id_transaksi || "").trim();
    if (!idTransaksi) return bad(400, "idTransaksi wajib.");

    const row = {
      id_transaksi: idTransaksi,
      paid_at: body?.paidAt || body?.paid_at || null,
      paid_via: body?.paidVia || body?.paid_via || null,
      amount_final: body?.amountFinal ?? body?.amount_final ?? null,
      voucher: body?.voucher ?? null,
      payer_name: body?.payerName ?? body?.payer_name ?? null,
      reference: body?.reference ?? null,
      device_id: body?.deviceId ?? body?.device_id ?? null,
    };

    // upsert: insert kalau belum ada, update kalau udah ada
    const url = `${supa.url}?on_conflict=id_transaksi`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        ...supa.headers,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([row]),
    });

    const txt = await r.text();
    if (!r.ok) return bad(r.status, txt || "Supabase error");

    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.status(200).json({ ok: true, data });
  }

  // ====== GET: list paid (limit + search) ======
  if (req.method === "GET") {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const q = String(req.query.q || "").trim();

    // base: order newest
    let url = `${supa.url}?select=*&order=paid_at.desc.nullslast,created_at.desc&limit=${limit}`;

    // search simple: cari di id_transaksi/payer_name/paid_via/voucher/reference
    if (q) {
      const esc = q.replace(/[%_]/g, (m) => "\\" + m);
      // or=(col.ilike.*q*,col2.ilike.*q*)
      url +=
        `&or=(` +
        [
          `id_transaksi.ilike.*${encodeURIComponent(esc)}*`,
          `payer_name.ilike.*${encodeURIComponent(esc)}*`,
          `paid_via.ilike.*${encodeURIComponent(esc)}*`,
          `voucher.ilike.*${encodeURIComponent(esc)}*`,
          `reference.ilike.*${encodeURIComponent(esc)}*`,
        ].join(",") +
        `)`;
    }

    const r = await fetch(url, { headers: supa.headers });
    const txt = await r.text();
    if (!r.ok) return bad(r.status, txt || "Supabase error");

    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    return res.status(200).json({ ok: true, data });
  }

  return bad(405, "Method not allowed");
}
