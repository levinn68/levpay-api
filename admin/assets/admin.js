(() => {
  "use strict";

  // =========================
  // CONFIG
  // =========================
  // Router backend: /api/levpay (Vercel single-file router)
  // Kalau kamu deploy beda origin, ganti API_BASE manual di bawah.
  const API_BASE = location.origin; // contoh: "https://levpay-api.vercel.app"
  const API_PATH = "/api/levpay";   // ganti ke "/api/orkut" kalau router kamu namanya itu

  const LS_ADMIN_KEY = "levpay_admin_key";
  const LS_TAB = "levpay_admin_tab";

  // =========================
  // DOM
  // =========================
  const $ = (id) => document.getElementById(id);

  const gate = $("gate");
  const app = $("app");

  // gate / login
  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const loginMsg = $("loginMsg");

  // topbar
  const apiBaseText = $("apiBaseText");
  const btnRefreshAll = $("btnRefreshAll");
  const btnOpenGate = $("btnOpenGate");

  // sidebar pills
  const pillVoucherCount = $("pillVoucherCount");
  const pillMonthly = $("pillMonthly");
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");

  // nav/tabs
  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const tabEls = {
    vouchers: $("tab-vouchers"),
    monthly: $("tab-monthly"),
    tools: $("tab-tools"),
  };

  // vouchers tab
  const onlyActiveToggle = $("onlyActiveToggle");
  const btnLoadVouchers = $("btnLoadVouchers");
  const voucherTbody = $("voucherTbody");

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

  // monthly tab
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

  // unlimited device key
  const dev_id = $("dev_id");
  const dev_pepper = $("dev_pepper");
  const dev_key = $("dev_key");
  const btnGenKey = $("btnGenKey");
  const btnAddUnlimited = $("btnAddUnlimited");
  const btnRemoveUnlimited = $("btnRemoveUnlimited");
  const unlimitedTbody = $("unlimitedTbody");
  const msgUnlimited = $("msgUnlimited");

  // tools tab
  const btnRunApply = $("btnRunApply");
  const t_amount = $("t_amount");
  const t_deviceId = $("t_deviceId");
  const t_voucher = $("t_voucher");
  const t_ttl = $("t_ttl");
  const curlApply = $("curlApply");
  const jsonApply = $("jsonApply");

  // =========================
  // STATE
  // =========================
  let ADMIN_KEY = "";
  /** @type {Array<any>} */
  let vouchers = [];
  /** @type {any} */
  let monthly = null;

  // =========================
  // HELPERS
  // =========================
  function setLocked(on) {
    gate.classList.toggle("is-on", !!on);
    gate.setAttribute("aria-hidden", on ? "false" : "true");
    app.classList.toggle("is-locked", !!on);

    sysStatus.textContent = on ? "LOCKED" : "ACTIVE";
    btnLogout.disabled = on;
  }

  function setTab(name) {
    navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    Object.entries(tabEls).forEach(([k, el]) => el.classList.toggle("is-on", k === name));
    localStorage.setItem(LS_TAB, name);
  }

  function nowStr() {
    return new Date().toLocaleString("id-ID");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normCode(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function maskCode(code) {
    const s = String(code || "");
    if (s.length <= 4) return "••••";
    return "••••" + s.slice(-2);
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtRp(n) {
    const x = num(n, 0);
    return x === 0 ? "∞" : x.toLocaleString("id-ID");
  }

  function fmtUses(v) {
    if (v == null) return "∞";
    const x = num(v, NaN);
    return Number.isFinite(x) ? String(Math.floor(x)) : "∞";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString("id-ID") : "—";
  }

  function apiUrl(action) {
    return `${API_BASE}${API_PATH}?action=${encodeURIComponent(action)}`;
  }

  function isAdminAction(action) {
    return /^(voucher\.|monthly\.|tx\.)/.test(action);
  }

  async function jfetch(action, { method = "GET", body = null } = {}) {
    const headers = {};
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (isAdminAction(action)) headers["X-Admin-Key"] = ADMIN_KEY;

    const res = await fetch(apiUrl(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  }

  function curlPreview(action, method, body) {
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    if (isAdminAction(action)) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? " \\\n  " + heads.join(" \\\n  ") : "";
    const d = method === "GET" || body == null ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    return `curl -sS -X ${method} "${HOSTVAR}${API_PATH}?action=${action}"${h}${d} | jq`;
  }

  function setMsg(el, text, tone = "") {
    if (!el) return;
    el.classList.remove("msg--warn", "msg--ok");
    if (tone === "warn") el.classList.add("msg--warn");
    if (tone === "ok") el.classList.add("msg--ok");
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  // =========================
  // LOGIN / VALIDATE
  // =========================
  async function ping() {
    const r = await jfetch("ping", { method: "GET" });
    return r.ok;
  }

  async function validateKey() {
    const r = await jfetch("voucher.list", { method: "GET" });
    if (r.status === 401) return { ok: false, reason: "401" };
    return { ok: !!r.ok, reason: r.ok ? "" : "bad" };
  }

  async function doLogin() {
    ADMIN_KEY = String(adminKeyInput.value || "").trim();
    if (!ADMIN_KEY) {
      setMsg(loginMsg, "Admin key kosong.", "warn");
      return;
    }

    localStorage.setItem(LS_ADMIN_KEY, ADMIN_KEY);

    apiBaseText.textContent = `${API_BASE}${API_PATH}`;

    setMsg(loginMsg, "Cek API & key…", "");
    const okPing = await ping();
    if (!okPing) {
      setMsg(loginMsg, "API tidak bisa diakses. Cek deploy / path router.", "warn");
      return;
    }

    const v = await validateKey();
    if (!v.ok) {
      setMsg(loginMsg, "Admin key salah (401).", "warn");
      return;
    }

    setLocked(false);
    setMsg(loginMsg, "");

    await refreshAll();
  }

  function doLogout() {
    localStorage.removeItem(LS_ADMIN_KEY);
    ADMIN_KEY = "";
    adminKeyInput.value = "";
    setLocked(true);
    setMsg(loginMsg, "");
    vouchers = [];
    monthly = null;
    renderVouchers();
    renderUnlimited();
  }

  // =========================
  // LOAD / RENDER
  // =========================
  async function loadVouchers() {
    const r = await jfetch("voucher.list", { method: "GET" });
    if (!r.ok) throw new Error("voucher.list gagal");
    const raw = r.json?.data ?? r.json ?? [];
    vouchers = Array.isArray(raw) ? raw : [];
  }

  async function loadMonthly() {
    const r = await jfetch("monthly.get", { method: "GET" });
    if (!r.ok) throw new Error("monthly.get gagal");
    monthly = r.json?.data ?? r.json ?? null;
  }

  function renderVouchers() {
    const onlyActive = !!onlyActiveToggle?.checked;
    const list = (vouchers || []).filter((v) => {
      const enabled = v?.enabled !== false;
      return onlyActive ? enabled : true;
    });

    const onCount = (vouchers || []).filter((v) => v?.enabled !== false).length;
    pillVoucherCount.textContent = String(onCount);

    if (!list.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = list
      .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || "")))
      .map((v) => {
        const code = normCode(v?.code || "");
        const name = String(v?.name || code);
        const enabled = v?.enabled !== false;
        const percent = num(v?.percent, 0);
        const maxRp = num(v?.maxRp, 0);
        const maxUses = v?.maxUses == null ? null : num(v?.maxUses, null);
        const expiresAt = v?.expiresAt || null;

        return `
          <tr>
            <td class="mono">${esc(maskCode(code))}</td>
            <td>${esc(name)}</td>
            <td>${enabled ? `<span class="tag tag--ok">ON</span>` : `<span class="tag">OFF</span>`}</td>
            <td class="mono">${esc(percent)}%</td>
            <td class="mono">${esc(fmtRp(maxRp))}</td>
            <td class="mono">${esc(fmtUses(maxUses))}</td>
            <td class="mono">${esc(fmtDate(expiresAt))}</td>
            <td class="tRight">
              <div class="rowAct">
                <button class="btn btn--ghost btn--xs" data-act="edit" data-code="${esc(code)}">Edit</button>
                <button class="btn btn--danger btn--xs" data-act="disable" data-code="${esc(code)}">Disable</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    Array.from(voucherTbody.querySelectorAll("button[data-act]")).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const act = btn.getAttribute("data-act");
        const code = btn.getAttribute("data-code") || "";
        if (!code) return;

        if (act === "edit") {
          pickVoucher(code);
          return;
        }

        if (act === "disable") {
          if (!confirm(`Disable voucher ${code}?`)) return;
          await disableVoucher(code);
        }
      });
    });
  }

  function pickVoucher(code) {
    const v = (vouchers || []).find((x) => normCode(x?.code) === normCode(code));
    if (!v) return;

    v_code.value = normCode(v.code);
    v_name.value = String(v.name || v_code.value);
    v_percent.value = String(num(v.percent, 0));
    v_maxRp.value = String(num(v.maxRp, 0));
    v_maxUses.value = v.maxUses == null ? "" : String(num(v.maxUses, 0));
    v_enabled.checked = v.enabled !== false;

    if (v.expiresAt) {
      const d = new Date(v.expiresAt);
      if (Number.isFinite(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        const val = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
          d.getHours()
        )}:${pad(d.getMinutes())}`;
        v_expiresAt.value = val;
      }
    } else {
      v_expiresAt.value = "";
    }

    setTab("vouchers");
  }

  function renderMonthlyToForm() {
    if (!monthly || typeof monthly !== "object") return;

    m_enabled.checked = !!monthly.enabled;
    m_name.value = String(monthly.name || "");
    m_percent.value = String(num(monthly.percent, 0));
    m_maxRp.value = String(num(monthly.maxRp, 0));
    m_maxUses.value = monthly.maxUses == null ? "" : String(num(monthly.maxUses, 0));

    const st = monthly.stats || {};
    const month = st.month || "—";
    const used = st.usedCount ?? 0;
    const reserved = st.reservedCount ?? 0;
    const remaining = st.remaining == null ? "∞" : String(st.remaining);
    const usedDeviceCount = st.usedDeviceCount ?? 0;

    pillMonthly.textContent = monthly.enabled ? "ON" : "OFF";

    setMsg(
      msgMonthly,
      `Bulan: ${month} • used global: ${used} • reserved: ${reserved} • remaining: ${remaining} • used device: ${usedDeviceCount}`,
      "ok"
    );
  }

  function renderUnlimited() {
    const keys = Object.keys(monthly?.unlimited || {});
    if (!keys.length) {
      unlimitedTbody.innerHTML = `<tr><td colspan="2" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    unlimitedTbody.innerHTML = keys
      .sort((a, b) => a.localeCompare(b))
      .map(
        (k) => `
      <tr>
        <td class="mono">${esc(k)}</td>
        <td class="tRight">
          <button class="btn btn--danger btn--xs" data-remove="${esc(k)}">Remove</button>
        </td>
      </tr>
    `
      )
      .join("");

    Array.from(unlimitedTbody.querySelectorAll("button[data-remove]")).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.getAttribute("data-remove");
        if (!key) return;
        if (!confirm("Remove unlimited deviceKey ini?")) return;
        await setMonthly({ removeUnlimitedDeviceKey: key });
      });
    });
  }

  // =========================
  // ACTIONS
  // =========================
  function buildVoucherPayload() {
    const code = normCode(v_code.value);
    if (!code) throw new Error("Code wajib");

    const payload = {
      code,
      enabled: !!v_enabled.checked,
      name: String(v_name.value || "").trim() || code,
      percent: Math.max(0, Math.min(100, num(v_percent.value, 0))),
      maxRp: Math.max(0, num(v_maxRp.value, 0)),
      note: null,
    };

    const mu = String(v_maxUses.value || "").trim();
    if (mu !== "") {
      const n = num(mu, NaN);
      if (!Number.isFinite(n) || n < 1) throw new Error("Max Uses invalid");
      payload.maxUses = Math.floor(n);
    } else {
      payload.maxUses = null;
    }

    const expRaw = String(v_expiresAt.value || "").trim();
    if (expRaw) {
      const d = new Date(expRaw);
      if (!Number.isFinite(d.getTime())) throw new Error("Expires At invalid");
      payload.expiresAt = d.toISOString();
    } else {
      payload.expiresAt = null;
    }

    return payload;
  }

  async function upsertVoucher() {
    try {
      const body = buildVoucherPayload();
      curlVoucher.textContent = curlPreview("voucher.upsert", "POST", body);

      const r = await jfetch("voucher.upsert", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify(r.json, null, 2);

      if (!r.ok) throw new Error(r.json?.error || "Upsert gagal");
      setMsg(msgVoucher, "Voucher tersimpan.", "ok");

      await loadVouchers();
      renderVouchers();
    } catch (e) {
      setMsg(msgVoucher, String(e?.message || e), "warn");
    }
  }

  async function disableVoucher(code) {
    const body = { code: normCode(code) };
    curlVoucher.textContent = curlPreview("voucher.disable", "POST", body);

    const r = await jfetch("voucher.disable", { method: "POST", body });
    jsonVoucher.textContent = JSON.stringify(r.json, null, 2);

    if (!r.ok) {
      setMsg(msgVoucher, r.json?.error || "Disable gagal", "warn");
      return;
    }
    setMsg(msgVoucher, "Voucher di-disable.", "ok");

    await loadVouchers();
    renderVouchers();
  }

  async function setMonthly(partial) {
    try {
      const body = partial || {};
      curlMonthly.textContent = curlPreview("monthly.set", "POST", body);

      const r = await jfetch("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify(r.json, null, 2);

      if (!r.ok) throw new Error(r.json?.error || "monthly.set gagal");
      setMsg(msgUnlimited, "Saved.", "ok");

      await loadMonthly();
      renderMonthlyToForm();
      renderUnlimited();
      lastSync.textContent = nowStr();
    } catch (e) {
      setMsg(msgUnlimited, String(e?.message || e), "warn");
    }
  }

  async function saveMonthlyFromForm() {
    try {
      const body = {
        enabled: !!m_enabled.checked,
        name: String(m_name.value || "").trim(),
        percent: num(m_percent.value, 0),
        maxRp: Math.max(0, num(m_maxRp.value, 0)),
      };

      const mu = String(m_maxUses.value || "").trim();
      body.maxUses = mu === "" ? null : Math.floor(num(mu, 0));

      curlMonthly.textContent = curlPreview("monthly.set", "POST", body);

      const r = await jfetch("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify(r.json, null, 2);

      if (!r.ok) throw new Error(r.json?.error || "Save gagal");
      setMsg(msgMonthly, "Promo bulanan tersimpan.", "ok");

      await loadMonthly();
      renderMonthlyToForm();
      renderUnlimited();
      lastSync.textContent = nowStr();
    } catch (e) {
      setMsg(msgMonthly, String(e?.message || e), "warn");
    }
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder();
    const buf = enc.encode(str);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function genDeviceKey() {
    const did = String(dev_id.value || "").trim();
    const pep = String(dev_pepper.value || "").trim();
    if (!did || !pep) {
      setMsg(msgUnlimited, "Isi Device ID dan Device Pepper dulu.", "warn");
      return;
    }
    const key = await sha256Hex(`${did}|${pep}`);
    dev_key.value = key;
    setMsg(msgUnlimited, "deviceKey dibuat.", "ok");
  }

  async function addUnlimited() {
    const key = String(dev_key.value || "").trim();
    if (!key) {
      setMsg(msgUnlimited, "deviceKey kosong.", "warn");
      return;
    }
    await setMonthly({ addUnlimitedDeviceKey: key });
    setMsg(msgUnlimited, "Unlimited ditambahkan.", "ok");
  }

  async function removeUnlimited() {
    const key = String(dev_key.value || "").trim();
    if (!key) {
      setMsg(msgUnlimited, "deviceKey kosong.", "warn");
      return;
    }
    await setMonthly({ removeUnlimitedDeviceKey: key });
    setMsg(msgUnlimited, "Unlimited dihapus.", "ok");
  }

  async function runApply() {
    try {
      const body = {
        amount: num(t_amount.value, 0),
        deviceId: String(t_deviceId.value || "").trim(),
        voucher: String(t_voucher.value || "").trim(),
        reserveTtlMs: num(t_ttl.value, 360000),
      };

      curlApply.textContent = curlPreview("discount.apply", "POST", body);

      const r = await jfetch("discount.apply", { method: "POST", body });
      jsonApply.textContent = JSON.stringify(r.json, null, 2);

      if (!r.ok) throw new Error(r.json?.error || "discount.apply gagal");
    } catch (e) {
      jsonApply.textContent = JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2);
    }
  }

  async function refreshAll() {
    try {
      apiBaseText.textContent = `${API_BASE}${API_PATH}`;

      await loadVouchers();
      await loadMonthly();

      renderVouchers();
      renderMonthlyToForm();
      renderUnlimited();

      lastSync.textContent = nowStr();
    } catch (e) {
      setMsg(loginMsg, "Gagal sync. Cek admin key / router.", "warn");
    }
  }

  // =========================
  // EVENTS
  // =========================
  navItems.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  btnLogin?.addEventListener("click", doLogin);
  adminKeyInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  btnLogout?.addEventListener("click", () => {
    if (!confirm("Logout?")) return;
    doLogout();
  });

  btnOpenGate?.addEventListener("click", () => {
    setLocked(true);
    adminKeyInput.focus();
  });

  btnRefreshAll?.addEventListener("click", async () => {
    if (!ADMIN_KEY) {
      setLocked(true);
      return;
    }
    await refreshAll();
  });

  btnLoadVouchers?.addEventListener("click", async () => {
    await loadVouchers();
    renderVouchers();
    lastSync.textContent = nowStr();
  });

  onlyActiveToggle?.addEventListener("change", renderVouchers);

  btnUpsertVoucher?.addEventListener("click", upsertVoucher);

  btnDisableVoucher?.addEventListener("click", async () => {
    const code = normCode(v_code.value);
    if (!code) return setMsg(msgVoucher, "Code kosong.", "warn");
    if (!confirm(`Disable voucher ${code}?`)) return;
    await disableVoucher(code);
  });

  btnLoadMonthly?.addEventListener("click", async () => {
    await loadMonthly();
    renderMonthlyToForm();
    renderUnlimited();
    lastSync.textContent = nowStr();
  });

  btnSaveMonthly?.addEventListener("click", saveMonthlyFromForm);

  btnGenKey?.addEventListener("click", genDeviceKey);
  btnAddUnlimited?.addEventListener("click", addUnlimited);
  btnRemoveUnlimited?.addEventListener("click", removeUnlimited);

  btnRunApply?.addEventListener("click", runApply);

  // =========================
  // INIT
  // =========================
  (function init() {
    apiBaseText.textContent = `${API_BASE}${API_PATH}`;

    const t = localStorage.getItem(LS_TAB) || "vouchers";
    setTab(t);

    const saved = String(localStorage.getItem(LS_ADMIN_KEY) || "").trim();
    if (saved) {
      ADMIN_KEY = saved;
      setLocked(false);
      refreshAll().catch(() => setLocked(true));
    } else {
      setLocked(true);
    }
  })();
})();