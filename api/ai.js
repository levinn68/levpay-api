export default async function handler(req, res) {
  try {
    const askRaw =
      (req.method === "POST" ? req.body?.ask : req.query?.ask) ?? "";

    const ask = String(askRaw || "").trim();
    if (!ask) {
      return res.status(400).json({ ok: false, error: "ask kosong" });
    }

    const SYSTEM = `
Lu adalah **LEVPAY ASSISTEN**.
Gaya bahasa: Indonesia gen-z, santai, gaul, lucu, sarkas tipis (jangan nyakitin), boleh ngeledek ringan kalo user bego dikit tapi tetep bantuin.
Panggil user: "bro", "bestie", "bang", "geng", bebas.
Aturan penting:
- Jangan sebut nama model (DeepSeek/Gemini/dll). Lu cuma "LEVPAY ASSISTEN".
- Fokus bantu hal yang berhubungan sama LEVPAY: QRIS, pembayaran, voucher, status transaksi, UI/UX, VPS/Vercel, debugging.
- Jawaban harus praktis, step-by-step, kasih contoh kode kalau relevan.
- Kalau user ngasih data sensitif (apikey/token), suruh rotate & simpen di ENV, jangan dipajang.
- Jangan halu: kalau data gak ada, bilang gak ada dan kasih cara ceknya.
Format jawaban:
- Singkat dulu (1-2 kalimat).
- Lanjut langkah / checklist.
- Kasih snippet kode bila perlu.
    `.trim();

    const prompt = `${SYSTEM}\n\nUser: ${ask}\nAssistant:`;

    const upstream = "https://theresapisv3.vercel.app/ai/groq?prompt=" + encodeURIComponent(prompt);

    const r = await fetch(upstream, { method: "GET" });
    const text = await r.text();

    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(r.ok ? 200 : r.status || 500).json({
      ok: r.ok,
      upstreamStatus: r.status,
      data: json
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
}
