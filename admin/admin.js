// admin/admin.js — FINAL (NO location.origin)
// - API base pakai window.LevPayAPIBase (default https://levpay-api.vercel.app)
// - Login gate wajib
(() => {
  const $ = (id) => document.getElementById(id);

  // ===== CONFIG =====
  const LS_ADMIN = "levpay_admin_key_final";
  const API_HOST = String(window.LevPayAPIBase || "https://levpay-api.vercel.app").replace(/\/+$/, "");
  const API_BASE = `${API_HOST}/api/levpay`;

  // ===== ELEMENTS =====
  const gate = $("gate");
  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const loginMsg = $("loginMsg");
  const apiBaseText = $("apiBaseText");
  const apiBaseHint = $("apiBaseHint");

  const app = $("app");
  const btnRefreshAll = $("btnRefreshAll");
  const btnOpenGate = $("btnOpenGate");
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");

  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const tabVouchers = $("tab-vouchers");
  const tabMonthly = $("tab-monthly");
  const tabSystem = $("tab-system");
  const tabTools = $("tab-tools");

  // pills
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
  const v_perDeviceMonth = $("v_perDeviceMonth");
  const btnUpsertVoucher = $("btnUpsertVoucher");
  const btnDeleteVoucher = $("btnDeleteVoucher");
  const curlVoucher = $("curlVoucher");
  const jsonVoucher = $("jsonVoucher");
  const msgVoucher = $("msgVoucher");

  // monthly tab
  const btnLoadMonthly = $("btnLoadMonthly");
  const btnSaveMonthly = $("btnSaveMonthly");
  const btnResetMonthly = $("btnResetMonthly");
  const m_enabled = $("m_enabled");
  const m_code = $("m_code");
  const m_name = $("m_name");
  const m_percent = $("m_percent");
  const m_maxRp = $("m_maxRp");
  const curlMonthly = $("curlMonthly");
  const jsonMonthly = $("jsonMonthly");
  const msgMonthly = $("msgMonthly");

  // system tab
  const btnLoadSystem = $("btnLoadSystem");
  const btnSaveSystem = $("btnSaveSystem");
  const s_unlimitedEnabled = $("s_unlimitedEnabled");
  const s_keyCount = $("s_keyCount");
  const jsonSystem = $("jsonSystem");
  const msgSystem = $("msgSystem");

  // tools tab
  const btnRunApply = $("btnRunApply");
  const t_amount = $("t_amount");
  const t_deviceId = $("t_deviceId");
  const t_code = $("t_code");
  const curlApply = $("curlApply");
  const jsonApply = $("jsonApply");

  // ===== STATE =====
  let ADMIN = "";
  let vouchers = [];
  let monthly = null;
  let system = null;

  // ===== UTILS =====
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const nowText = () => new Date().toLocaleString("id-ID");
  const sanitizeCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");

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
    tabSystem.classList.toggle("is-on", name === "system");
    tabTools.classList.toggle("is-on", name === "tools");
  }

  function endpoint(action) {
    const u = new URL(API_BASE);
    u.searchParams.set("action", action);
    return u.toString();
  }

  function isAdminAction(action) {
    return /^(voucher\.|monthly\.|system\.)/.test(action);
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
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    if (isAdminAction(action)) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? ` \\\n  ${heads.join(" \\\n  ")}` : "";
    const data = method === "GET" || body == null ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    const basePath = new URL(API_BASE).pathname;
    return `curl -sS -X ${method} "${HOSTVAR}${basePath}?action=${action}"${h}${data} | jq`;
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

  // ===== LOADERS =====
  async function pingPublic() {
    apiBaseText.textContent = API_BASE;
    apiBaseHint.textContent = API_BASE;
    const r = await callAction("ping", { method: "GET" });
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
        perDeviceMonth: v.perDeviceMonth !== false,
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
    return monthly;
  }

  async function loadSystem() {
    const r = await callAction("system.get", { method: "GET" });
    if (!r.ok) throw new Error(`system.get error (${r.status})`);
    system = r.json?.data ?? r.json ?? null;
    if (!system || typeof system !== "object") throw new Error("system invalid");

    s_unlimitedEnabled.checked = !!system.unlimitedEnabled;
    s_keyCount.textContent = String(system.unlimitedKeysCount || 0);
    jsonSystem.textContent = JSON.stringify(system, null, 2);
    return system;
  }

  // ===== RENDER =====
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("id-ID");
  }

  function fmtRp(n) {
    const x = Number(n || 0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  }

  function fmtUsesPair(used, max) {
    const u = Number(used || 0);
    if (max == null) return `${u} / ∞`;
    const m = Number(max);
    if (!Number.isFinite(m) || m <= 0) return `${u} / ∞`;
    return `${u} / ${m}`;
  }

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
        const active = v.enabled
          ? `<span class="badge on">ON</span>`
          : `<span class="badge off">OFF</span>`;
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
        v_perDeviceMonth.checked = !!v.perDeviceMonth;

        if (v.expiresAt) {
          const d = new Date(v.expiresAt);
          if (Number.isFinite(d.getTime())) {
            const pad = (n) => String(n).padStart(2, "0");
            v_expiresAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
              d.getHours()
            )}:${pad(d.getMinutes())}`;
          } else v_expiresAt.value = "";
        } else v_expiresAt.value = "";

        try {
          curlVoucher.textContent = curlForVoucherUpsert();
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
      perDeviceMonth: !!v_perDeviceMonth.checked,
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

  function curlForVoucherUpsert() {
    const body = buildVoucherPayload();
    return curlFor("voucher.upsert", "POST", body);
  }

  // ===== ACTIONS =====
  async function refreshAll() {
    setMsg(loginMsg, "");
    setMsg(msgVoucher, "");
    setMsg(msgMonthly, "");
    setMsg(msgSystem, "");

    await pingPublic();
    await loadVouchers();
    await loadMonthly();
    await loadSystem();

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

  async function deleteVoucher() {
    try {
      const code = sanitizeCode(v_code.value);
      if (!code) throw new Error("Code kosong");
      if (!confirm(`Hapus voucher ${code}? (nggak bisa dibalikin)`)) return;

      const body = { code };
      curlVoucher.textContent = curlFor("voucher.delete", "POST", body);

      const r = await callAction("voucher.delete", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgVoucher, "Voucher dihapus ✅");
      // clear form
      v_code.value = "";
      v_name.value = "";
      v_percent.value = "";
      v_maxRp.value = "0";
      v_maxUses.value = "";
      v_expiresAt.value = "";
      v_enabled.checked = true;
      v_perDeviceMonth.checked = true;

      await loadVouchers();
      renderVoucherTable();
    } catch (e) {
      setMsg(msgVoucher, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveMonthly(resetUsage = false) {
    try {
      const body = {
        enabled: !!m_enabled.checked,
        code: sanitizeCode(m_code.value),
        name: String(m_name.value || "").trim(),
        percent: Number(String(m_percent.value || "0").trim()),
        maxRp: Number(String(m_maxRp.value || "0").trim()),
      };
      if (resetUsage) body.resetUsage = true;

      curlMonthly.textContent = curlFor("monthly.set", "POST", body);

      const r = await callAction("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgMonthly, resetUsage ? "Monthly reset ✅" : "Monthly updated ✅");
      await loadMonthly();
    } catch (e) {
      setMsg(msgMonthly, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveSystem() {
    try {
      const body = { unlimitedEnabled: !!s_unlimitedEnabled.checked };
      const r = await callAction("system.set", { method: "POST", body });
      jsonSystem.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);
      setMsg(msgSystem, "System updated ✅");
      await loadSystem();
    } catch (e) {
      setMsg(msgSystem, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function runApply() {
    try {
      const body = {
        amount: Number(String(t_amount.value || "0").trim()),
        deviceId: String(t_deviceId.value || "").trim(),
        code: String(t_code.value || "").trim(),
      };
      curlApply.textContent = curlFor("discount.apply", "POST", body);

      const r = await callAction("discount.apply", { method: "POST", body });
      jsonApply.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);
    } catch (e) {
      jsonApply.textContent = JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2);
    }
  }

  // ===== EVENTS =====
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

  // enter to login
  adminKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

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
  btnDeleteVoucher.addEventListener("click", deleteVoucher);

  btnLoadMonthly.addEventListener("click", async () => {
    try {
      await loadMonthly();
      lastSync.textContent = nowText();
    } catch (e) {
      setMsg(msgMonthly, `Load error: ${e?.message || e}`, true);
    }
  });

  btnSaveMonthly.addEventListener("click", () => saveMonthly(false));
  btnResetMonthly.addEventListener("click", () => {
    if (confirm("Reset usage promo bulanan?")) saveMonthly(true);
  });

  btnLoadSystem.addEventListener("click", async () => {
    try {
      await loadSystem();
      lastSync.textContent = nowText();
    } catch (e) {
      setMsg(msgSystem, `Load error: ${e?.message || e}`, true);
    }
  });

  btnSaveSystem.addEventListener("click", saveSystem);

  btnRunApply.addEventListener("click", runApply);

  // live curl previews
  [v_code, v_name, v_percent, v_maxRp, v_maxUses, v_expiresAt].forEach((el) => {
    el.addEventListener("input", () => {
      try {
        curlVoucher.textContent = curlForVoucherUpsert();
      } catch {}
    });
  });
  [v_enabled, v_perDeviceMonth].forEach((el) => {
    el.addEventListener("change", () => {
      try {
        curlVoucher.textContent = curlForVoucherUpsert();
      } catch {}
    });
  });

  [m_enabled, m_code, m_name, m_percent, m_maxRp].forEach((el) => {
    el.addEventListener("input", () => {
      const body = {
        enabled: !!m_enabled.checked,
        code: sanitizeCode(m_code.value),
        name: String(m_name.value || "").trim(),
        percent: Number(String(m_percent.value || "0").trim()),
        maxRp: Number(String(m_maxRp.value || "0").trim()),
      };
      curlMonthly.textContent = curlFor("monthly.set", "POST", body);
    });
  });

  [t_amount, t_deviceId, t_code].forEach((el) => {
    el.addEventListener("input", () => {
      const body = {
        amount: Number(String(t_amount.value || "0").trim()),
        deviceId: String(t_deviceId.value || "").trim(),
        code: String(t_code.value || "").trim(),
      };
      curlApply.textContent = curlFor("discount.apply", "POST", body);
    });
  });

  // ===== INIT =====
  async function init() {
    apiBaseText.textContent = API_BASE;
    apiBaseHint.textContent = API_BASE;

    // default curls
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", {
      code: "VIPL",
      enabled: true,
      perDeviceMonth: true,
      name: "VIP LEVEL",
      percent: 10,
      maxRp: 0,
      maxUses: null,
      expiresAt: null,
    });

    curlMonthly.textContent = curlFor("monthly.set", "POST", {
      enabled: true,
      code: "KLZ",
      name: "PROMO BULANAN",
      percent: 5,
      maxRp: 2000,
    });

    curlApply.textContent = curlFor("discount.apply", "POST", {
      amount: 3000,
      deviceId: "dev_rog6pro",
      code: "KLZ",
    });

    setTab("vouchers");

    ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();
    if (!ADMIN) {
      setLocked(true);
      return;
    }

    adminKeyInput.value = ADMIN;

    try {
      await pingPublic();
      const ok = await validateKey();
      if (!ok) {
        setLocked(true);
        return;
      }
      setLocked(false);
      await refreshAll();
    } catch {
      setLocked(true);
    }
  }

  init();
})();