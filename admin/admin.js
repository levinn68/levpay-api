// admin/admin.js — FINAL
(() => {
  const $ = (id) => document.getElementById(id);

  const LS_ADMIN = "lp_admin_key_v4";
  const LS_API_BASE = "lp_admin_api_base_v4";

  // UI
  const gate = $("gate");
  const app = $("app");

  const adminKeyInput = $("adminKeyInput");
  const apiBaseInput = $("apiBaseInput");
  const btnLogin = $("btnLogin");
  const btnClear = $("btnClear");
  const loginMsg = $("loginMsg");

  const btnRefresh = $("btnRefresh");
  const btnLogout = $("btnLogout");
  const apiBaseText = $("apiBaseText");
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");

  const navBtns = Array.from(document.querySelectorAll(".nav"));
  const tabVoucher = $("tab-voucher");
  const tabMonthly = $("tab-monthly");
  const tabFlags = $("tab-flags");

  // voucher
  const chipVoucher = $("chipVoucher");
  const onlyActive = $("onlyActive");
  const btnLoadVouchers = $("btnLoadVouchers");
  const voucherTbody = $("voucherTbody");

  const v_code = $("v_code");
  const v_name = $("v_name");
  const v_percent = $("v_percent");
  const v_maxRp = $("v_maxRp");
  const v_maxUses = $("v_maxUses");
  const v_expiresAt = $("v_expiresAt");
  const v_enabled = $("v_enabled");
  const btnUpsert = $("btnUpsert");
  const btnDisable = $("btnDisable");
  const btnDelete = $("btnDelete");
  const msgVoucher = $("msgVoucher");
  const curlVoucher = $("curlVoucher");
  const jsonVoucher = $("jsonVoucher");

  // monthly
  const chipMonthly = $("chipMonthly");
  const btnLoadMonthly = $("btnLoadMonthly");
  const btnSaveMonthly = $("btnSaveMonthly");
  const m_enabled = $("m_enabled");
  const m_code = $("m_code");
  const m_name = $("m_name");
  const m_percent = $("m_percent");
  const m_maxRp = $("m_maxRp");
  const m_maxUses = $("m_maxUses");
  const m_requireCode = $("m_requireCode");
  const msgMonthly = $("msgMonthly");
  const curlMonthly = $("curlMonthly");
  const jsonMonthly = $("jsonMonthly");

  // flags
  const btnLoadFlags = $("btnLoadFlags");
  const btnSaveFlags = $("btnSaveFlags");
  const f_monthlyUnlim = $("f_monthlyUnlim");
  const f_voucherUnlim = $("f_voucherUnlim");
  const msgFlags = $("msgFlags");
  const curlFlags = $("curlFlags");
  const jsonFlags = $("jsonFlags");

  // ===== STATE =====
  let ADMIN = "";
  let vouchers = [];

  // DEFAULT API BASE: ROOT absolute path, jadi gak bakal nyangkut ke /admin/admin.html
  const API_BASE_DEFAULT = "/api/levpay";
  let API_BASE = localStorage.getItem(LS_API_BASE) || API_BASE_DEFAULT;

  // ===== UTILS =====
  const nowText = () => new Date().toLocaleString("id-ID");

  function setTab(name) {
    navBtns.forEach((b) => b.classList.toggle("is-on", b.dataset.tab === name));
    tabVoucher.classList.toggle("is-on", name === "voucher");
    tabMonthly.classList.toggle("is-on", name === "monthly");
    tabFlags.classList.toggle("is-on", name === "flags");
  }

  function setLocked(locked) {
    sysStatus.textContent = locked ? "LOCKED" : "ACTIVE";
    app.classList.toggle("locked", !!locked);
    gate.style.display = locked ? "grid" : "none";
    gate.setAttribute("aria-hidden", locked ? "false" : "true");
  }

  function setMsg(el, text, warn = false) {
    el.textContent = text || "";
    el.classList.toggle("msg--warn", !!warn);
    el.classList.toggle("msg--ok", !!text && !warn);
    el.style.display = text ? "block" : "none";
  }

  function sanitizeCode(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function endpoint(action) {
    // BASE bisa "/api/levpay" atau full "https://domain/api/levpay"
    const u = new URL(API_BASE, window.location.href);
    u.searchParams.set("action", action);
    return u.toString();
  }

  function curlFor(action, method, body) {
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const basePath = new URL(endpoint("ping")).pathname; // /api/levpay
    const heads = [`-H "X-Admin-Key: ${ADMINVAR}"`];
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = ` \\\n  ${heads.join(" \\\n  ")}`;
    const data = method === "GET" ? "" : ` \\\n  -d '${JSON.stringify(body || {})}'`;
    return `curl -sS -X ${method} "${HOSTVAR}${basePath}?action=${action}"${h}${data} | jq`;
  }

  async function jfetch(url, opts) {
    const r = await fetch(url, {
      ...opts,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    const txt = await r.text().catch(() => "");
    let json = {};
    try {
      json = txt ? JSON.parse(txt) : {};
    } catch {
      json = { raw: txt };
    }
    return { ok: r.ok, status: r.status, json };
  }

  async function callAction(action, { method = "GET", body = null } = {}) {
    const headers = { "X-Admin-Key": ADMIN };
    if (method !== "GET") headers["Content-Type"] = "application/json";
    return jfetch(endpoint(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

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

  // ===== LOADERS =====
  async function ping() {
    const r = await jfetch(endpoint("ping"), { method: "GET" });
    if (!r.ok) throw new Error(`Ping error (${r.status})`);
    return r.json;
  }

  async function validateKey() {
    const r = await callAction("voucher.list", { method: "GET" });
    return r.ok;
  }

  async function loadVouchers() {
    const r = await callAction("voucher.list", { method: "GET" });
    if (!r.ok) throw new Error(r.json?.error || `voucher.list ${r.status}`);
    const list = Array.isArray(r.json?.data) ? r.json.data : [];
    vouchers = list.map((v) => ({
      code: sanitizeCode(v.code),
      name: String(v.name || ""),
      enabled: v.enabled !== false,
      percent: Number(v.percent || 0),
      maxRp: Number(v.maxRp || 0),
      maxUses: v.maxUses == null ? null : Number(v.maxUses),
      uses: Number(v.uses || 0),
      expiresAt: v.expiresAt || null,
      updatedAt: v.updatedAt || null,
    }));
    chipVoucher.textContent = String(vouchers.filter((v) => v.enabled).length);
    renderVoucherTable();
    return vouchers;
  }

  async function loadMonthly() {
    const r = await callAction("monthly.get", { method: "GET" });
    if (!r.ok) throw new Error(r.json?.error || `monthly.get ${r.status}`);
    const m = r.json?.data || {};
    chipMonthly.textContent = m.enabled ? "ON" : "OFF";

    m_enabled.checked = !!m.enabled;
    m_code.value = String(m.code || "");
    m_name.value = String(m.name || "");
    m_percent.value = String(Number(m.percent || 0));
    m_maxRp.value = String(Number(m.maxRp || 0));
    m_maxUses.value = m.maxUses == null ? "" : String(Number(m.maxUses));
    m_requireCode.checked = !!m.requireCode;

    jsonMonthly.textContent = JSON.stringify(m, null, 2);
    curlMonthly.textContent = curlFor("monthly.set", "POST", {
      enabled: !!m_enabled.checked,
      name: String(m_name.value || "").trim(),
      percent: Number(m_percent.value || 0),
      maxRp: Number(m_maxRp.value || 0),
      maxUses: m_maxUses.value === "" ? null : Number(m_maxUses.value),
      requireCode: !!m_requireCode.checked,
      code: sanitizeCode(m_code.value),
    });

    return m;
  }

  async function loadFlags() {
    const r = await callAction("flags.get", { method: "GET" });
    if (!r.ok) throw new Error(r.json?.error || `flags.get ${r.status}`);
    const f = r.json?.data || {};
    f_monthlyUnlim.checked = !!f.monthlyUnlimitedEnabled;
    f_voucherUnlim.checked = !!f.voucherUnlimitedEnabled;

    jsonFlags.textContent = JSON.stringify(f, null, 2);
    curlFlags.textContent = curlFor("flags.set", "POST", {
      monthlyUnlimitedEnabled: !!f_monthlyUnlim.checked,
      voucherUnlimitedEnabled: !!f_voucherUnlim.checked,
    });
    return f;
  }

  // ===== RENDER =====
  function renderVoucherTable() {
    const only = !!onlyActive.checked;
    const list = only ? vouchers.filter((v) => v.enabled) : vouchers.slice();

    if (!list.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="muted">Belum ada data.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = list
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((v) => {
        const on = v.enabled ? `<span class="badge on">ON</span>` : `<span class="badge off">OFF</span>`;
        return `
          <tr>
            <td class="mono">${v.code}</td>
            <td>${(v.name || v.code)}</td>
            <td>${on}</td>
            <td class="mono">${v.percent}%</td>
            <td class="mono">${fmtRp(v.maxRp)}</td>
            <td class="mono">${fmtUsesPair(v.uses, v.maxUses)}</td>
            <td class="mono">${v.expiresAt ? fmtDate(v.expiresAt) : "—"}</td>
            <td class="tr">
              <button class="btn btn--ghost btn--mini" data-pick="${v.code}">Edit</button>
            </td>
          </tr>
        `;
      })
      .join("");

    voucherTbody.querySelectorAll("button[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-pick");
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
            v_expiresAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
              d.getHours()
            )}:${pad(d.getMinutes())}`;
          } else v_expiresAt.value = "";
        } else v_expiresAt.value = "";

        previewVoucherCurl();
        setMsg(msgVoucher, "");
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
    payload.maxUses = mu === "" ? null : Number(mu);

    const expRaw = String(v_expiresAt.value || "").trim();
    if (expRaw) {
      const d = new Date(expRaw);
      payload.expiresAt = Number.isFinite(d.getTime()) ? d.toISOString() : null;
    } else payload.expiresAt = null;

    return payload;
  }

  function previewVoucherCurl() {
    try {
      const body = buildVoucherPayload();
      curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);
    } catch {}
  }

  // ===== ACTIONS =====
  async function refreshAll() {
    apiBaseText.textContent = API_BASE;
    await ping();
    await loadVouchers();
    await loadMonthly();
    await loadFlags();
    lastSync.textContent = nowText();
  }

  async function doLogin() {
    setMsg(loginMsg, "");
    const key = String(adminKeyInput.value || "").trim();
    if (!key) return setMsg(loginMsg, "Admin Key kosong.", true);

    ADMIN = key;

    // save api base
    API_BASE = String(apiBaseInput.value || "").trim() || API_BASE_DEFAULT;
    localStorage.setItem(LS_API_BASE, API_BASE);

    apiBaseText.textContent = API_BASE;

    try {
      await ping();
      const ok = await validateKey();
      if (!ok) return setMsg(loginMsg, "Unauthorized (401). Admin key salah.", true);

      localStorage.setItem(LS_ADMIN, ADMIN);
      setLocked(false);
      await refreshAll();
    } catch (e) {
      setMsg(loginMsg, `Login gagal: ${e?.message || e}`, true);
    }
  }

  function doLogout() {
    if (!confirm("Logout admin?")) return;
    ADMIN = "";
    localStorage.removeItem(LS_ADMIN);
    setLocked(true);
  }

  function doReset() {
    localStorage.removeItem(LS_ADMIN);
    localStorage.removeItem(LS_API_BASE);
    adminKeyInput.value = "";
    apiBaseInput.value = API_BASE_DEFAULT;
    setMsg(loginMsg, "Reset ✅");
  }

  async function upsertVoucher() {
    try {
      const body = buildVoucherPayload();
      curlVoucher.textContent = curlFor("voucher.upsert", "POST", body);

      const r = await callAction("voucher.upsert", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgVoucher, "Saved ✅");
      await loadVouchers();
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

      setMsg(msgVoucher, "Disabled ✅");
      await loadVouchers();
    } catch (e) {
      setMsg(msgVoucher, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function deleteVoucher() {
    try {
      const code = sanitizeCode(v_code.value);
      if (!code) throw new Error("Code kosong");
      if (!confirm(`DELETE voucher ${code}? (irreversible)`)) return;

      const body = { code };
      curlVoucher.textContent = curlFor("voucher.delete", "POST", body);

      const r = await callAction("voucher.delete", { method: "POST", body });
      jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgVoucher, "Deleted ✅");
      v_code.value = "";
      v_name.value = "";
      v_percent.value = "";
      v_maxRp.value = "0";
      v_maxUses.value = "";
      v_expiresAt.value = "";
      v_enabled.checked = true;

      await loadVouchers();
    } catch (e) {
      setMsg(msgVoucher, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveMonthly() {
    try {
      const body = {
        enabled: !!m_enabled.checked,
        name: String(m_name.value || "").trim(),
        percent: Number(String(m_percent.value || "0").trim()),
        maxRp: Number(String(m_maxRp.value || "0").trim()),
        maxUses: m_maxUses.value === "" ? null : Number(String(m_maxUses.value || "").trim()),
        requireCode: !!m_requireCode.checked,
        code: sanitizeCode(m_code.value),
      };

      curlMonthly.textContent = curlFor("monthly.set", "POST", body);

      const r = await callAction("monthly.set", { method: "POST", body });
      jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgMonthly, "Updated ✅");
      await loadMonthly();
    } catch (e) {
      setMsg(msgMonthly, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveFlags() {
    try {
      const body = {
        monthlyUnlimitedEnabled: !!f_monthlyUnlim.checked,
        voucherUnlimitedEnabled: !!f_voucherUnlim.checked,
      };

      curlFlags.textContent = curlFor("flags.set", "POST", body);

      const r = await callAction("flags.set", { method: "POST", body });
      jsonFlags.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(msgFlags, "Saved ✅");
      await loadFlags();
    } catch (e) {
      setMsg(msgFlags, `Gagal: ${e?.message || e}`, true);
    }
  }

  // ===== EVENTS =====
  navBtns.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  btnLogin.addEventListener("click", doLogin);
  btnClear.addEventListener("click", doReset);

  btnLogout.addEventListener("click", doLogout);
  btnRefresh.addEventListener("click", async () => {
    try {
      await refreshAll();
    } catch (e) {
      alert(`Refresh error: ${e?.message || e}`);
      setLocked(true);
    }
  });

  btnLoadVouchers.addEventListener("click", loadVouchers);
  onlyActive.addEventListener("change", renderVoucherTable);

  btnUpsert.addEventListener("click", upsertVoucher);
  btnDisable.addEventListener("click", disableVoucher);
  btnDelete.addEventListener("click", deleteVoucher);

  [v_code, v_name, v_percent, v_maxRp, v_maxUses, v_expiresAt].forEach((el) =>
    el.addEventListener("input", previewVoucherCurl)
  );
  v_enabled.addEventListener("change", previewVoucherCurl);

  btnLoadMonthly.addEventListener("click", loadMonthly);
  btnSaveMonthly.addEventListener("click", saveMonthly);

  btnLoadFlags.addEventListener("click", loadFlags);
  btnSaveFlags.addEventListener("click", saveFlags);

  // ===== INIT =====
  async function init() {
    API_BASE = localStorage.getItem(LS_API_BASE) || API_BASE_DEFAULT;
    apiBaseInput.value = API_BASE;

    ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();
    if (!ADMIN) {
      setLocked(true);
      return;
    }

    setLocked(false);
    apiBaseText.textContent = API_BASE;
    adminKeyInput.value = ADMIN;

    try {
      await ping();
      const ok = await validateKey();
      if (!ok) {
        setLocked(true);
        return;
      }
      await refreshAll();
    } catch {
      setLocked(true);
    }
  }

  init();
})();