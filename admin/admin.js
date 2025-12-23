// /admin/admin.js — FINAL (Premium UI, toggles real, no sha/device fields)
// Admin page path: /admin/admin.html
// API default: /api/levpay (ABSOLUTE, so ga bakal jadi admin.html/api/levpay)

(() => {
  const $ = (s) => document.querySelector(s);

  // ====== CONFIG ======
  const LS_ADMIN = "levpay_admin_key_v4";
  const LS_API = "levpay_admin_api_v4";

  // ✅ ABSOLUTE URL (anti "admin.html/api/levpay")
  const DEFAULT_API = new URL("/api/levpay", location.origin).toString();

  // Optional override via global:
  // window.LevPayAdminAPI = "https://levpay-api.vercel.app/api/levpay"
  const API = String(window.LevPayAdminAPI || localStorage.getItem(LS_API) || DEFAULT_API).trim();

  // ====== ELEMENTS ======
  const gate = $("#gate");
  const gateInput = $("#adminKeyInput");
  const gateBtn = $("#btnLogin");
  const gateMsg = $("#gateMsg");

  const topApiText = $("#apiText");
  const btnLogout = $("#btnLogout");
  const btnRefresh = $("#btnRefresh");

  const navVouchers = $("#navVouchers");
  const navMonthly = $("#navMonthly");
  const navTools = $("#navTools");

  const tabVouchers = $("#tabVouchers");
  const tabMonthly = $("#tabMonthly");
  const tabTools = $("#tabTools");

  // vouchers
  const voucherTbody = $("#voucherTbody");
  const vForm = {
    code: $("#v_code"),
    name: $("#v_name"),
    enabled: $("#v_enabled"),
    percent: $("#v_percent"),
    maxRp: $("#v_maxRp"),
    maxUses: $("#v_maxUses"),
    expiresAt: $("#v_expiresAt"),
    btnSave: $("#btnVoucherSave"),
    btnDisable: $("#btnVoucherDisable"),
    msg: $("#voucherMsg"),
    curl: $("#curlVoucher"),
    json: $("#jsonVoucher"),
  };

  // monthly
  const mForm = {
    enabled: $("#m_enabled"),
    unlimitedEnabled: $("#m_unlimitedEnabled"),
    code: $("#m_code"),
    name: $("#m_name"),
    percent: $("#m_percent"),
    maxRp: $("#m_maxRp"),
    maxUses: $("#m_maxUses"),
    count: $("#m_unlimitedCount"),
    updatedAt: $("#m_updatedAt"),
    btnSave: $("#btnMonthlySave"),
    msg: $("#monthlyMsg"),
    curl: $("#curlMonthly"),
    json: $("#jsonMonthly"),
  };

  // tools (discount.apply tester)
  const tForm = {
    amount: $("#t_amount"),
    deviceId: $("#t_deviceId"),
    code: $("#t_code"),
    ttl: $("#t_ttl"),
    btnRun: $("#btnRunApply"),
    curl: $("#curlApply"),
    json: $("#jsonApply"),
  };

  // ====== STATE ======
  let ADMIN = String(localStorage.getItem(LS_ADMIN) || "").trim();
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

  function setTab(name) {
    navVouchers.classList.toggle("is-active", name === "vouchers");
    navMonthly.classList.toggle("is-active", name === "monthly");
    navTools.classList.toggle("is-active", name === "tools");

    tabVouchers.classList.toggle("is-on", name === "vouchers");
    tabMonthly.classList.toggle("is-on", name === "monthly");
    tabTools.classList.toggle("is-on", name === "tools");
  }

  function setGate(on) {
    gate.classList.toggle("is-on", !!on);
    document.body.classList.toggle("locked", !!on);
    if (on) setTimeout(() => gateInput?.focus?.(), 0);
  }

  function setMsg(el, txt, warn = false) {
    el.textContent = txt || "";
    el.classList.toggle("warn", !!warn);
    el.classList.toggle("ok", !!txt && !warn);
    el.style.display = txt ? "block" : "none";
  }

  function sanitizeCode(s) {
    return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function hdrs(extra = {}) {
    const h = { ...extra };
    if (ADMIN) h["X-Admin-Key"] = ADMIN;
    return h;
  }

  async function jfetch(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { ok: r.ok, status: r.status, json };
  }

  function endpoint(action) {
    const u = new URL(API);
    u.searchParams.set("action", action);
    return u.toString();
  }

  function curlFor(action, method, body) {
    const hostVar = "$HOST";
    const adminVar = "$ADMIN";
    const basePath = new URL(API).pathname;

    const heads = [];
    if (action.startsWith("voucher.") || action.startsWith("monthly.")) heads.push(`-H "X-Admin-Key: ${adminVar}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);

    const h = heads.length ? ` \\\n  ${heads.join(" \\\n  ")}` : "";
    const data = method === "GET" ? "" : ` \\\n  -d '${JSON.stringify(body || {})}'`;

    return `curl -sS -X ${method} "${hostVar}${basePath}?action=${action}"${h}${data} | jq`;
  }

  // ====== API calls ======
  async function ping() {
    topApiText.textContent = API;
    const r = await jfetch(endpoint("ping"), { method: "GET" });
    if (!r.ok) throw new Error(r.json?.error || `ping error ${r.status}`);
    return r.json;
  }

  async function validateAdminKey() {
    const r = await jfetch(endpoint("voucher.list"), { method: "GET", headers: hdrs() });
    if (r.status === 401) return false;
    return r.ok;
  }

  async function loadVouchers() {
    const r = await jfetch(endpoint("voucher.list"), { method: "GET", headers: hdrs() });
    if (!r.ok) throw new Error(r.json?.error || `voucher.list ${r.status}`);

    const arr = Array.isArray(r.json?.data) ? r.json.data : [];
    vouchers = arr
      .map((v) => ({
        code: sanitizeCode(v.code),
        name: String(v.name || ""),
        enabled: v.enabled !== false,
        percent: Number(v.percent || 0),
        maxRp: Number(v.maxRp || 0),
        maxUses: v.maxUses == null ? null : Number(v.maxUses),
        uses: Number(v.uses || 0),
        expiresAt: v.expiresAt || null,
        updatedAt: v.updatedAt || null,
      }))
      .filter((v) => v.code);

    renderVoucherTable();
  }

  async function loadMonthly() {
    const r = await jfetch(endpoint("monthly.get"), { method: "GET", headers: hdrs() });
    if (!r.ok) throw new Error(r.json?.error || `monthly.get ${r.status}`);
    monthly = r.json?.data || null;

    // fill form
    mForm.enabled.checked = !!monthly.enabled;
    mForm.unlimitedEnabled.checked = !!monthly.unlimitedEnabled;

    mForm.code.value = String(monthly.code || "");
    mForm.name.value = String(monthly.name || "");
    mForm.percent.value = String(Number(monthly.percent || 0));
    mForm.maxRp.value = String(Number(monthly.maxRp || 0));
    mForm.maxUses.value = monthly.maxUses == null ? "" : String(Number(monthly.maxUses));
    mForm.count.textContent = String(Number(monthly.unlimitedCount || 0));
    mForm.updatedAt.textContent = monthly.updatedAt ? new Date(monthly.updatedAt).toLocaleString("id-ID") : "—";

    // preview curl
    monthlyCurlPreview();
  }

  // ===== UI render =====
  function renderVoucherTable() {
    if (!vouchers.length) {
      voucherTbody.innerHTML = `<tr><td colspan="7" class="muted">Belum ada voucher.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = vouchers
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((v) => {
        const exp = v.expiresAt ? new Date(v.expiresAt).toLocaleString("id-ID") : "—";
        const maxRp = v.maxRp ? v.maxRp.toLocaleString("id-ID") : "∞";
        const maxUses = v.maxUses == null ? "∞" : String(v.maxUses);
        return `
        <tr>
          <td class="mono">${esc(v.code)}</td>
          <td>${esc(v.name || v.code)}</td>
          <td>
            <label class="switch">
              <input type="checkbox" data-toggle="${esc(v.code)}" ${v.enabled ? "checked" : ""}/>
              <span class="track"></span>
            </label>
          </td>
          <td class="mono">${esc(String(v.percent))}%</td>
          <td class="mono">${esc(maxRp)}</td>
          <td class="mono">${esc(String(v.uses))} / ${esc(maxUses)}</td>
          <td class="mono">${esc(exp)}</td>
          <td class="right">
            <button class="btn ghost sm" data-edit="${esc(v.code)}">Edit</button>
          </td>
        </tr>
      `;
      })
      .join("");

    voucherTbody.querySelectorAll("button[data-edit]").forEach((b) => {
      b.addEventListener("click", () => pickVoucher(b.getAttribute("data-edit")));
    });

    voucherTbody.querySelectorAll("input[data-toggle]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const code = inp.getAttribute("data-toggle");
        if (!code) return;
        const enabled = !!inp.checked;
        try {
          const body = { code, enabled };
          const r = await jfetch(endpoint("voucher.disable"), {
            method: "POST",
            headers: hdrs({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);
          // update local
          const v = vouchers.find((x) => x.code === code);
          if (v) v.enabled = enabled;
          setMsg(vForm.msg, `Voucher ${code} => ${enabled ? "ON" : "OFF"} ✅`);
        } catch (e) {
          inp.checked = !enabled;
          setMsg(vForm.msg, `Gagal toggle: ${e?.message || e}`, true);
        }
      });
    });
  }

  function pickVoucher(code) {
    const v = vouchers.find((x) => x.code === code);
    if (!v) return;

    vForm.code.value = v.code;
    vForm.name.value = v.name || v.code;
    vForm.enabled.checked = !!v.enabled;
    vForm.percent.value = String(v.percent || 0);
    vForm.maxRp.value = String(v.maxRp || 0);
    vForm.maxUses.value = v.maxUses == null ? "" : String(v.maxUses);

    // datetime-local
    if (v.expiresAt) {
      const d = new Date(v.expiresAt);
      if (Number.isFinite(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        vForm.expiresAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
          d.getHours()
        )}:${pad(d.getMinutes())}`;
      }
    } else {
      vForm.expiresAt.value = "";
    }

    voucherCurlPreview();
    setTab("vouchers");
    vForm.code.focus();
  }

  function buildVoucherPayload() {
    const code = sanitizeCode(vForm.code.value);
    if (!code) throw new Error("Code wajib");

    const percent = Number(String(vForm.percent.value || "").trim());
    if (!Number.isFinite(percent)) throw new Error("Percent wajib angka");

    const payload = {
      code,
      enabled: !!vForm.enabled.checked,
      name: String(vForm.name.value || "").trim() || code,
      percent: clamp(percent, 0, 100),
      maxRp: Math.max(0, Number(String(vForm.maxRp.value || "0").trim() || "0")),
    };

    const mu = String(vForm.maxUses.value || "").trim();
    payload.maxUses = mu === "" ? null : Number(mu);

    const expRaw = String(vForm.expiresAt.value || "").trim();
    if (expRaw) {
      const d = new Date(expRaw);
      if (Number.isFinite(d.getTime())) payload.expiresAt = d.toISOString();
    } else {
      payload.expiresAt = null;
    }
    return payload;
  }

  function voucherCurlPreview() {
    try {
      const body = buildVoucherPayload();
      vForm.curl.textContent = curlFor("voucher.upsert", "POST", body);
    } catch {
      vForm.curl.textContent = "—";
    }
  }

  function monthlyCurlPreview() {
    const body = {
      enabled: !!mForm.enabled.checked,
      unlimitedEnabled: !!mForm.unlimitedEnabled.checked,
      code: sanitizeCode(mForm.code.value),
      name: String(mForm.name.value || "").trim(),
      percent: Number(String(mForm.percent.value || "0").trim()),
      maxRp: Number(String(mForm.maxRp.value || "0").trim()),
      maxUses: String(mForm.maxUses.value || "").trim() === "" ? null : Number(mForm.maxUses.value),
    };
    mForm.curl.textContent = curlFor("monthly.set", "POST", body);
  }

  function toolsCurlPreview() {
    const body = {
      amount: Number(String(tForm.amount.value || "0").trim()),
      deviceId: String(tForm.deviceId.value || "").trim(),
      voucher: String(tForm.code.value || "").trim(),
      reserveTtlMs: Number(String(tForm.ttl.value || "360000").trim()),
    };
    tForm.curl.textContent = curlFor("discount.apply", "POST", body);
  }

  // ===== Actions =====
  async function doLogin() {
    setMsg(gateMsg, "");
    const key = String(gateInput.value || "").trim();
    if (!key) return setMsg(gateMsg, "Admin Key kosong.", true);

    ADMIN = key;
    localStorage.setItem(LS_ADMIN, ADMIN);

    try {
      await ping();
      const ok = await validateAdminKey();
      if (!ok) {
        setMsg(gateMsg, "Admin Key salah (401).", true);
        return;
      }
      setGate(false);
      await refreshAll();
    } catch (e) {
      setMsg(gateMsg, `Login gagal: ${e?.message || e}`, true);
    }
  }

  function doLogout() {
    if (!confirm("Logout admin?")) return;
    ADMIN = "";
    localStorage.removeItem(LS_ADMIN);
    setGate(true);
    gateInput.value = "";
    setMsg(gateMsg, "Logout ✅");
  }

  async function refreshAll() {
    setMsg(vForm.msg, "");
    setMsg(mForm.msg, "");
    await ping();
    await loadVouchers();
    await loadMonthly();
  }

  async function saveVoucher() {
    try {
      const body = buildVoucherPayload();
      vForm.curl.textContent = curlFor("voucher.upsert", "POST", body);

      const r = await jfetch(endpoint("voucher.upsert"), {
        method: "POST",
        headers: hdrs({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      vForm.json.textContent = JSON.stringify(r.json, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(vForm.msg, "Voucher saved ✅");
      await loadVouchers();
    } catch (e) {
      setMsg(vForm.msg, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function disableVoucher() {
    try {
      const code = sanitizeCode(vForm.code.value);
      if (!code) throw new Error("Code kosong");
      if (!confirm(`Disable voucher ${code}?`)) return;

      const body = { code, enabled: false };
      vForm.curl.textContent = curlFor("voucher.disable", "POST", body);

      const r = await jfetch(endpoint("voucher.disable"), {
        method: "POST",
        headers: hdrs({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      vForm.json.textContent = JSON.stringify(r.json, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(vForm.msg, "Voucher OFF ✅");
      await loadVouchers();
    } catch (e) {
      setMsg(vForm.msg, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function saveMonthly() {
    try {
      const body = {
        enabled: !!mForm.enabled.checked,
        unlimitedEnabled: !!mForm.unlimitedEnabled.checked, // ✅ GLOBAL toggle
        code: sanitizeCode(mForm.code.value),
        name: String(mForm.name.value || "").trim(),
        percent: Number(String(mForm.percent.value || "0").trim()),
        maxRp: Number(String(mForm.maxRp.value || "0").trim()),
        maxUses: String(mForm.maxUses.value || "").trim() === "" ? null : Number(mForm.maxUses.value),
      };

      if (!body.code) throw new Error("Kode promo bulanan wajib diisi (monthly butuh CODE).");

      mForm.curl.textContent = curlFor("monthly.set", "POST", body);

      const r = await jfetch(endpoint("monthly.set"), {
        method: "POST",
        headers: hdrs({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      mForm.json.textContent = JSON.stringify(r.json, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);

      setMsg(mForm.msg, "Monthly saved ✅");
      await loadMonthly();
    } catch (e) {
      setMsg(mForm.msg, `Gagal: ${e?.message || e}`, true);
    }
  }

  async function runApply() {
    try {
      const body = {
        amount: Number(String(tForm.amount.value || "0").trim()),
        deviceId: String(tForm.deviceId.value || "").trim(),
        voucher: String(tForm.code.value || "").trim(),
        reserveTtlMs: Number(String(tForm.ttl.value || "360000").trim()),
      };

      toolsCurlPreview();

      const r = await jfetch(endpoint("discount.apply"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      tForm.json.textContent = JSON.stringify(r.json, null, 2);
      if (!r.ok) throw new Error(r.json?.error || `Error ${r.status}`);
    } catch (e) {
      tForm.json.textContent = JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2);
    }
  }

  // ===== Events =====
  navVouchers.addEventListener("click", () => setTab("vouchers"));
  navMonthly.addEventListener("click", () => setTab("monthly"));
  navTools.addEventListener("click", () => setTab("tools"));

  gateBtn.addEventListener("click", doLogin);
  gateInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  btnLogout.addEventListener("click", doLogout);
  btnRefresh.addEventListener("click", async () => {
    try {
      await refreshAll();
    } catch (e) {
      alert(`Refresh error: ${e?.message || e}`);
    }
  });

  vForm.btnSave.addEventListener("click", saveVoucher);
  vForm.btnDisable.addEventListener("click", disableVoucher);

  // live preview
  [vForm.code, vForm.name, vForm.percent, vForm.maxRp, vForm.maxUses, vForm.expiresAt].forEach((el) =>
    el.addEventListener("input", voucherCurlPreview)
  );
  vForm.enabled.addEventListener("change", voucherCurlPreview);

  [mForm.enabled, mForm.unlimitedEnabled, mForm.code, mForm.name, mForm.percent, mForm.maxRp, mForm.maxUses].forEach((el) =>
    el.addEventListener("input", monthlyCurlPreview)
  );
  mForm.btnSave.addEventListener("click", saveMonthly);

  [tForm.amount, tForm.deviceId, tForm.code, tForm.ttl].forEach((el) => el.addEventListener("input", toolsCurlPreview));
  tForm.btnRun.addEventListener("click", runApply);

  // ===== Init =====
  (async function init() {
    topApiText.textContent = API;
    setTab("vouchers");

    if (!ADMIN) {
      setGate(true);
      return;
    }

    try {
      await ping();
      const ok = await validateAdminKey();
      if (!ok) {
        setGate(true);
        return;
      }
      setGate(false);
      await refreshAll();
    } catch {
      setGate(true);
    }
  })();
})();