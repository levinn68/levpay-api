// /api/paid.js
import { createClient } from "@supabase/supabase-js";

// ❌ jangan pake process.env kalau lu mau hardcode
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ✅ HARD-CODE DI SERVER ENDPOINT (tetep jangan taro di frontend)
const SUPABASE_URL = "https://agwaxaejnnszunccmftm.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnd2F4YWVqbm5zenVuY2NtZnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMjI0NDUsImV4cCI6MjA4MTU5ODQ0NX0.fB_-VKL6CyjYa3jaG_6Pmag-Za-DEQhRujSiEmk1l-I"; // service_role

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TABLE = "levpay_paid";
const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;

const safeStr = (v, fb = "") => (typeof v === "string" ? v : v == null ? fb : String(v));
const toMs = (isoOrMs) => {
  if (!isoOrMs) return Date.now();
  if (Number.isFinite(Number(isoOrMs))) return Number(isoOrMs);
  const t = Date.parse(String(isoOrMs));
  return Number.isFinite(t) ? t : Date.now();
};

function normalizePaidPayload(p = {}) {
  const idTransaksi = p.idTransaksi || p.id || p.trxId || p.transactionId || p.code || "";
  const paidAt = p.paidAt || p.paid_at || p.time || null;
  const paidVia = p.paidVia || p.via || p.channel || p.method || "UNKNOWN";
  const amountFinal = p.amountFinal ?? p.amount ?? p.total ?? null;

  const payerName =
    p.payerName ||
    p.accountName ||
    p.customerName ||
    p.paidName ||
    p.nama ||
    p.brand_name ||
    p.brandName ||
    p.buyer_reff ||
    p.buyerReff ||
    "";

  const voucher = p.voucher ?? p.voucherCode ?? "";
  const reference = p.reference ?? null;

  return {
    id_transaksi: safeStr(idTransaksi, ""),
    paid_at: paidAt ? new Date(toMs(paidAt)).toISOString() : new Date().toISOString(),
    amount_final: amountFinal == null ? null : Number(amountFinal),
    paid_via: safeStr(paidVia, "UNKNOWN"),
    payer_name: safeStr(payerName, ""),
    voucher: safeStr(voucher, ""),
    reference,
    raw: p,
  };
}

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(data));
}

