(() => {
  const $ = (id) => document.getElementById(id);

  const LS_HOST  = "levpay_admin_host";
  const LS_ADMIN = "levpay_admin_key";
  const LS_TAB   = "levpay_admin_tab";

  let HOST = "";
  let ADMIN = "";
  let vouchers = [];
  let monthly = null;
  let last = { action:"", method:"GET", admin:false, body:null, response:{} };

  // login elements
  const inHost = $("inHost");
  const inAdmin = $("inAdmin");
  const btnReset = $("btnReset");
  const btnPingLock = $("btnPingLock");
  const btnLogin = $("btnLogin");
  const pillApi = $("pillApi");
  const pillKey = $("pillKey");

  // top
  const hostMini = $("hostMini");
  const pillActive = $("pillActive");
  const pillVoucher = $("pillVoucher");
  const pillMonthly = $("pillMonthly");
  const btnRefresh = $("btnRefresh");
  const btnLogout = $("btnLogout");

  // nav/tabs
  const navBtns = Array.from(document.querySelectorAll(".navbtn"));
  const tabs = {
    active: $("tab-active"),
    voucher: $("tab-voucher"),
    monthly: $("tab-monthly"),
    tester: $("tab-tester"),
    curl: $("tab-curl"),
  };

  // active list
  const activeSearch = $("activeSearch");
  const showCode = $("showCode");
  const activeTbody = $("activeTbody");
  const activeCards = $("activeCards");

  // voucher form
  const btnNewVoucher = $("btnNewVoucher");
  const btnLoadVouchers = $("btnLoadVouchers");
  const btnUpsert = $("btnUpsert");
  const btnDisable = $("btnDisable");

  const vCode = $("vCode");
  const vEnabled = $("vEnabled");
  const vName = $("vName");
  const vPercent = $("vPercent");
  const vMaxRp = $("vMaxRp");
  const vMaxUses = $("vMaxUses");
  const vExpiresAt = $("vExpiresAt");
  const vNote = $("vNote");

  // monthly
  const btnGetMonthly = $("btnGetMonthly");
  const btnSetMonthly = $("btnSetMonthly");
  const mEnabled = $("mEnabled");
  const mName = $("mName");
  const mPercent = $("mPercent");
  const mMaxRp = $("mMaxRp");

  // tester
  const btnGenDevice = $("btnGenDevice");
  const btnApply = $("btnApply");
  const btnCreateQR = $("btnCreateQR");
  const tAmount = $("tAmount");
  const tDeviceId = $("tDeviceId");
  const tVoucher = $("tVoucher");

  // curl tab
  const btnCopyCurl = $("btnCopyCurl");
  const btnCopyJson = $("btnCopyJson");
  const btnCopyResp = $("btnCopyResp");
  const btnPing = $("btnPing");
  const curlBox = $("curlBox");
  const bodyBox = $("bodyBox");
  const respBox = $("respBox");

  function lock(on){ document.body.classList.toggle("locked", !!on); }

  function setPill(el, tone, text){
    el.classList.remove("ok","warn","bad");
    el.classList.add(tone);
    el.querySelector("span:last-child").textContent = text;
  }

  function normHost(h){
    const x = String(h||"").trim().replace(/\/+$/,"");
    return x || location.origin;
  }

  function endpoint(action){
    return normHost(HOST) + "/api/levpay?action=" + encodeURIComponent(action);
  }

  function isAdminAction(action){
    return /^(voucher\.|monthly\.|tx\.)/.test(action);
  }

  function sanitizeCode(s){
    return String(s||"").trim().toUpperCase().replace(/\s+/g,"");
  }

  function maskCode(code){
    const s = String(code||"");
    if (s.length <= 4) return "••••";
    return "••••" + s.slice(-2);
  }

  function fmtRp(n){
    const x = Number(n||0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  }

  function fmtUses(v){
    if (v == null) return "∞";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "∞";
  }

  function fmtDate(iso){
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("id-ID");
  }

  async function copy(text){
    try { await navigator.clipboard.writeText(String(text||"")); } catch {}
  }

  function curlFor(action, method, body){
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    const admin = isAdminAction(action);
    if (admin) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? (" \\\n  " + heads.join(" \\\n  ")) : "";
    const data = (method === "GET" || body == null) ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    return `curl -sS -X ${method} "${HOSTVAR}/api/levpay?action=${action}"${h}${data} | jq`;
  }

  function setLast({action, method, body, response}){
    last.action = action;
    last.method = method;
    last.admin = isAdminAction(action);
    last.body = body ?? null;
    last.response = response ?? {};
    curlBox.textContent = curlFor(action, method, last.body);
    bodyBox.textContent = JSON.stringify(last.body ?? {}, null, 2);
    respBox.textContent = JSON.stringify(last.response ?? {}, null, 2);
  }

  async function jfetch(url, opts){
    const r = await fetch(url, opts);
    const txt = await r.text();
    let json = {};
    try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
    return { ok: r.ok, status: r.status, json };
  }

  async function callAction(action, {method="GET", body=null} = {}){
    const headers = {};
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (isAdminAction(action)) headers["X-Admin-Key"] = ADMIN;

    const r = await jfetch(endpoint(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    setLast({ action, method, body, response: { ok:r.ok, status:r.status, data:r.json }});
    return r;
  }

  async function ping(){
    const r = await callAction("ping", { method:"GET" });
    setPill(pillApi, r.ok ? "ok" : "bad", r.ok ? "API: OK" : "API: ERROR");
    return r;
  }

  async function validateKey(){
    const r = await callAction("voucher.list", { method:"GET" });
    if (r.status === 401){
      setPill(pillKey, "bad", "Key: salah (401)");
      return false;
    }
    setPill(pillKey, r.ok ? "ok" : "warn", r.ok ? "Key: OK" : "Key: cek lagi");
    return !!r.ok;
  }

  async function loadVouchers(){
    setPill(pillVoucher, "warn", "Voucher: loading…");
    const r = await callAction("voucher.list", { method:"GET" });
    if (!r.ok){
      setPill(pillVoucher, "bad", "Voucher: error");
      return;
    }
    const raw = r.json?.data ?? r.json ?? [];
    const list = Array.isArray(raw) ? raw : [];

    vouchers = list.map(v => ({
      code: sanitizeCode(v.code||""),
      name: String(v.name||""),
      enabled: v.enabled !== false,
      percent: Number(v.percent||0),
      maxRp: Number(v.maxRp||0),
      maxUses: (v.maxUses == null ? null : Number(v.maxUses)),
      expiresAt: v.expiresAt || null,
      note: v.note || null,
      updatedAt: v.updatedAt || null
    })).filter(v => v.code);

    const on = vouchers.filter(v => v.enabled).length;
    setPill(pillVoucher, "ok", `Voucher: ${on} ON`);
  }

  async function loadMonthly(){
    setPill(pillMonthly, "warn", "Monthly: loading…");
    const r = await callAction("monthly.get", { method:"GET" });
    if (!r.ok){
      setPill(pillMonthly, "bad", "Monthly: error");
      return;
    }
    monthly = r.json?.data ?? r.json ?? null;

    if (monthly && typeof monthly === "object"){
      setPill(pillMonthly, "ok", `Monthly: ${monthly.enabled ? "ON":"OFF"}`);
      mEnabled.value = String(!!monthly.enabled);
      mName.value = String(monthly.name ?? "");
      mPercent.value = String(Number(monthly.percent ?? 0));
      mMaxRp.value = String(Number(monthly.maxRp ?? 0));
    } else {
      setPill(pillMonthly, "bad", "Monthly: invalid");
    }
  }

  function buildActiveList(){
    const list = [];
    if (monthly && typeof monthly === "object"){
      list.push({
        kind: "monthly",
        enabled: !!monthly.enabled,
        code: "(monthly)",
        name: String(monthly.name || "PROMO BULANAN"),
        percent: Number(monthly.percent||0),
        maxRp: Number(monthly.maxRp||0),
        maxUses: "1x/device/bulan",
        expiresAt: null
      });
    }
    for (const v of vouchers){
      if (!v.enabled) continue;
      list.push({
        kind: "voucher",
        enabled: true,
        code: v.code,
        name: v.name || v.code,
        percent: Number(v.percent||0),
        maxRp: Number(v.maxRp||0),
        maxUses: (v.maxUses == null ? null : v.maxUses),
        expiresAt: v.expiresAt || null
      });
    }
    return list;
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setTab(name){
    navBtns.forEach(b=>{
      b.classList.toggle("active", b.getAttribute("data-tab")===name);
    });
    Object.entries(tabs).forEach(([k, el])=>{
      el.classList.toggle("active", k===name);
    });
    localStorage.setItem(LS_TAB, name);
  }

  function toIsoFromPicker(){
    const raw = String(vExpiresAt.value||"").trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }

  function buildVoucherPayload(forceEnabled){
    const code = sanitizeCode(vCode.value);
    if (!code) throw new Error("Voucher code wajib");
    const percent = Number(String(vPercent.value||"").trim());
    if (!Number.isFinite(percent)) throw new Error("Diskon % wajib");

    const payload = {
      code,
      enabled: (forceEnabled != null) ? !!forceEnabled : (vEnabled.value === "true"),
      name: String(vName.value||"").trim() || code,
      percent: Math.max(0, Math.min(100, percent)),
      maxRp: Math.max(0, Number(String(vMaxRp.value||"0").trim() || "0")),
      note: String(vNote.value||"").trim() || null
    };

    const mu = String(vMaxUses.value||"").trim();
    if (mu !== ""){
      const n = Number(mu);
      if (Number.isFinite(n) && n > 0) payload.maxUses = n;
    }

    const exp = toIsoFromPicker();
    if (exp) payload.expiresAt = exp;

    return payload;
  }

  function clearVoucherForm(){
    vCode.value = "";
    vEnabled.value = "true";
    vName.value = "";
    vPercent.value = "";
    vMaxRp.value = "0";
    vMaxUses.value = "";
    vExpiresAt.value = "";
    vNote.value = "";
    setLast({
      action:"voucher.upsert",
      method:"POST",
      body:{ code:"VIPL", enabled:true, name:"VIP LEVEL", percent:10, maxRp:0, maxUses:100, expiresAt:"2026-12-31T23:59:59.000Z", note:"..." },
      response:last.response
    });
  }

  function genDeviceId(){
    const a = Math.random().toString(36).slice(2,8);
    const b = Math.random().toString(36).slice(2,8);
    return "dev_web_" + a + "_" + b;
  }

  function handlePickDiscount(kind, code){
    if (kind === "monthly"){
      setTab("monthly");
      setLast({ action:"monthly.get", method:"GET", body:null, response:last.response });
      return;
    }
    const v = vouchers.find(v=>v.code===code);
    if (!v) return;

    setTab("voucher");
    vCode.value = v.code;
    vEnabled.value = "true";
    vName.value = v.name || v.code;
    vPercent.value = String(Number(v.percent||0));
    vMaxRp.value = String(Number(v.maxRp||0));
    vMaxUses.value = (v.maxUses == null ? "" : String(v.maxUses));
    vNote.value = v.note || "";
    vExpiresAt.value = v.expiresAt ? new Date(v.expiresAt).toISOString() : "";

    setLast({ action:"voucher.upsert", method:"POST", body: buildVoucherPayload(), response:last.response });
  }

  function renderActive(){
    const q = String(activeSearch.value||"").trim().toLowerCase();
    const sc = showCode.value;
    const list = buildActiveList().filter(x=>{
      if (!q) return true;
      const hay = (x.name + " " + (x.kind==="voucher" ? x.code : "")).toLowerCase();
      return hay.includes(q);
    });

    const voucherOn = vouchers.filter(v=>v.enabled).length;
    const monthlyOn = !!(monthly && monthly.enabled);
    setPill(pillActive, "ok", `Active: ${voucherOn} voucher + monthly ${monthlyOn ? "ON":"OFF"}`);

    if (!list.length){
      activeTbody.innerHTML = `<tr><td colspan="7" class="muted">Tidak ada active discount.</td></tr>`;
      activeCards.innerHTML = `<div class="mrow muted">Tidak ada active discount.</div>`;
      return;
    }

    // Desktop table
    activeTbody.innerHTML = list.map(x=>{
      const jenis = x.kind === "monthly"
        ? `<span class="badge b-month">monthly</span>`
        : `<span class="badge">voucher</span>`;
      const status = x.enabled
        ? `<span class="badge b-on">ON</span>`
        : `<span class="badge b-off">OFF</span>`;

      const codeShown = x.kind==="voucher"
        ? (sc==="show" ? x.code : maskCode(x.code))
        : "—";

      const maxUsesText = (x.kind==="monthly")
        ? String(x.maxUses)
        : fmtUses(x.maxUses);

      return `
        <tr data-kind="${x.kind}" data-code="${x.code}">
          <td>${jenis}</td>
          <td>${status}</td>
          <td>
            <div><strong>${escapeHtml(x.name)}</strong></div>
            <div class="muted mono" style="font-size:12px;margin-top:4px;">
              ${x.kind==="voucher" ? "CODE: "+escapeHtml(codeShown) : "1× / device / bulan"}
            </div>
          </td>
          <td class="right mono">${escapeHtml(String(x.percent))}%</td>
          <td class="right mono">${escapeHtml(fmtRp(x.maxRp))}</td>
          <td class="right mono">${escapeHtml(maxUsesText)}</td>
          <td class="mono">${escapeHtml(x.kind==="voucher" ? fmtDate(x.expiresAt) : "—")}</td>
        </tr>
      `;
    }).join("");

    Array.from(activeTbody.querySelectorAll("tr")).forEach(tr=>{
      tr.addEventListener("click", ()=>{
        handlePickDiscount(tr.getAttribute("data-kind"), tr.getAttribute("data-code"));
      });
    });

    // Mobile cards
    activeCards.innerHTML = list.map(x=>{
      const status = x.enabled ? `<span class="badge b-on">ON</span>` : `<span class="badge b-off">OFF</span>`;
      const jenis = x.kind === "monthly" ? `<span class="badge b-month">monthly</span>` : `<span class="badge">voucher</span>`;
      const codeText = x.kind==="voucher" ? (sc==="show" ? x.code : maskCode(x.code)) : "—";
      const maxUsesText = (x.kind==="monthly") ? "1×/device/bulan" : fmtUses(x.maxUses);

      return `
        <div class="mrow" data-kind="${x.kind}" data-code="${x.code}">
          <div class="mtop">
            <div class="row">
              ${jenis}
              ${status}
            </div>
            <div class="codeMini">${x.kind==="voucher" ? "CODE: "+escapeHtml(codeText) : ""}</div>
          </div>
          <div class="mname">${escapeHtml(x.name)}</div>
          <div class="msub">
            <div class="kv"><span class="k">Diskon</span><span class="v mono">${escapeHtml(String(x.percent))}%</span></div>
            <div class="kv"><span class="k">MaxRp</span><span class="v mono">${escapeHtml(fmtRp(x.maxRp))}</span></div>
            <div class="kv"><span class="k">MaxUses</span><span class="v mono">${escapeHtml(maxUsesText)}</span></div>
            <div class="kv"><span class="k">Expired</span><span class="v mono">${escapeHtml(x.kind==="voucher" ? fmtDate(x.expiresAt) : "—")}</span></div>
          </div>
        </div>
      `;
    }).join("");

    Array.from(activeCards.querySelectorAll(".mrow")).forEach(row=>{
      row.addEventListener("click", ()=>{
        handlePickDiscount(row.getAttribute("data-kind"), row.getAttribute("data-code"));
      });
    });
  }

  // events
  navBtns.forEach(b => b.addEventListener("click", () => setTab(b.getAttribute("data-tab"))));

  btnCopyCurl.addEventListener("click", ()=> copy(curlBox.textContent));
  btnCopyJson.addEventListener("click", ()=> copy(bodyBox.textContent));
  btnCopyResp.addEventListener("click", ()=> copy(respBox.textContent));
  btnPing.addEventListener("click", ping);

  btnRefresh.addEventListener("click", async ()=>{
    await ping();
    const ok = await validateKey();
    if (!ok) return;
    await loadVouchers();
    await loadMonthly();
    renderActive();
  });

  btnLogout.addEventListener("click", ()=>{
    if (!confirm("Logout?")) return;
    localStorage.removeItem(LS_ADMIN);
    ADMIN = "";
    lock(true);
    setPill(pillKey, "warn", "Key: belum");
  });

  btnReset.addEventListener("click", ()=>{
    localStorage.removeItem(LS_HOST);
    localStorage.removeItem(LS_ADMIN);
    inHost.value = "";
    inAdmin.value = "";
    HOST = location.origin;
    ADMIN = "";
    setPill(pillApi, "warn", "API: belum dicek");
    setPill(pillKey, "warn", "Key: belum");
  });

  btnPingLock.addEventListener("click", async ()=>{
    HOST = normHost(inHost.value);
    await ping();
  });

  btnLogin.addEventListener("click", async ()=>{
    HOST = normHost(inHost.value);
    ADMIN = String(inAdmin.value||"").trim();
    if (!ADMIN){ setPill(pillKey, "bad", "Key: kosong"); return; }

    localStorage.setItem(LS_HOST, HOST);
    localStorage.setItem(LS_ADMIN, ADMIN);

    await ping();
    const ok = await validateKey();
    if (!ok) return;

    lock(false);
    await loadVouchers();
    await loadMonthly();
    renderActive();
  });

  btnNewVoucher.addEventListener("click", clearVoucherForm);

  btnLoadVouchers.addEventListener("click", async ()=>{
    await loadVouchers();
    renderActive();
  });

  btnUpsert.addEventListener("click", async ()=>{
    try{
      const body = buildVoucherPayload();
      await callAction("voucher.upsert", { method:"POST", body });
      await loadVouchers();
      renderActive();
      setTab("curl");
    } catch(e){
      setLast({ action:"voucher.upsert", method:"POST", body:null, response:{ ok:false, error: e.message } });
      setTab("curl");
    }
  });

  btnDisable.addEventListener("click", async ()=>{
    const code = sanitizeCode(vCode.value);
    if (!code){ alert("Voucher code kosong"); return; }
    if (!confirm("Disable voucher ini?")) return;
    await callAction("voucher.disable", { method:"POST", body:{ code } });
    await loadVouchers();
    renderActive();
    setTab("curl");
  });

  btnGetMonthly.addEventListener("click", async ()=>{
    await loadMonthly();
    renderActive();
    setTab("curl");
  });

  btnSetMonthly.addEventListener("click", async ()=>{
    const body = {
      enabled: (mEnabled.value === "true"),
      name: String(mName.value||"").trim(),
      percent: Number(String(mPercent.value||"0").trim()),
      maxRp: Number(String(mMaxRp.value||"0").trim())
    };
    await callAction("monthly.set", { method:"POST", body });
    await loadMonthly();
    renderActive();
    setTab("curl");
  });

  btnGenDevice.addEventListener("click", ()=>{ tDeviceId.value = genDeviceId(); });

  btnApply.addEventListener("click", async ()=>{
    const body = {
      amount: Number(String(tAmount.value||"0").trim()),
      deviceId: String(tDeviceId.value||"").trim(),
      voucher: String(tVoucher.value||"").trim()
    };
    await callAction("discount.apply", { method:"POST", body });
    setTab("curl");
  });

  btnCreateQR.addEventListener("click", async ()=>{
    const body = {
      amount: Number(String(tAmount.value||"0").trim()),
      deviceId: String(tDeviceId.value||"").trim(),
      voucher: String(tVoucher.value||"").trim()
    };
    await callAction("createqr", { method:"POST", body });
    setTab("curl");
  });

  activeSearch.addEventListener("input", renderActive);
  showCode.addEventListener("change", renderActive);

  // init
  function init(){
    HOST = normHost(localStorage.getItem(LS_HOST) || location.origin);
    ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();

    hostMini.textContent = HOST.replace(/^https?:\/\//,"");
    inHost.value = (HOST === location.origin) ? "" : HOST;
    inAdmin.value = "";

    setPill(pillApi, "warn", "API: belum dicek");
    setPill(pillKey, "warn", "Key: belum");
    setPill(pillVoucher, "warn", "Voucher: —");
    setPill(pillMonthly, "warn", "Monthly: —");
    setPill(pillActive, "warn", "Active: —");

    tDeviceId.value = genDeviceId();

    const t = localStorage.getItem(LS_TAB) || "active";
    setTab(t);

    setLast({
      action:"voucher.upsert",
      method:"POST",
      body:{ code:"VIPL", enabled:true, name:"VIP LEVEL", percent:10, maxRp:0, maxUses:100, expiresAt:"2026-12-31T23:59:59.000Z", note:"..." },
      response:{}
    });

    // flatpickr
    if (window.flatpickr){
      flatpickr(vExpiresAt, { enableTime:true, time_24hr:true, dateFormat:"Y-m-d H:i", allowInput:true });
    }

    if (ADMIN){
      lock(false);
      (async ()=>{
        await ping();
        const ok = await validateKey();
        if (!ok){ lock(true); return; }
        await loadVouchers();
        await loadMonthly();
        renderActive();
      })();
    } else {
      lock(true);
    }
  }

  init();
})();