// admin/admin.js — FINAL (NO location.origin)
// API hardcode ke domain API biar admin bisa dibuka dari mana aja.

(() => {
  const $ = (id) => document.getElementById(id);

  // ====== CONFIG ======
  const LS_ADMIN = "levpay_admin_key_v5";
  const LS_API_BASE = "levpay_admin_api_base_v5";

  // ✅ HARDCODE API DOMAIN (NO location.origin)
  const API_BASE_DEFAULT = "https://levpay-api.vercel.app/api/levpay";

  // Optional preset
  const PRESET_DEVICE_ID = "dev_rog6pro";

  // ====== ELEMENTS ======
  const gate = $("gate");
  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const loginMsg = $("loginMsg");

  const app = $("app");
  const btnRefreshAll = $("btnRefreshAll");
  const btnOpenGate = $("btnOpenGate");
  const apiBaseText = $("apiBaseText");

  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const tabVouchers = $("tab-vouchers");
  const tabMonthly = $("tab-monthly");
  const tabTools = $("tab-tools");

  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");
  const pillVoucherCount = $("pillVoucherCount");
  const pillMonthly = $("pillMonthly");

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
  const m_code = $("m_code");
  const m_name = $("m_name");
  const m_percent = $("m_percent");
  const m_maxRp = $("m_maxRp");
  const m_maxUses = $("m_maxUses");
  const curlMonthly = $("curlMonthly");
  const jsonMonthly = $("jsonMonthly");
  const msgMonthly = $("msgMonthly");

  // unlimited
  const dev_id = $("dev_id");
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
  const t_code = $("t_voucher"); // kode voucher/promo
  const t_ttl = $("t_ttl");
  const curlApply = $("curlApply");
  const jsonApply = $("jsonApply");

  // ====== STATE ======
  let ADMIN = "";
  let API_BASE = (localStorage.getItem(LS_API_BASE) || API_BASE_DEFAULT).trim();
  let vouchers = [];
  let monthly = null;

  // ====== UTILS ======
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const nowText = () => new Date().toLocaleString("id-ID");

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("id-ID");
  };

  const fmtRp = (n) => {
    const x = Number(n || 0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  };

  const fmtUsesPair = (used, max) => {
    const u = Number(used || 0);
    if (max == null) return `${u} / ∞`;
    const m = Number(max);
    if (!Number.isFinite(m) || m <= 0) return `${u} / ∞`;
    return `${u} / ${m}`;
  };

  function setMsg(el, text, warn = false) {
    el.textContent = text || "";
    el.classList.toggle("msg--warn", !!warn);
    el.classList.toggle("msg--ok", !!text && !warn);
    el.style.display = text ? "block" : "none";
  }

  function setLocked(on) {
    gate.classList.toggle("is-on", !!on);
    gate.setAttribute("aria-hidden", on ? "false" : "true");
    app.classList.toggle("is-locked", !!on);
    sysStatus.textContent = on ? "LOCKED" : "ACTIVE";
    btnLogout.disabled = on;
  }

  function setTab(name) {
    navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    tabVouchers.classList.toggle("is-on", name === "vouchers");
    tabMonthly.classList.toggle("is-on", name === "monthly");
    tabTools.classList.toggle("is-on", name === "tools");
  }

  function normalizeApiBase(s) {
    let x = String(s || "").trim();
    if (!x) x = API_BASE_DEFAULT;
    x = x.replace(/\/+$/, "");
    const q = x.indexOf("?");
    if (q >= 0) x = x.slice(0, q);
    return x;
  }

  // ✅ endpoint tanpa location.origin sama sekali
  function endpoint(action) {
    const base = normalizeApiBase(API_BASE);
    const glue = base.includes("?") ? "&" : "?";
    return `${base}${glue}action=${encodeURIComponent(action)}`;
  }

  function isAdminAction(action) {
    return /^(voucher\.|monthly\.|tx\.|devicekey)$/.test(action);
  }

  function sanitizeCode(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  async function jfetch(url, opts) {
    const r = await fetch(url, opts);
    const txt = await r.text();
    let json = {};
    try {
      json = txt ? JSON.parse(txt) : {};
    } catch {
      json = { raw: txt };
    }
    return { ok: r.ok, status: r.status, json };
  }

  function curlFor(action, method, body) {
    const HOSTVAR = "https://levpay-api.vercel.app";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    if (isAdminAction(action)) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? ` \\\n  ${heads.join(" \\\n  ")}` : "";
    const data = method === "GET" || body == null ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    return `curl -sS -X ${method} "${HOSTVAR}/api/levpay?action=${action}"${h}${data} | jq`;
  }

  async function callAction(action, { method = "GET", body = null } = {}) {
    const headers = {};
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (isAdminAction(action)) headers["X-Admin-Key"] = ADMIN;

    return jfetch(endpoint(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // ====== LOADERS ======
  async function pingPublic() {
    const r = await callAction("ping", { method: "GET" });
    apiBaseText.textContent = normalizeApiBase(API_BASE);
    if (!r.ok) throw new Error(`API ping error (${r.status})`);
    return r.json;
  }

  async function validateKey() {
    const r = await callAction("voucher.list", { method: "GET" });
    if (r.status === 401) return false;
    return r.ok;
  }

  async function loadVouchers() {
    const r = await callAction("voucher.list", { method: "GET" });
    if (!r.ok) throw new Error(`voucher.list error (${r.status})`);
    const raw = r.json?.data ?? r.json ?? [];
    const list = Array.isArray(raw) ? raw : [];

    vouchers = list
      .map((v) => ({
        code: sanitizeCode(v.code || ""),
        name: String(v.name || ""),
        enabled: v.enabled !== false,
        percent: Number(v.percent || 0),
        maxRp: Number(v.maxRp || 0),
        maxUses: v.maxUses == null ? null : Number(v.maxUses),
        expiresAt: v.expiresAt || null,
        updatedAt: v.updatedAt || null,
        uses: Number(v.uses || 0),
      }))
      .filter((v) => v.code);

    const on = vouchers.filter((v) => v.enabled).length;
    pillVoucherCount.textContent = String(on);
    return vouchers;
  }

  async function loadMonthly() {
    const r = await callAction("monthly.get", { method: "GET" });
    if (!r.ok) throw new Error(`monthly.get error (${r.status})`);
    monthly = r.json?.data ?? r.json ?? null;

    if (!monthly || typeof monthly !== "object") throw new Error("monthly invalid");

    pillMonthly.textContent = monthly.enabled ? "ON" : "OFF";

    m_enabled.checked = !!monthly.enabled;
    m_code.value = String(monthly.code ?? "");
    m_name.value = String(monthly.name ?? "");
    m_percent.value = String(Number(monthly.percent ?? 0));
    m_maxRp.value = String(Number(monthly.maxRp ?? 0));
    m_maxUses.value = monthly.maxUses == null ? "" : String(Number(monthly.maxUses));

    renderUnlimitedList();
    return monthly;
  }

  function renderUnlimitedList() {
    const keys = Object.keys(monthly?.unlimited || {});
    if (!keys.length) {
      unlimitedTbody.innerHTML = `<tr><td colspan="2" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    unlimitedTbody.innerHTML = keys
      .sort()
      .map(
        (k) => `
      <tr>
        <td class="mono">${esc(k)}</td>
        <td class="tRight">
          <button class="btn btn--danger" data-del="${esc(k)}" type="button">Remove</button>
        </td>
      </tr>
    `
      )
      .join("");

    unlimitedTbody.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const k = btn.getAttribute("data-del");
        if (!k) return;
        if (!confirm("Remove deviceKey dari unlimited?")) return;
        try {
          const body = { removeUnlimitedDeviceKey: k };
          const rr = await callAction("monthly.set", { method: "POST", body });
          curlMonthly.textContent = curlFor("monthly.set", "POST", body);
          jsonMonthly.textContent = JSON.stringify({ ok: rr.ok, status: rr.status, data: rr.json }, null, 2);
          await loadMonthly();
          setMsg(msgUnlimited, "Removed ✅");
        } catch (e) {
          setMsg(msgUnlimited, `Error: ${e?.message || e}`, true);
        }
      });
    });
  }

  // ====== RENDER ======
  function renderVoucherTable() {
    const onlyActive = !!onlyActiveToggle.checked;
    const list = onlyActive ? vouchers.filter((v) => v.enabled) : vouchers.slice();

    if (!list.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = list
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((v) => {
        const active = v.enabled ? `<span class="badge on">ON</span>` : `<span class="badge off">OFF</span>`;
        const exp = v.expiresAt ? fmtDate(v.expiresAt) : "—";
        return `
        <tr>
          <td class="mono">${esc(v.code)}</td>
          <td>${esc(v.name || v.code)}</td>
          <td>${active}</td>
          <td class="mono">${esc(String(v.percent))}%</td>
          <td class="mono">${esc(fmtRp(v.maxRp))}</td>
          <td class="mono">${esc(fmtUsesPair(v.uses, v.maxUses))}</td>
          <td class="mono">${esc(exp)}</td>
          <td class="tRight">
            <button class="btn btn--ghost" data-pick="${esc(v.code)}" type="button">Edit</button>
          </td>
        </tr>
      `;
      })
      .join("");

    voucherTbody.querySelectorAll("button[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-pick");
        if (!code) return;
        const v = vouchers.find((x) => x.code === code);
        if (!v) return;

        v_code.value = v.code;
        v_name.value = v.name || v.code;
        v_percent.value = String(v.percent || 0);
        v_maxRp.value = String(v.maxRp || 0);
        v_maxUses.value = v.maxUses == null ? "" : String(v.maxUses);
        v_enabled.checked = !!v.enabled;

        if (v.expiresAt) {
          const d = new Date(v.expiresAt);
          if (Number.isFinite(d.getTime())) {
            const pad = (n) => String(n).padStart(2, "0");
            const y = d.getFullYear();
            const m = pad(d.getMonth() + 1);
            const da = pad(d.getDate());
            const hh = pad(d.getHours());
            const mm = pad(d.getMinutes());
            v_expiresAt.value = `${y}-${m}-${da}T${hh}:${mm}`;
          } else v_expiresAt.value = "";
        } else v_expiresAt.value = "";

        try {
          const body = buildVoucherPayload();
          curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);
        } catch {}
      });
    });
  }

  function buildVoucherPayload() {
    const code = sanitizeCode(v_code.value);
    if (!code) throw new Error("Code wajib");
    const percent = Number(String(v_percent.value || "").trim());
    if (!Number.isFinite(percent)) throw new Error("Percent wajib angka");

    const payload = {
      code,
      enabled: !!v_enabled.checked,
      name: String(v_name.value || "").trim() || code,
      percent: Math.max(0, Math.min(100, percent)),
      maxRp: Math.max(0, Number(String(v_maxRp.value || "0").trim() || "0")),
    };

    const mu = String(v_maxUses.value || "").trim();
    if (mu !== "") {
      const n = Number(mu);
      if (Number.isFinite(n) && n > 0) payload.maxUses = n;
    } else payload.maxUses = null;

    const expRaw = String(v_expiresAt.value || "").trim();
    if (expRaw) {
      const d = new Date(expRaw);
      if (Number.isFinite(d.getTime())) payload.expiresAt = d.toISOString();
    } else payload.expiresAt = null;

    return payload;
  }

  // ====== ACTIONS ======
  async function refreshAll() {
    setMsg(loginMsg, "");
    setMsg(msgVoucher, "");
    setMsg(msgMonthly, "");
    setMsg(msgUnlimited, "");

    await pingPublic();
    await loadVouchers();
    await loadMonthly();
    renderVoucherTable();
    lastSync.textContent = nowText();
  }

  async function doLogin() {
    const key = String(adminKeyInput.value || "").trim();
    if (!key) {
      setMsg(loginMsg, "Admin Key kosong.", true);
      return;
    }

    ADMIN = key;
    localStorage.setItem(LS_ADMIN, ADMIN);

    try {
      await pingPublic();
      const ok = await validateKey();
      if (!ok) {
        setMsg(loginMsg, "Unauthorized (401). Admin key salah.", true);
        return;
      }

      setLocked(false);
      setMsg(loginMsg, "");
      await refreshAll();
    } catch (e) {
      setMsg(loginMsg, `Login gagal: ${e?.message || e}`, true);
    }
  }

  function doLogout() {
    if (!confirm("Logout admin?")) return;
    ADMIN = "";
    localStorage.removeItem(LS_ADMIN);
    adminKeyInput.value = "";
    setLocked(true);
    setMsg(loginMsg, "Logout ✅");
  }

  async function upsertVoucher() {
    try {
      const body = buildVoucherPayload();
      curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);

      const r = await callAction("voucher.upsert", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgVoucher, "Voucher disimpan ✅");
      await loadVouchers();
      renderVoucherTable();
    } catch (e) {
      setMsg(msgVoucher, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function disableVoucher() {
    try {
      const code = sanitizeCode(v_code.value);
      if (!code) throw new Error("Code kosong");
      if (!confirm(`Disable voucher ${code}?`)) return;

      const body = { code };
      curlVoucher.textContent = curlFor("voucher.disable", "POST", body);

      const r = await callAction("voucher.disable", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgVoucher, "Voucher disabled ✅");
      await loadVouchers();
      renderVoucherTable();
    } catch (e) {
      setMsg(msgVoucher, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveMonthly() {
    try {
      const body = {
        enabled: !!m_enabled.checked,
        code: sanitizeCode(m_code.value),
        name: String(m_name.value || "").trim(),
        percent: Number(String(m_percent.value || "0").trim()),
        maxRp: Number(String(m_maxRp.value || "0").trim()),
      };

      const mu = String(m_maxUses.value || "").trim();
      if (mu !== "") {
        const n = Number(mu);
        if (Number.isFinite(n) && n > 0) body.maxUses = n;
      } else body.maxUses = null;

      curlMonthly.textContent = curlFor("monthly.set", "POST", body);

      const r = await callAction("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgMonthly, "Monthly updated ✅");
      await loadMonthly();
    } catch (e) {
      setMsg(msgMonthly, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function genDeviceKeyServer() {
    try {
      const deviceId = String(dev_id.value || "").trim();
      if (!deviceId) throw new Error("Device ID kosong");

      const body = { deviceId };
      const r = await callAction("devicekey", { method: "POST", body });
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      const dk = r.json?.data?.deviceKey || "";
      dev_key.value = dk;
      setMsg(msgUnlimited, "deviceKey generated ✅");
      return dk;
    } catch (e) {
      dev_key.value = "";
      setMsg(msgUnlimited, `Gagal generate: ${e?.message || e}`, true);
      return "";
    }
  }

  async function addUnlimited() {
    try {
      const deviceId = String(dev_id.value || "").trim();
      if (!deviceId) throw new Error("Device ID kosong");

      const body = { addUnlimitedDeviceId: deviceId };
      curlMonthly.textContent = curlFor("monthly.set", "POST", body);

      const r = await callAction("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      await loadMonthly();
      await genDeviceKeyServer();
      setMsg(msgUnlimited, "Added unlimited ✅");
    } catch (e) {
      setMsg(msgUnlimited, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function removeUnlimited() {
    try {
      const deviceId = String(dev_id.value || "").trim();
      if (!deviceId) throw new Error("Device ID kosong");

      const body = { removeUnlimitedDeviceId: deviceId };
      curlMonthly.textContent = curlFor("monthly.set", "POST", body);

      const r = await callAction("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      await loadMonthly();
      await genDeviceKeyServer();
      setMsg(msgUnlimited, "Removed ✅");
    } catch (e) {
      setMsg(msgUnlimited, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function runApply() {
    try {
      const body = {
        amount: Number(String(t_amount.value || "0").trim()),
        deviceId: String(t_deviceId.value || "").trim(),
        code: String(t_code.value || "").trim(),
        reserveTtlMs: Number(String(t_ttl.value || "360000").trim()),
      };

      curlApply.textContent = curlFor("discount.apply", "POST", body);

      const r = await callAction("discount.apply", { method: "POST", body });
      jsonApply.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);

      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);
    } catch (e) {
      jsonApply.textContent = JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2);
    }
  }

  // ====== EVENTS ======
  navItems.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  btnOpenGate.addEventListener("click", () => setLocked(true));
  btnRefreshAll.addEventListener("click", async () => {
    try {
      await refreshAll();
    } catch (e) {
      setMsg(loginMsg, `Refresh error: ${e?.message || e}`, true);
      setLocked(true);
    }
  });

  btnLogin.addEventListener("click", doLogin);
  btnLogout.addEventListener("click", doLogout);

  btnLoadVouchers.addEventListener("click", async () => {
    try {
      await loadVouchers();
      renderVoucherTable();
      lastSync.textContent = nowText();
    } catch (e) {
      setMsg(msgVoucher, `Load error: ${e?.message || e}`, true);
    }
  });

  onlyActiveToggle.addEventListener("change", renderVoucherTable);

  btnUpsertVoucher.addEventListener("click", upsertVoucher);
  btnDisableVoucher.addEventListener("click", disableVoucher);

  btnLoadMonthly.addEventListener("click", async () => {
    try {
      await loadMonthly();
      lastSync.textContent = nowText();
    } catch (e) {
      setMsg(msgMonthly, `Load error: ${e?.message || e}`, true);
    }
  });

  btnSaveMonthly.addEventListener("click", saveMonthly);

  btnGenKey.addEventListener("click", genDeviceKeyServer);
  btnAddUnlimited.addEventListener("click", addUnlimited);
  btnRemoveUnlimited.addEventListener("click", removeUnlimited);

  btnRunApply.addEventListener("click", runApply);

  // ====== INIT ======
  async function init() {
    API_BASE = normalizeApiBase(API_BASE);
    apiBaseText.textContent = API_BASE;

    dev_id.value = PRESET_DEVICE_ID || dev_id.value;
    t_deviceId.value = PRESET_DEVICE_ID || t_deviceId.value;

    setTab("vouchers");

    ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();
    if (!ADMIN) {
      setLocked(true);
      return;
    }

    try {
      await pingPublic();
      const ok = await validateKey();
      if (!ok) {
        setLocked(true);
        return;
      }
      setLocked(false);
      await refreshAll();
      await genDeviceKeyServer();
    } catch {
      setLocked(true);
    }
  }

  init();
})();