function js(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function clientBundle() {
  return `
(() => {
  const ENDPOINT = "/api/paid";
  const LIMIT = 10;

  const $id = (id) => document.getElementById(id);

  // inline elements (yang lu udah taro di bawah Cara Pakai)
  const el = {
    list: $id("paidInlineList"),
    meta: $id("paidInlineMeta"),
    search: $id("paidInlineSearch"),
    clearSearch: $id("paidInlineClearSearch"),
    clearAll: $id("paidInlineClearAll"),
  };

  const fmtRp = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
  const fmtTime = (iso) => {
    try {
      const d = iso ? new Date(iso) : new Date();
      return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    } catch { return "-"; }
  };

  function pickText(tx) {
    return [tx.idTransaksi, tx.payerName, tx.paidVia, tx.voucher, tx.reference]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function cardHtml(tx) {
    const id = tx?.idTransaksi || "—";
    const via = (tx?.paidVia || "UNKNOWN").toUpperCase();
    const nm = tx?.payerName || "—";
    const vc = (tx?.voucher || "").trim() || "—";
    const amt = tx?.amountFinal != null ? fmtRp(tx.amountFinal) : "—";
    const t = tx?.paidAt ? fmtTime(tx.paidAt) : "—";

    const title = [
      "ID: " + id,
      "Nominal: " + amt,
      "Via: " + via,
      "Nama: " + nm,
      "Voucher: " + vc,
      tx?.reference ? ("Ref: " + tx.reference) : null
    ].filter(Boolean).join("\\n");

    return \`
      <button class="paidItem" type="button" data-paid-id="\${id}" title="\${title}">
        <div class="paidItem__left">
          <div class="paidItem__top">
            <span class="paidItem__amt">\${amt}</span>
            <span class="paidItem__pill">\${via}</span>
          </div>
          <div class="paidItem__mid">\${nm}</div>
          <div class="paidItem__sub mono">\${id}</div>
        </div>
        <div class="paidItem__right">
          <div class="paidItem__time">\${t}</div>
          <div class="paidItem__voucher muted">Voucher: \${vc}</div>
        </div>
      </button>
    \`;
  }

  function render(list = [], total = 0) {
    if (!el.list) return;
    if (el.meta) el.meta.textContent = \`Total \${total} (tampil \${list.length})\`;
    el.list.innerHTML = list.map(cardHtml).join("") || \`<div class="muted" style="padding:14px 4px">Belum ada transaksi paid.</div>\`;

    el.list.querySelectorAll("[data-paid-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-paid-id");
        if (!id) return;

        try {
          const r = await fetch(ENDPOINT + "?id=" + encodeURIComponent(id));
          const j = await r.json();
          const tx = j?.data || null;

          const Paid = window.LevPayPaid;
          if (tx && (Paid?.show || Paid?.open)) (Paid.show || Paid.open).call(Paid, tx);
        } catch {}
      });
    });
  }

  let lastCache = [];
  let lastTotal = 0;

  async function loadRecent(q = "") {
    if (!el.list) return;

    const u = new URL(ENDPOINT, window.location.origin);
    u.searchParams.set("limit", String(LIMIT));
    if (q) u.searchParams.set("q", q);

    try {
      const r = await fetch(u.toString(), { method: "GET" });
      const j = await r.json();
      lastCache = Array.isArray(j?.data) ? j.data : [];
      lastTotal = Number(j?.total || lastCache.length || 0);
      render(lastCache, lastTotal);
    } catch {
      render([], 0);
    }
  }

  function localFilter(q) {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return render(lastCache.slice(0, LIMIT), lastTotal);
    const filtered = lastCache.filter((tx) => pickText(tx).includes(s)).slice(0, LIMIT);
    render(filtered, lastTotal);
  }

  let tmr = null;
  function debounce(fn, ms = 250) { clearTimeout(tmr); tmr = setTimeout(fn, ms); }

  function hookPaidShow() {
    const Paid = window.LevPayPaid;
    if (!Paid || (!Paid.show && !Paid.open)) return;

    const orig = Paid.show || Paid.open;

    const wrapped = async function(payload = {}) {
      // tampil dulu
      try { orig.call(Paid, payload); } catch {}

      // sync global ke server
      try {
        await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {}

      loadRecent(el.search?.value || "");
    };

    if (Paid.show) Paid.show = wrapped;
    if (Paid.open) Paid.open = wrapped;
  }

  function bindUI() {
    if (el.search) {
      el.search.addEventListener("input", () => {
        const q = el.search.value || "";
        localFilter(q);
        debounce(() => loadRecent(q), 320);
      });
    }

    el.clearSearch?.addEventListener("click", () => {
      if (!el.search) return;
      el.search.value = "";
      loadRecent("");
    });

    // tombol "Hapus" di UI lu: versi aman (reset filter doang)
    el.clearAll?.addEventListener("click", () => {
      if (el.search) el.search.value = "";
      loadRecent("");
    });
  }

  bindUI();
  hookPaidShow();
  loadRecent("");

  // retry kalau Paid kebaca belakangan
  let retry = 0;
  const iv = setInterval(() => {
    if (window.LevPayPaid && (window.LevPayPaid.show || window.LevPayPaid.open)) {
      hookPaidShow();
      clearInterval(iv);
    }
    retry++;
    if (retry > 20) clearInterval(iv);
  }, 300);
})();
`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  // serve client JS
  if (req.method === "GET" && req.query?.client === "1") {
    return js(res, 200, clientBundle());
  }

  // GET single
  if (req.method === "GET" && req.query?.id) {
    const id = safeStr(req.query.id).trim();
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id_transaksi", id)
      .maybeSingle();

    if (error || !data) return json(res, 200, { ok: true, data: null });

    // balikin bentuk yang cocok buat paid.js
    return json(res, 200, {
      ok: true,
      data: {
        idTransaksi: data.id_transaksi,
        paidAt: data.paid_at,
        paidVia: data.paid_via,
        amountFinal: data.amount_final,
        payerName: data.payer_name,
        voucher: data.voucher,
        reference: data.reference,
        ...(data.raw || {}),
      },
    });
  }

  // GET list (limit 10) + smart search
  if (req.method === "GET") {
    const limit = Math.max(1, Math.min(LIMIT_MAX, Number(req.query?.limit || LIMIT_DEFAULT)));
    const q = safeStr(req.query?.q || "").trim();

    let query = supabase.from(TABLE).select("*", { count: "exact" }).order("paid_at", { ascending: false }).limit(limit);

    if (q) {
      const qq = q.replace(/%/g, "");
      // cari id / nama / via / voucher / reference
      query = query.or(
        [
          `id_transaksi.ilike.%${qq}%`,
          `payer_name.ilike.%${qq}%`,
          `paid_via.ilike.%${qq}%`,
          `voucher.ilike.%${qq}%`,
          `reference.ilike.%${qq}%`,
        ].join(",")
      );
    }

    const { data, error, count } = await query;
    if (error) return json(res, 200, { ok: false, total: 0, data: [] });

    const mapped = (data || []).map((row) => ({
      idTransaksi: row.id_transaksi,
      paidAt: row.paid_at,
      paidVia: row.paid_via,
      amountFinal: row.amount_final,
      payerName: row.payer_name,
      voucher: row.voucher,
      reference: row.reference,
      ...(row.raw || {}),
    }));

    return json(res, 200, { ok: true, total: count || mapped.length, data: mapped });
  }

  // POST upsert paid
  if (req.method === "POST") {
    try {
      const body = req.body || (await new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
        });
      }));

      const row = normalizePaidPayload(body);
      if (!row.id_transaksi) return json(res, 400, { ok: false, error: "Missing idTransaksi" });

      const { error } = await supabase
        .from(TABLE)
        .upsert(row, { onConflict: "id_transaksi" });

      if (error) return json(res, 500, { ok: false, error: error.message });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message || e) });
    }
  }

  return json(res, 405, { ok: false, error: "Method not allowed" });
    }
