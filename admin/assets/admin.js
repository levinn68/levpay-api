(() => {
  const $ = (id) => document.getElementById(id);

  // === Config ===
  const API_PATH = "/api/levpay";            // ✅ router yang bener
  const LS_ADMIN = "levpay_admin_key";

  let ADMIN = "";
  let vouchers = [];
  let monthly = null;
  let lastApply = null; // simpen response apply terakhir buat commit/release

  // Gate
  const gate = $("gate");
  const app = $("app");
  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const loginMsg = $("loginMsg");

  // Top
  const apiBaseText = $("apiBaseText");
  const btnRefreshAll = $("btnRefreshAll");
  const btnOpenGate = $("btnOpenGate");
  const pillAccount = $("pillAccount");

  // Side
  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");
  const pillVoucherCount = $("pillVoucherCount");
  const pillMonthly = $("pillMonthly");
  const pillInfo = $("pillInfo");

  // Tabs
  const tabInfo = $("tab-info");
  const tabVouchers = $("tab-vouchers");
  const tabMonthly = $("tab-monthly");
  const tabTools = $("tab-tools");
  const tabs = {
    info: tabInfo,
    vouchers: tabVouchers,
    monthly: tabMonthly,
    tools: tabTools,
  };

  // Info tab elements
  const infoMonthlyEnabled = $("infoMonthlyEnabled");
  const infoMonthlyName = $("infoMonthlyName");
  const infoMonthlyPercent = $("infoMonthlyPercent");
  const infoMonthlyMaxRp = $("infoMonthlyMaxRp");
  const infoMonthlyMaxUses = $("infoMonthlyMaxUses");
  const infoMonthlyUsed = $("infoMonthlyUsed");

  const info_deviceId = $("info_deviceId");
  const info_pepper = $("info_pepper");
  const info_deviceKey = $("info_deviceKey");
  const btnInfoGenKey = $("btnInfoGenKey");
  const btnInfoCopyKey = $("btnInfoCopyKey");

  // Voucher info list
  const onlyActiveToggle = $("onlyActiveToggle");
  const voucherInfoTbody = $("voucherInfoTbody");
  const btnLoadVouchersInfo = $("btnLoadVouchersInfo");

  // Voucher manager
  const onlyActiveToggle2 = $("onlyActiveToggle2");
  const btnLoadVouchers = $("btnLoadVouchers");
  const voucherTbody = $("voucherTbody");

  // Voucher form + codeboxes
  const v_code = $("v_code");
  const v_name = $("v_name");
  const v_percent = $("v_percent");
  const v_maxRp = $("v_maxRp");
  const v_maxUses = $("v_maxUses");
  const v_expiresAt = $("v_expiresAt");
  const v_enabled = $("v_enabled");
  const btnUpsertVoucher = $("btnUpsertVoucher");
  const btnDisableVoucher = $("btnDisableVoucher");
  const curlVoucher = $("curlVoucher");
  const jsonVoucher = $("jsonVoucher");
  const msgVoucher = $("msgVoucher");

  // Monthly
  const btnLoadMonthly = $("btnLoadMonthly");
  const btnSaveMonthly = $("btnSaveMonthly");
  const m_enabled = $("m_enabled");
  const m_name = $("m_name");
  const m_percent = $("m_percent");
  const m_maxRp = $("m_maxRp");
  const m_maxUses = $("m_maxUses");
  const curlMonthly = $("curlMonthly");
  const jsonMonthly = $("jsonMonthly");
  const msgMonthly = $("msgMonthly");

  // Unlimited deviceKey
  const dev_id = $("dev_id");
  const dev_pepper = $("dev_pepper");
  const dev_key = $("dev_key");
  const btnGenKey = $("btnGenKey");
  const btnAddUnlimited = $("btnAddUnlimited");
  const btnRemoveUnlimited = $("btnRemoveUnlimited");
  const unlimitedTbody = $("unlimitedTbody");
  const msgUnlimited = $("msgUnlimited");

  // Tools apply/commit/release
  const btnRunApply = $("btnRunApply");
  const btnRunCommit = $("btnRunCommit");
  const btnRunRelease = $("btnRunRelease");
  const t_amount = $("t_amount");
  const t_deviceId = $("t_deviceId");
  const t_voucher = $("t_voucher");
  const t_ttl = $("t_ttl");
  const curlApply = $("curlApply");
  const jsonApply = $("jsonApply");

  function showGate(on) {
    gate.classList.toggle("is-on", !!on);
    app.classList.toggle("is-locked", !!on);
    sysStatus.textContent = on ? "LOCKED" : "ACTIVE";
    btnLogout.disabled = on;
  }

  function setMsg(el, text, isWarn=false){
    if (!el) return;
    if (!text){
      el.style.display = "none";
      el.textContent = "";
      el.classList.remove("msg--warn");
      return;
    }
    el.style.display = "block";
    el.textContent = text;
    el.classList.toggle("msg--warn", !!isWarn);
  }

  function nowStr(){
    return new Date().toLocaleString("id-ID");
  }

  function apiBase(){
    return location.origin + API_PATH;
  }

  function endpoint(action){
    return `${apiBase()}?action=${encodeURIComponent(action)}`;
  }

  function isAdminAction(action){
    return /^(voucher\.|monthly\.|tx\.)/.test(action);
  }

  async function jfetch(url, opts){
    const r = await fetch(url, opts);
    const txt = await r.text();
    let json = {};
    try{ json = txt ? JSON.parse(txt) : {}; }catch{ json = { raw: txt }; }
    return { ok:r.ok, status:r.status, json };
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
    return r;
  }

  function fmtRp(n){
    const x = Number(n ?? 0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  }
  function fmtDate(iso){
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("id-ID");
  }
  function fmtUses(v){
    if (v == null) return "∞";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "∞";
  }
  function sanitizeCode(s){
    return String(s||"").trim().toUpperCase().replace(/\s+/g,"");
  }

  function curlFor(action, method, body){
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    if (isAdminAction(action)) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? (" \\\n  " + heads.join(" \\\n  ")) : "";
    const data = (method === "GET" || body == null) ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    return `curl -sS -X ${method} "${HOSTVAR}${API_PATH}?action=${action}"${h}${data} | jq`;
  }

  async function sha256Hex(str){
    const enc = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(hash));
    return arr.map(b => b.toString(16).padStart(2,"0")).join("");
  }

  // === Data loaders ===
  async function pingAndValidate(){
    apiBaseText.textContent = apiBase();
    const ping = await callAction("ping", {method:"GET"});
    if (!ping.ok) return { ok:false, err:`API error (${ping.status})` };

    const test = await callAction("voucher.list", {method:"GET"});
    if (test.status === 401) return { ok:false, err:"Admin Key salah (401)" };
    if (!test.ok) return { ok:false, err:`Key cek lagi (${test.status})` };
    return { ok:true };
  }

  async function loadVouchers(){
    const r = await callAction("voucher.list", {method:"GET"});
    if (!r.ok) throw new Error(`voucher.list error (${r.status})`);
    const raw = r.json?.data ?? r.json ?? [];
    const list = Array.isArray(raw) ? raw : [];
    vouchers = list.map(v => ({
      code: sanitizeCode(v.code),
      name: String(v.name||""),
      enabled: v.enabled !== false,
      percent: Number(v.percent||0),
      maxRp: Number(v.maxRp||0),
      maxUses: (v.maxUses == null ? null : Number(v.maxUses)),
      expiresAt: v.expiresAt || null,
      uses: Number(v.uses||0),
      note: v.note || null,
      updatedAt: v.updatedAt || null,
    })).filter(v => v.code);

    const on = vouchers.filter(v => v.enabled).length;
    pillVoucherCount.textContent = String(on);
  }

  async function loadMonthly(){
    const r = await callAction("monthly.get", {method:"GET"});
    if (!r.ok) throw new Error(`monthly.get error (${r.status})`);
    monthly = r.json?.data ?? r.json ?? null;

    if (!monthly || typeof monthly !== "object") return;

    pillMonthly.textContent = monthly.enabled ? "ON" : "OFF";

    // fill form
    m_enabled.checked = !!monthly.enabled;
    m_name.value = String(monthly.name ?? "");
    m_percent.value = String(Number(monthly.percent ?? 0));
    m_maxRp.value = String(Number(monthly.maxRp ?? 0));
    m_maxUses.value = (monthly.maxUses == null ? "" : String(Number(monthly.maxUses)));

    // info tab
    infoMonthlyEnabled.textContent = monthly.enabled ? "ON" : "OFF";
    infoMonthlyName.textContent = monthly.name || "PROMO BULANAN";
    infoMonthlyPercent.textContent = `${Number(monthly.percent||0)}%`;
    infoMonthlyMaxRp.textContent = fmtRp(monthly.maxRp);
    infoMonthlyMaxUses.textContent = (monthly.maxUses == null ? "∞" : String(monthly.maxUses));
    // backend versi fleksibel biasanya punya usedCountThisMonth / month
    infoMonthlyUsed.textContent = (monthly.usedCountThisMonth != null)
      ? String(monthly.usedCountThisMonth)
      : "—";

    pillInfo.textContent = monthly.enabled ? "ON" : "OFF";

    renderUnlimitedList();
  }

  function renderUnlimitedList(){
    const map = monthly?.unlimited || {};
    const keys = Object.keys(map);
    if (!keys.length){
      unlimitedTbody.innerHTML = `<tr><td colspan="2" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }
    unlimitedTbody.innerHTML = keys.map(k => `
      <tr>
        <td class="mono" style="word-break:break-all;">${k}</td>
        <td class="tRight">
          <button class="btn btn--danger" data-key="${k}" style="padding:8px 10px;border-radius:14px;">Remove</button>
        </td>
      </tr>
    `).join("");

    unlimitedTbody.querySelectorAll("button[data-key]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const key = btn.getAttribute("data-key");
        if (!confirm("Remove unlimited deviceKey ini?")) return;
        await monthlySet({ removeUnlimitedDeviceKey: key });
      });
    });
  }

  // === Render voucher tables ===
  function voucherRows(filtered){
    return filtered.map(v => `
      <tr data-code="${v.code}">
        <td class="mono">${v.code}</td>
        <td>${escapeHtml(v.name || v.code)}</td>
        <td>${v.enabled ? "ON" : "OFF"}</td>
        <td class="mono">${Number(v.percent||0)}%</td>
        <td class="mono">${fmtRp(v.maxRp)}</td>
        <td class="mono">${fmtUses(v.maxUses)}</td>
        <td class="mono">${fmtDate(v.expiresAt)}</td>
        <td class="tRight">
          <button class="btn btn--ghost pickBtn" style="padding:8px 10px;border-radius:14px;">Pilih</button>
        </td>
      </tr>
    `).join("");
  }

  function renderVoucherInfo(){
    const onlyOn = !!onlyActiveToggle.checked;
    const list = onlyOn ? vouchers.filter(v=>v.enabled) : vouchers.slice();
    if (!list.length){
      voucherInfoTbody.innerHTML = `<tr><td colspan="7" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }
    voucherInfoTbody.innerHTML = list.map(v => `
      <tr>
        <td class="mono">${v.code}</td>
        <td>${escapeHtml(v.name || v.code)}</td>
        <td>${v.enabled ? "ON" : "OFF"}</td>
        <td class="mono">${Number(v.percent||0)}%</td>
        <td class="mono">${fmtRp(v.maxRp)}</td>
        <td class="mono">${fmtUses(v.maxUses)}</td>
        <td class="mono">${fmtDate(v.expiresAt)}</td>
      </tr>
    `).join("");
  }

  function renderVoucherManager(){
    const onlyOn = !!onlyActiveToggle2.checked;
    const list = onlyOn ? vouchers.filter(v=>v.enabled) : vouchers.slice();
    if (!list.length){
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }
    voucherTbody.innerHTML = voucherRows(list);
    voucherTbody.querySelectorAll("tr").forEach(tr => {
      tr.querySelector(".pickBtn")?.addEventListener("click", () => {
        const code = tr.getAttribute("data-code");
        pickVoucher(code);
      });
    });
  }

  function pickVoucher(code){
    const v = vouchers.find(x => x.code === code);
    if (!v) return;
    v_code.value = v.code;
    v_name.value = v.name || v.code;
    v_percent.value = String(Number(v.percent||0));
    v_maxRp.value = String(Number(v.maxRp||0));
    v_maxUses.value = (v.maxUses == null ? "" : String(v.maxUses));
    v_expiresAt.value = v.expiresAt ? new Date(v.expiresAt).toISOString().slice(0,16) : "";
    v_enabled.checked = v.enabled !== false;

    const body = buildVoucherPayload();
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);
    jsonVoucher.textContent = "—";
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // === Actions: Voucher / Monthly ===
  function buildVoucherPayload(forceEnabled){
    const code = sanitizeCode(v_code.value);
    if (!code) throw new Error("Voucher code wajib");
    const percent = Number(String(v_percent.value||"").trim());
    if (!Number.isFinite(percent)) throw new Error("Diskon % wajib");

    const payload = {
      code,
      enabled: (forceEnabled != null) ? !!forceEnabled : !!v_enabled.checked,
      name: String(v_name.value||"").trim() || code,
      percent: Math.max(0, Math.min(100, percent)),
      maxRp: Math.max(0, Number(String(v_maxRp.value||"0").trim() || "0")),
      note: null
    };

    const mu = String(v_maxUses.value||"").trim();
    if (mu !== ""){
      const n = Number(mu);
      if (Number.isFinite(n) && n > 0) payload.maxUses = n;
    }

    const exp = String(v_expiresAt.value||"").trim();
    if (exp){
      const d = new Date(exp);
      if (Number.isFinite(d.getTime())) payload.expiresAt = d.toISOString();
    }

    return payload;
  }

  async function voucherUpsert(){
    setMsg(msgVoucher, "");
    const body = buildVoucherPayload();
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);

    const r = await callAction("voucher.upsert", {method:"POST", body});
    jsonVoucher.textContent = JSON.stringify(r.json, null, 2);

    if (!r.ok) throw new Error(r.json?.error || `upsert gagal (${r.status})`);
    setMsg(msgVoucher, "OK: voucher tersimpan.");
    await loadVouchers();
    renderVoucherInfo();
    renderVoucherManager();
  }

  async function voucherDisable(){
    setMsg(msgVoucher, "");
    const code = sanitizeCode(v_code.value);
    if (!code) throw new Error("Voucher code kosong");
    if (!confirm("Disable voucher ini?")) return;

    const body = { code };
    curlVoucher.textContent = curlFor("voucher.disable", "POST", body);

    const r = await callAction("voucher.disable", {method:"POST", body});
    jsonVoucher.textContent = JSON.stringify(r.json, null, 2);

    if (!r.ok) throw new Error(r.json?.error || `disable gagal (${r.status})`);
    setMsg(msgVoucher, "OK: voucher di-disable.");
    await loadVouchers();
    renderVoucherInfo();
    renderVoucherManager();
  }

  async function monthlySet(extraBody){
    setMsg(msgMonthly, "");
    const body = {
      enabled: !!m_enabled.checked,
      name: String(m_name.value||"").trim(),
      percent: Number(String(m_percent.value||"0").trim()),
      maxRp: Number(String(m_maxRp.value||"0").trim()),
    };

    const mu = String(m_maxUses.value||"").trim();
    body.maxUses = (mu === "") ? null : Number(mu);

    Object.assign(body, extraBody || {});

    curlMonthly.textContent = curlFor("monthly.set", "POST", body);

    const r = await callAction("monthly.set", {method:"POST", body});
    jsonMonthly.textContent = JSON.stringify(r.json, null, 2);

    if (!r.ok) throw new Error(r.json?.error || `monthly.set gagal (${r.status})`);
    setMsg(msgMonthly, "OK: monthly tersimpan.");
    await loadMonthly();
  }

  // === Tools: apply/commit/release ===
  async function runApply(){
    const body = {
      amount: Number(String(t_amount.value||"0").trim()),
      deviceId: String(t_deviceId.value||"").trim(),
      voucher: String(t_voucher.value||"").trim(),
      reserveTtlMs: Number(String(t_ttl.value||"360000").trim())
    };
    curlApply.textContent = curlFor("discount.apply", "POST", body);

    const r = await callAction("discount.apply", {method:"POST", body});
    jsonApply.textContent = JSON.stringify(r.json, null, 2);

    // simpan buat commit/release
    if (r.ok){
      lastApply = r.json?.data || null;
    }
  }

  async function runCommit(){
    const reservations = lastApply?.reservations;
    if (!Array.isArray(reservations) || !reservations.length){
      alert("Belum ada reservations. Jalankan Apply dulu.");
      return;
    }
    const body = { reservations };
    curlApply.textContent = curlFor("discount.commit", "POST", body);

    const r = await callAction("discount.commit", {method:"POST", body});
    jsonApply.textContent = JSON.stringify(r.json, null, 2);

    // refresh info
    await loadVouchers();
    await loadMonthly();
    renderVoucherInfo();
    renderVoucherManager();
  }

  async function runRelease(){
    const reservations = lastApply?.reservations;
    if (!Array.isArray(reservations) || !reservations.length){
      alert("Belum ada reservations. Jalankan Apply dulu.");
      return;
    }
    const body = { reservations };
    curlApply.textContent = curlFor("discount.release", "POST", body);

    const r = await callAction("discount.release", {method:"POST", body});
    jsonApply.textContent = JSON.stringify(r.json, null, 2);
  }

  // === Unlimited keys actions ===
  async function genKeyTo(elOut, deviceId, pepper){
    const did = String(deviceId||"").trim();
    const pep = String(pepper||"").trim();
    if (!did || !pep){
      elOut.value = "";
      return null;
    }
    const key = await sha256Hex(`${did}|${pep}`);
    elOut.value = key;
    return key;
  }

  // === Tab switching ===
  function setTab(name){
    navItems.forEach(b => b.classList.toggle("is-active", b.getAttribute("data-tab") === name));
    Object.entries(tabs).forEach(([k, el]) => el.classList.toggle("is-on", k === name));
  }

  // === Events ===
  navItems.forEach(btn => btn.addEventListener("click", () => setTab(btn.getAttribute("data-tab"))));

  btnOpenGate.addEventListener("click", () => showGate(true));

  btnRefreshAll.addEventListener("click", async () => {
    try{
      await loadVouchers();
      await loadMonthly();
      renderVoucherInfo();
      renderVoucherManager();
      lastSync.textContent = nowStr();
    }catch(e){
      alert(e.message || "Refresh gagal");
    }
  });

  btnLogin.addEventListener("click", async () => {
    setMsg(loginMsg, "");
    ADMIN = String(adminKeyInput.value||"").trim();
    if (!ADMIN){
      setMsg(loginMsg, "Admin key kosong.", true);
      return;
    }

    const v = await pingAndValidate();
    if (!v.ok){
      setMsg(loginMsg, v.err, true);
      return;
    }

    localStorage.setItem(LS_ADMIN, ADMIN);
    adminKeyInput.value = "";
    pillAccount.textContent = "ACTIVE";
    showGate(false);

    await loadVouchers();
    await loadMonthly();
    renderVoucherInfo();
    renderVoucherManager();

    lastSync.textContent = nowStr();
  });

  btnLogout.addEventListener("click", () => {
    localStorage.removeItem(LS_ADMIN);
    ADMIN = "";
    pillAccount.textContent = "LOCKED";
    showGate(true);
  });

  btnLoadVouchersInfo.addEventListener("click", async () => {
    await loadVouchers();
    renderVoucherInfo();
    lastSync.textContent = nowStr();
  });

  btnLoadVouchers.addEventListener("click", async () => {
    await loadVouchers();
    renderVoucherManager();
    lastSync.textContent = nowStr();
  });

  onlyActiveToggle.addEventListener("change", renderVoucherInfo);
  onlyActiveToggle2.addEventListener("change", renderVoucherManager);

  btnUpsertVoucher.addEventListener("click", async () => {
    try{ await voucherUpsert(); }
    catch(e){ setMsg(msgVoucher, e.message || "Upsert gagal", true); }
  });

  btnDisableVoucher.addEventListener("click", async () => {
    try{ await voucherDisable(); }
    catch(e){ setMsg(msgVoucher, e.message || "Disable gagal", true); }
  });

  btnLoadMonthly.addEventListener("click", async () => {
    try{
      curlMonthly.textContent = curlFor("monthly.get", "GET", null);
      const r = await callAction("monthly.get", {method:"GET"});
      jsonMonthly.textContent = JSON.stringify(r.json, null, 2);
      if (!r.ok) throw new Error(r.json?.error || "monthly.get error");
      await loadMonthly();
      lastSync.textContent = nowStr();
    }catch(e){
      setMsg(msgMonthly, e.message || "Load monthly gagal", true);
    }
  });

  btnSaveMonthly.addEventListener("click", async () => {
    try{ await monthlySet(); lastSync.textContent = nowStr(); }
    catch(e){ setMsg(msgMonthly, e.message || "Save monthly gagal", true); }
  });

  btnGenKey.addEventListener("click", async () => {
    await genKeyTo(dev_key, dev_id.value, dev_pepper.value);
  });

  btnAddUnlimited.addEventListener("click", async () => {
    try{
      const key = dev_key.value || await genKeyTo(dev_key, dev_id.value, dev_pepper.value);
      if (!key) return setMsg(msgUnlimited, "Isi deviceId + pepper dulu.", true);
      await monthlySet({ addUnlimitedDeviceKey: key });
      setMsg(msgUnlimited, "OK: added unlimited.");
    }catch(e){
      setMsg(msgUnlimited, e.message || "Add unlimited gagal", true);
    }
  });

  btnRemoveUnlimited.addEventListener("click", async () => {
    try{
      const key = dev_key.value || await genKeyTo(dev_key, dev_id.value, dev_pepper.value);
      if (!key) return setMsg(msgUnlimited, "Isi deviceId + pepper dulu.", true);
      await monthlySet({ removeUnlimitedDeviceKey: key });
      setMsg(msgUnlimited, "OK: removed.");
    }catch(e){
      setMsg(msgUnlimited, e.message || "Remove gagal", true);
    }
  });

  btnRunApply.addEventListener("click", runApply);
  btnRunCommit.addEventListener("click", runCommit);
  btnRunRelease.addEventListener("click", runRelease);

  btnInfoGenKey.addEventListener("click", async () => {
    await genKeyTo(info_deviceKey, info_deviceId.value, info_pepper.value);
  });
  btnInfoCopyKey.addEventListener("click", async () => {
    try{ await navigator.clipboard.writeText(String(info_deviceKey.value||"")); }catch{}
  });

  // === Init ===
  async function init(){
    apiBaseText.textContent = apiBase();
    lastSync.textContent = "—";

    ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();

    if (!ADMIN){
      showGate(true);
      return;
    }

    const v = await pingAndValidate();
    if (!v.ok){
      showGate(true);
      return;
    }

    showGate(false);
    await loadVouchers();
    await loadMonthly();
    renderVoucherInfo();
    renderVoucherManager();
    lastSync.textContent = nowStr();

    // Seed curl boxes
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", {
      code:"VIPL", enabled:true, name:"VIP LEVEL", percent:10, maxRp:0, maxUses:100,
      expiresAt:"2026-12-31T23:59:59.000Z"
    });
    curlMonthly.textContent = curlFor("monthly.set", "POST", {
      enabled:true, name:"PROMO BULANAN", percent:5, maxRp:2000, maxUses:null
    });
    curlApply.textContent = curlFor("discount.apply", "POST", {
      amount:10000, deviceId:"dev_frontend_1", voucher:"VIPL", reserveTtlMs:360000
    });
  }

  init();
})();