(() => {
  // ===== CONFIG =====
  // Default sesuai hint HTML lu
  const API_PATH = "/api/levpay"; // ganti ke "/api/levpay" kalau backend lu pakai itu
  const API_ORIGIN = "https://levpay-api.vercel.app"; // kosong = same origin. Kalau beda domain: "https://levpay-api.vercel.app"
  const LS_ADMIN = "levpay_admin_key_v1";

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);

  const gate = $("gate");
  const app = $("app");

  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const btnOpenGate = $("btnOpenGate");
  const btnRefreshAll = $("btnRefreshAll");
  const loginMsg = $("loginMsg");

  const apiBaseText = $("apiBaseText");
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");

  const pillVoucherCount = $("pillVoucherCount");
  const pillMonthly = $("pillMonthly");

  // tabs
  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const tabVouchers = $("tab-vouchers");
  const tabMonthly = $("tab-monthly");
  const tabTools = $("tab-tools");

  // vouchers list
  const onlyActiveToggle = $("onlyActiveToggle");
  const btnLoadVouchers = $("btnLoadVouchers");
  const voucherTbody = $("voucherTbody");

  // voucher form
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

  // monthly form
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

  // unlimited
  const dev_id = $("dev_id");
  const dev_pepper = $("dev_pepper");
  const dev_key = $("dev_key");
  const btnGenKey = $("btnGenKey");
  const btnAddUnlimited = $("btnAddUnlimited");
  const btnRemoveUnlimited = $("btnRemoveUnlimited");
  const unlimitedTbody = $("unlimitedTbody");
  const msgUnlimited = $("msgUnlimited");

  // tools
  const btnRunApply = $("btnRunApply");
  const t_amount = $("t_amount");
  const t_deviceId = $("t_deviceId");
  const t_voucher = $("t_voucher");
  const t_ttl = $("t_ttl");
  const curlApply = $("curlApply");
  const jsonApply = $("jsonApply");

  // ===== STATE =====
  let ADMIN_KEY = "";
  let vouchers = [];
  let monthly = null;

  // ===== HELPERS =====
  function nowStr() {
    return new Date().toLocaleString("id-ID");
  }

  function setStatus(locked) {
    if (locked) {
      sysStatus.textContent = "LOCKED";
      app.classList.add("is-locked");
    } else {
      sysStatus.textContent = "READY";
      app.classList.remove("is-locked");
    }
  }

  function showGate(show) {
    gate.classList.toggle("is-on", !!show);
    gate.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function showMsg(el, text, warn = false) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
    el.classList.toggle("msg--warn", !!warn);
  }

  function apiBase() {
    const origin = (API_ORIGIN || "").trim();
    if (origin) return origin.replace(/\/+$/,"") + API_PATH;
    return location.origin + API_PATH;
  }

  function apiUrl(action) {
    return apiBase() + "?action=" + encodeURIComponent(action);
  }

  function isAdminAction(action) {
    return /^(voucher\.|monthly\.|tx\.)/.test(String(action || ""));
  }

  function sanitizeCode(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function numOrNull(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fmtRp(n) {
    const x = Number(n || 0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("id-ID");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setTab(name) {
    navItems.forEach(btn => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === name);
    });

    tabVouchers.classList.toggle("is-on", name === "vouchers");
    tabMonthly.classList.toggle("is-on", name === "monthly");
    tabTools.classList.toggle("is-on", name === "tools");
  }

  async function jfetch(url, opts) {
    const r = await fetch(url, opts);
    const txt = await r.text();
    let json = {};
    try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
    return { ok: r.ok, status: r.status, json };
  }

  function curlExample(action, method, body) {
    const base = "$HOST" + API_PATH;
    const admin = isAdminAction(action);
    const head = [];
    if (admin) head.push(`-H "X-Admin-Key: $ADMIN"`);
    if (method !== "GET") head.push(`-H "Content-Type: application/json"`);
    const h = head.length ? (" \\\n  " + head.join(" \\\n  ")) : "";
    const data = (method === "GET" || body == null) ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    return `curl -sS -X ${method} "${base}?action=${action}"${h}${data} | jq`;
  }

  async function callAction(action, { method="GET", body=null } = {}) {
    const headers = {};
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (isAdminAction(action)) headers["X-Admin-Key"] = ADMIN_KEY;

    return jfetch(apiUrl(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  }

  async function validateKey() {
    const r = await callAction("voucher.list", { method:"GET" });
    if (r.status === 401) return false;
    return !!r.ok;
  }

  // ===== VOUCHERS =====
  function renderVouchers() {
    const onlyActive = !!onlyActiveToggle?.checked;
    const list = onlyActive ? vouchers.filter(v => v.enabled !== false) : vouchers.slice();

    pillVoucherCount.textContent = String(list.filter(v => v.enabled !== false).length);

    if (!list.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = list.map(v => {
      const enabled = v.enabled !== false;
      const exp = v.expiresAt ? fmtDate(v.expiresAt) : "—";
      const maxUses = (v.maxUses == null ? "∞" : String(v.maxUses));
      return `
        <tr data-code="${escapeHtml(v.code)}">
          <td class="mono">${escapeHtml(v.code)}</td>
          <td>${escapeHtml(v.name || v.code)}</td>
          <td>${enabled ? `<span class="pill pill--ok">ON</span>` : `<span class="pill pill--muted">OFF</span>`}</td>
          <td class="mono">${escapeHtml(String(Number(v.percent||0)))}</td>
          <td class="mono">${escapeHtml(fmtRp(v.maxRp))}</td>
          <td class="mono">${escapeHtml(maxUses)}</td>
          <td class="mono">${escapeHtml(exp)}</td>
          <td class="tRight">
            <div class="row row--gap" style="justify-content:flex-end;">
              <button class="btn btn--ghost btnEdit" type="button">Edit</button>
              <button class="btn btn--danger btnDisable" type="button">Disable</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    Array.from(voucherTbody.querySelectorAll("tr")).forEach(tr => {
      const code = tr.getAttribute("data-code") || "";
      tr.querySelector(".btnEdit")?.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        pickVoucher(code);
      });
      tr.querySelector(".btnDisable")?.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await disableVoucher(code);
      });
      tr.addEventListener("click", () => pickVoucher(code));
    });
  }

  function pickVoucher(code) {
    const c = sanitizeCode(code);
    const v = vouchers.find(x => x.code === c);
    if (!v) return;

    setTab("vouchers");

    v_code.value = v.code || "";
    v_name.value = v.name || "";
    v_percent.value = String(Number(v.percent || 0));
    v_maxRp.value = String(Number(v.maxRp || 0));
    v_maxUses.value = (v.maxUses == null ? "" : String(Number(v.maxUses)));
    v_enabled.checked = (v.enabled !== false);

    // datetime-local expects "YYYY-MM-DDTHH:MM"
    if (v.expiresAt) {
      const d = new Date(v.expiresAt);
      if (Number.isFinite(d.getTime())) {
        const pad = (n) => String(n).padStart(2,"0");
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth()+1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        v_expiresAt.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
      } else v_expiresAt.value = "";
    } else {
      v_expiresAt.value = "";
    }
  }

  async function loadVouchers() {
    showMsg(msgVoucher, "", false);

    const r = await callAction("voucher.list", { method:"GET" });

    // show curl/json
    curlVoucher.textContent = curlExample("voucher.list", "GET", null);
    jsonVoucher.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) {
      showMsg(msgVoucher, `Gagal load voucher (HTTP ${r.status}).`, true);
      vouchers = [];
      renderVouchers();
      return false;
    }

    const raw = r.json?.data ?? r.json ?? [];
    const list = Array.isArray(raw) ? raw : [];

    vouchers = list.map(v => ({
      code: sanitizeCode(v.code || ""),
      name: String(v.name || ""),
      enabled: v.enabled !== false,
      percent: Number(v.percent || 0),
      maxRp: Number(v.maxRp || 0),
      maxUses: (v.maxUses == null ? null : Number(v.maxUses)),
      expiresAt: v.expiresAt || null,
      updatedAt: v.updatedAt || null,
      note: v.note || null,
    })).filter(v => v.code);

    renderVouchers();
    return true;
  }

  function buildVoucherPayload() {
    const code = sanitizeCode(v_code.value);
    if (!code) throw new Error("Voucher code wajib");

    const percent = Number(String(v_percent.value || "").trim());
    if (!Number.isFinite(percent)) throw new Error("Percent wajib angka");

    const payload = {
      code,
      name: String(v_name.value || "").trim() || code,
      enabled: !!v_enabled.checked,
      percent: Math.max(0, Math.min(100, percent)),
      maxRp: Math.max(0, Number(String(v_maxRp.value || "0").trim() || "0")),
    };

    const mu = numOrNull(v_maxUses.value);
    if (mu != null && mu > 0) payload.maxUses = mu;
    else payload.maxUses = null;

    const expRaw = String(v_expiresAt.value || "").trim();
    if (expRaw) {
      const dt = new Date(expRaw);
      if (Number.isFinite(dt.getTime())) payload.expiresAt = dt.toISOString();
    } else {
      payload.expiresAt = null;
    }

    return payload;
  }

  async function upsertVoucher() {
    showMsg(msgVoucher, "", false);

    let body;
    try {
      body = buildVoucherPayload();
    } catch (e) {
      showMsg(msgVoucher, e.message || "Form invalid", true);
      return;
    }

    const r = await callAction("voucher.upsert", { method:"POST", body });

    curlVoucher.textContent = curlExample("voucher.upsert", "POST", body);
    jsonVoucher.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) {
      showMsg(msgVoucher, `Gagal upsert voucher (HTTP ${r.status}).`, true);
      return;
    }

    showMsg(msgVoucher, "Voucher tersimpan ✅", false);
    await loadVouchers();
  }

  async function disableVoucher(codeMaybe) {
    showMsg(msgVoucher, "", false);

    const code = sanitizeCode(codeMaybe || v_code.value);
    if (!code) {
      showMsg(msgVoucher, "Voucher code kosong", true);
      return;
    }
    if (!confirm(`Disable voucher ${code}?`)) return;

    const body = { code };
    const r = await callAction("voucher.disable", { method:"POST", body });

    curlVoucher.textContent = curlExample("voucher.disable", "POST", body);
    jsonVoucher.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) {
      showMsg(msgVoucher, `Gagal disable (HTTP ${r.status}).`, true);
      return;
    }

    showMsg(msgVoucher, `Voucher ${code} disabled ✅`, false);
    await loadVouchers();
  }

  // ===== MONTHLY =====
  function renderMonthlyPill() {
    if (!monthly || typeof monthly !== "object") {
      pillMonthly.textContent = "—";
      return;
    }
    pillMonthly.textContent = monthly.enabled ? "ON" : "OFF";
  }

  function renderUnlimitedList() {
    const obj = monthly?.unlimited || {};
    const keys = Object.keys(obj || {}).filter(k => obj[k]).sort();

    if (!keys.length) {
      unlimitedTbody.innerHTML = `<tr><td colspan="2" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    unlimitedTbody.innerHTML = keys.map(k => `
      <tr data-key="${escapeHtml(k)}">
        <td class="mono" style="font-size:12px;">${escapeHtml(k)}</td>
        <td class="tRight">
          <button class="btn btn--danger btnRemoveOne" type="button">Remove</button>
        </td>
      </tr>
    `).join("");

    Array.from(unlimitedTbody.querySelectorAll(".btnRemoveOne")).forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const tr = btn.closest("tr");
        const k = tr?.getAttribute("data-key") || "";
        if (!k) return;
        dev_key.value = k;
        await removeUnlimited(k);
      });
    });
  }

  async function loadMonthly() {
    showMsg(msgMonthly, "", false);
    showMsg(msgUnlimited, "", false);

    const r = await callAction("monthly.get", { method:"GET" });

    curlMonthly.textContent = curlExample("monthly.get", "GET", null);
    jsonMonthly.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) {
      showMsg(msgMonthly, `Gagal load monthly (HTTP ${r.status}).`, true);
      monthly = null;
      renderMonthlyPill();
      renderUnlimitedList();
      return false;
    }

    monthly = r.json?.data ?? r.json ?? null;

    if (monthly && typeof monthly === "object") {
      m_enabled.checked = !!monthly.enabled;
      m_name.value = String(monthly.name ?? "");
      m_percent.value = String(Number(monthly.percent ?? 0));
      m_maxRp.value = String(Number(monthly.maxRp ?? 0));
      m_maxUses.value = (monthly.maxUses == null ? "" : String(Number(monthly.maxUses)));
    }

    renderMonthlyPill();
    renderUnlimitedList();
    return true;
  }

  function buildMonthlyPayload(extra = {}) {
    const payload = {
      enabled: !!m_enabled.checked,
      name: String(m_name.value || "").trim(),
      percent: Number(String(m_percent.value || "0").trim()),
      maxRp: Number(String(m_maxRp.value || "0").trim()),
    };

    const mu = numOrNull(m_maxUses.value);
    payload.maxUses = (mu != null && mu > 0) ? mu : null;

    return { ...payload, ...extra };
  }

  async function saveMonthly(extra = {}) {
    showMsg(msgMonthly, "", false);

    const body = buildMonthlyPayload(extra);
    const r = await callAction("monthly.set", { method:"POST", body });

    curlMonthly.textContent = curlExample("monthly.set", "POST", body);
    jsonMonthly.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) {
      showMsg(msgMonthly, `Gagal save monthly (HTTP ${r.status}).`, true);
      return false;
    }

    showMsg(msgMonthly, "Monthly tersimpan ✅", false);
    await loadMonthly();
    return true;
  }

  // ===== SHA256 deviceKey =====
  async function sha256Hex(input) {
    const enc = new TextEncoder();
    const buf = enc.encode(input);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
  }

  async function generateDeviceKey() {
    const id = String(dev_id.value || "").trim();
    const pep = String(dev_pepper.value || "").trim();

    if (!id || !pep) {
      showMsg(msgUnlimited, "Device ID & Pepper wajib diisi untuk generate deviceKey.", true);
      return "";
    }

    const key = await sha256Hex(id + "|" + pep);
    dev_key.value = key;
    showMsg(msgUnlimited, "deviceKey tergenerate ✅", false);
    return key;
  }

  async function addUnlimited(keyMaybe) {
    showMsg(msgUnlimited, "", false);
    const k = String(keyMaybe || dev_key.value || "").trim();
    if (!k) { showMsg(msgUnlimited, "deviceKey kosong.", true); return; }

    const body = { addUnlimitedDeviceKey: k };
    const r = await callAction("monthly.set", { method:"POST", body });

    curlMonthly.textContent = curlExample("monthly.set", "POST", body);
    jsonMonthly.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) { showMsg(msgUnlimited, `Gagal add unlimited (HTTP ${r.status}).`, true); return; }
    showMsg(msgUnlimited, "Unlimited deviceKey ditambahkan ✅", false);
    await loadMonthly();
  }

  async function removeUnlimited(keyMaybe) {
    showMsg(msgUnlimited, "", false);
    const k = String(keyMaybe || dev_key.value || "").trim();
    if (!k) { showMsg(msgUnlimited, "deviceKey kosong.", true); return; }
    if (!confirm("Remove unlimited deviceKey ini?")) return;

    const body = { removeUnlimitedDeviceKey: k };
    const r = await callAction("monthly.set", { method:"POST", body });

    curlMonthly.textContent = curlExample("monthly.set", "POST", body);
    jsonMonthly.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    if (!r.ok) { showMsg(msgUnlimited, `Gagal remove unlimited (HTTP ${r.status}).`, true); return; }
    showMsg(msgUnlimited, "Unlimited deviceKey dihapus ✅", false);
    await loadMonthly();
  }

  // ===== TOOLS: discount.apply =====
  async function runApply() {
    const body = {
      amount: Number(String(t_amount.value || "0").trim()),
      deviceId: String(t_deviceId.value || "").trim(),
      voucher: String(t_voucher.value || "").trim(),
      reserveTtlMs: Number(String(t_ttl.value || "360000").trim()),
    };

    const r = await callAction("discount.apply", { method:"POST", body });

    curlApply.textContent = curlExample("discount.apply", "POST", body);
    jsonApply.textContent = JSON.stringify({ ok:r.ok, status:r.status, data:r.json }, null, 2);

    // kalau fail, tetap tampil json nya
  }

  // ===== AUTH FLOW =====
  async function loginFlow() {
    showMsg(loginMsg, "", false);

    const key = String(adminKeyInput.value || "").trim();
    if (!key) {
      showMsg(loginMsg, "Admin key kosong.", true);
      return;
    }

    ADMIN_KEY = key;

    // test admin
    const ok = await validateKey();
    if (!ok) {
      showMsg(loginMsg, "Admin key salah / unauthorized (401).", true);
      ADMIN_KEY = "";
      return;
    }

    localStorage.setItem(LS_ADMIN, ADMIN_KEY);

    btnLogout.disabled = false;
    showMsg(loginMsg, "Login OK ✅", false);

    // unlock UI
    setStatus(false);
    showGate(false);

    await refreshAll();
  }

  function logoutFlow() {
    ADMIN_KEY = "";
    localStorage.removeItem(LS_ADMIN);
    btnLogout.disabled = true;
    adminKeyInput.value = "";
    showMsg(loginMsg, "", false);

    setStatus(true);
    showGate(true);
  }

  async function refreshAll() {
    if (!ADMIN_KEY) return;
    await loadVouchers();
    await loadMonthly();
    lastSync.textContent = nowStr();
  }

  // ===== EVENTS =====
  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tab");
      if (t) setTab(t);
    });
  });

  btnLogin?.addEventListener("click", loginFlow);
  btnLogout?.addEventListener("click", () => {
    if (!confirm("Keluar (hapus key dari browser ini)?")) return;
    logoutFlow();
  });

  btnOpenGate?.addEventListener("click", () => {
    showGate(true);
  });

  btnRefreshAll?.addEventListener("click", async () => {
    await refreshAll();
  });

  btnLoadVouchers?.addEventListener("click", loadVouchers);
  onlyActiveToggle?.addEventListener("change", renderVouchers);

  btnUpsertVoucher?.addEventListener("click", upsertVoucher);
  btnDisableVoucher?.addEventListener("click", async () => {
    await disableVoucher(v_code.value);
  });

  btnLoadMonthly?.addEventListener("click", loadMonthly);
  btnSaveMonthly?.addEventListener("click", () => saveMonthly());

  btnGenKey?.addEventListener("click", generateDeviceKey);
  btnAddUnlimited?.addEventListener("click", async () => {
    if (!dev_key.value) await generateDeviceKey();
    await addUnlimited(dev_key.value);
  });
  btnRemoveUnlimited?.addEventListener("click", async () => {
    await removeUnlimited(dev_key.value);
  });

  btnRunApply?.addEventListener("click", runApply);

  // ===== INIT =====
  function init() {
    apiBaseText.textContent = apiBase();
    lastSync.textContent = "—";

    // default tab
    setTab("vouchers");

    // preload admin from storage
    const saved = String(localStorage.getItem(LS_ADMIN) || "").trim();
    if (saved) {
      ADMIN_KEY = saved;
      btnLogout.disabled = false;

      // unlock but still validate in background
      setStatus(false);
      showGate(false);

      (async () => {
        const ok = await validateKey();
        if (!ok) {
          // invalid key
          logoutFlow();
          showMsg(loginMsg, "Admin key tersimpan tapi invalid (401).", true);
          return;
        }
        await refreshAll();
      })();
    } else {
      setStatus(true);
      showGate(true);
    }
  }

  init();
})();