// admin.js — LevPay Admin (router: /api/levpay?action=...)
// Works with the HTML you pasted (ids must match).
(() => {
  "use strict";

  // ========= CONFIG =========
  // Default: API lives on same origin
  const API_BASE_DEFAULT = (window.LEVPAY_ADMIN_API_BASE || location.origin) + "/api/levpay";
  const LS_ADMIN_KEY = "levpay_admin_key";
  const LS_API_BASE = "levpay_admin_api_base";
  const LS_LAST_TAB = "levpay_admin_tab";
  const LS_AUTO_UNLIM_DONE = "levpay_admin_autounlim_done";

  // Prefill (from your message)
  const PREFILL_DEVICE_ID = "dev_rog6pro";
  const PREFILL_PEPPER = "43b2587ceb5edce5ba9a6e9158363ec412599095bd22d5225bdf55417c7a77f1";
  // You said this is sha256 result
  const PREFILL_DEVICEKEY = "4aa7798eff1dafa8b015f9b1f14980e578a9683e5b882de591cf2bc7814e382e";

  // ========= DOM =========
  const $ = (id) => document.getElementById(id);

  // gate
  const gate = $("gate");
  const adminKeyInput = $("adminKeyInput");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const loginMsg = $("loginMsg");

  // app header
  const app = $("app");
  const apiBaseText = $("apiBaseText");
  const btnRefreshAll = $("btnRefreshAll");
  const btnOpenGate = $("btnOpenGate");

  // side status
  const sysStatus = $("sysStatus");
  const lastSync = $("lastSync");
  const pillVoucherCount = $("pillVoucherCount");
  const pillMonthly = $("pillMonthly");

  // nav / tabs
  const navItems = Array.from(document.querySelectorAll(".navItem"));
  const tabVouchers = $("tab-vouchers");
  const tabMonthly = $("tab-monthly");
  const tabTools = $("tab-tools");

  // vouchers list + form
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

  // monthly promo form
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

  // unlimited device
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

  // ========= STATE =========
  let ADMIN_KEY = "";
  let API_BASE = "";
  let vouchers = [];
  let monthly = null;

  // ========= UTIL =========
  const nowText = () => new Date().toLocaleString("id-ID");

  function setLocked(isLocked) {
    app.classList.toggle("is-locked", !!isLocked);
    gate.classList.toggle("is-on", !!isLocked);
    gate.setAttribute("aria-hidden", isLocked ? "false" : "true");

    sysStatus.textContent = isLocked ? "LOCKED" : "ACTIVE";
    sysStatus.style.color = isLocked ? "rgba(255,255,255,.70)" : "rgba(209,255,224,.95)";
    btnLogout.disabled = isLocked;
  }

  function setMsg(el, text, tone = "ok") {
    if (!el) return;
    el.classList.remove("is-warn");
    if (tone === "warn" || tone === "bad") el.classList.add("is-warn");
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  function clamp(n, a, b) {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.max(a, Math.min(b, x));
  }

  function sanitizeCode(s) {
    return String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function toIsoFromDatetimeLocal(v) {
    const raw = String(v || "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }

  function fromIsoToDatetimeLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    // datetime-local expects "YYYY-MM-DDTHH:mm"
    const pad = (n) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }

  function fmtRp(n) {
    const x = Number(n || 0);
    if (!x) return "∞";
    return x.toLocaleString("id-ID");
  }

  function fmtUses(v) {
    if (v == null) return "∞";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "∞";
  }

  function actionUrl(action) {
    return `${API_BASE}?action=${encodeURIComponent(action)}`;
  }

  function curlFor(action, method, body, admin = false) {
    const HOSTVAR = "$HOST";
    const ADMINVAR = "$ADMIN";
    const heads = [];
    if (admin) heads.push(`-H "X-Admin-Key: ${ADMINVAR}"`);
    if (method !== "GET") heads.push(`-H "Content-Type: application/json"`);
    const h = heads.length ? " \\\n  " + heads.join(" \\\n  ") : "";
    const data = method === "GET" || body == null ? "" : ` \\\n  -d '${JSON.stringify(body)}'`;
    // print /api/levpay (same router)
    return `curl -sS -X ${method} "${HOSTVAR}/api/levpay?action=${action}"${h}${data} | jq`;
  }

  async function jfetch(action, { method = "GET", body = null, admin = false } = {}) {
    const headers = {};
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (admin) headers["X-Admin-Key"] = ADMIN_KEY;

    const r = await fetch(actionUrl(action), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const txt = await r.text();
    let json = {};
    try {
      json = txt ? JSON.parse(txt) : {};
    } catch {
      json = { raw: txt };
    }

    return { ok: r.ok, status: r.status, json };
  }

  // ========= SHA256 (browser) =========
  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(String(str));
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function genDeviceKey(deviceId, pepper) {
    const did = String(deviceId || "").trim();
    const pep = String(pepper || "").trim();
    if (!did || !pep) return "";
    // backend: sha256(deviceId + "|" + pepper)
    return await sha256Hex(`${did}|${pep}`);
  }

  // ========= TABS =========
  function showTab(name) {
    navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    tabVouchers.classList.toggle("is-on", name === "vouchers");
    tabMonthly.classList.toggle("is-on", name === "monthly");
    tabTools.classList.toggle("is-on", name === "tools");
    localStorage.setItem(LS_LAST_TAB, name);
  }

  // ========= RENDER =========
  function renderVoucherTable() {
    const onlyActive = !!onlyActiveToggle?.checked;

    const list = (vouchers || []).filter((v) => (onlyActive ? v.enabled !== false : true));
    const onCount = (vouchers || []).filter((v) => v.enabled !== false).length;
    pillVoucherCount.textContent = String(onCount || 0);

    if (!list.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="muted mutedCell">Belum ada data.</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = list
      .map((v) => {
        const enabled = v.enabled !== false;
        return `
          <tr data-code="${v.code}">
            <td class="mono">${v.code}</td>
            <td>${escapeHtml(v.name || v.code)}</td>
            <td>${enabled ? "ON" : "OFF"}</td>
            <td class="mono">${Number(v.percent || 0)}%</td>
            <td class="mono">${fmtRp(v.maxRp)}</td>
            <td class="mono">${fmtUses(v.maxUses)}</td>
            <td class="mono">${v.expiresAt ? escapeHtml(new Date(v.expiresAt).toLocaleString("id-ID")) : "—"}</td>
            <td class="tRight">
              <button class="btn btn--ghost btnPick" type="button">Edit</button>
            </td>
          </tr>
        `;
      })
      .join("");

    Array.from(voucherTbody.querySelectorAll(".btnPick")).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const code = tr?.dataset?.code;
        const v = (vouchers || []).find((x) => x.code === code);
        if (!v) return;
        fillVoucherForm(v);
      });
    });
  }

  function fillVoucherForm(v) {
    v_code.value = v.code || "";
    v_name.value = v.name || "";
    v_percent.value = String(Number(v.percent || 0));
    v_maxRp.value = String(Number(v.maxRp || 0));
    v_maxUses.value = v.maxUses == null ? "" : String(Number(v.maxUses));
    v_expiresAt.value = fromIsoToDatetimeLocal(v.expiresAt);
    v_enabled.checked = v.enabled !== false;

    // show curl template + last known response stub
    const body = buildVoucherPayload();
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", body, true);
    jsonVoucher.textContent = JSON.stringify({ hint: "Klik Simpan Voucher untuk eksekusi" }, null, 2);
  }

  function renderMonthlyBox() {
    if (!monthly || typeof monthly !== "object") {
      pillMonthly.textContent = "—";
      return;
    }
    pillMonthly.textContent = monthly.enabled ? "ON" : "OFF";

    m_enabled.checked = !!monthly.enabled;
    m_name.value = String(monthly.name || "");
    m_percent.value = String(Number(monthly.percent || 0));
    m_maxRp.value = String(Number(monthly.maxRp || 0));
    m_maxUses.value = monthly.maxUses == null ? "" : String(Number(monthly.maxUses));

    // render unlimited list
    const keys = monthly.unlimited && typeof monthly.unlimited === "object" ? Object.keys(monthly.unlimited) : [];
    if (!keys.length) {
      unlimitedTbody.innerHTML = `<tr><td colspan="2" class="muted mutedCell">Belum ada data.</td></tr>`;
    } else {
      unlimitedTbody.innerHTML = keys
        .sort((a, b) => a.localeCompare(b))
        .map(
          (k) => `
          <tr data-key="${k}">
            <td class="mono">${k}</td>
            <td class="tRight">
              <button type="button" class="btn btn--danger btnRmKey">Remove</button>
            </td>
          </tr>
        `
        )
        .join("");

      Array.from(unlimitedTbody.querySelectorAll(".btnRmKey")).forEach((b) => {
        b.addEventListener("click", async (e) => {
          const tr = e.target.closest("tr");
          const key = tr?.dataset?.key;
          if (!key) return;
          if (!confirm("Remove unlimited deviceKey ini?")) return;
          await monthlySet({ removeUnlimitedDeviceKey: key });
          await loadMonthly();
        });
      });
    }

    // show curl template
    const body = buildMonthlyPayload();
    curlMonthly.textContent = curlFor("monthly.set", "POST", body, true);
    jsonMonthly.textContent = JSON.stringify({ hint: "Klik Save untuk eksekusi" }, null, 2);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ========= BUILD PAYLOADS =========
  function buildVoucherPayload() {
    const code = sanitizeCode(v_code.value);
    if (!code) throw new Error("Code voucher wajib");
    const percent = clamp(v_percent.value, 0, 100);
    if (!Number.isFinite(Number(v_percent.value)) && String(v_percent.value).trim() !== "") {
      throw new Error("Percent invalid");
    }

    const payload = {
      code,
      enabled: !!v_enabled.checked,
      name: String(v_name.value || "").trim() || code,
      percent,
      maxRp: Math.max(0, Number(String(v_maxRp.value || "0").trim() || "0")),
      note: null,
    };

    const mu = String(v_maxUses.value || "").trim();
    if (mu !== "") {
      const n = Number(mu);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Max Uses harus angka > 0 atau kosong");
      payload.maxUses = n;
    } else {
      payload.maxUses = null; // unlimited
    }

    const expIso = toIsoFromDatetimeLocal(v_expiresAt.value);
    payload.expiresAt = expIso || null;

    return payload;
  }

  function buildMonthlyPayload() {
    const payload = {
      enabled: !!m_enabled.checked,
      name: String(m_name.value || "").trim() || "PROMO BULANAN",
      percent: clamp(m_percent.value, 0, 100),
      maxRp: Math.max(0, Number(String(m_maxRp.value || "0").trim() || "0")),
    };

    const mu = String(m_maxUses.value || "").trim();
    if (mu !== "") {
      const n = Number(mu);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Max Uses monthly harus angka > 0 atau kosong");
      payload.maxUses = n; // global max use / bulan
    } else {
      payload.maxUses = null; // unlimited global
    }

    return payload;
  }

  // ========= API CALLS =========
  async function ping() {
    const r = await jfetch("ping", { method: "GET", admin: false });
    return r;
  }

  async function validateAdminKey() {
    // easiest: call admin endpoint and see if 401
    const r = await jfetch("voucher.list", { method: "GET", admin: true });
    return r.status !== 401 && r.ok;
  }

  async function loadVouchers() {
    const r = await jfetch("voucher.list", { method: "GET", admin: true });
    if (!r.ok) throw new Error(`voucher.list error (${r.status})`);
    const raw = r.json?.data ?? r.json;
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
        note: v.note || null,
        updatedAt: v.updatedAt || null,
      }))
      .filter((v) => v.code);

    renderVoucherTable();
    setMsg(msgVoucher, "", "ok");
    lastSync.textContent = nowText();
  }

  async function voucherUpsert(body) {
    curlVoucher.textContent = curlFor("voucher.upsert", "POST", body, true);
    const r = await jfetch("voucher.upsert", { method: "POST", admin: true, body });
    jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
    if (!r.ok) throw new Error(`voucher.upsert error (${r.status})`);
    return r;
  }

  async function voucherDisable(code) {
    const body = { code: sanitizeCode(code) };
    curlVoucher.textContent = curlFor("voucher.disable", "POST", body, true);
    const r = await jfetch("voucher.disable", { method: "POST", admin: true, body });
    jsonVoucher.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
    if (!r.ok) throw new Error(`voucher.disable error (${r.status})`);
    return r;
  }

  async function loadMonthly() {
    const r = await jfetch("monthly.get", { method: "GET", admin: true });
    if (!r.ok) throw new Error(`monthly.get error (${r.status})`);
    monthly = r.json?.data ?? r.json;
    renderMonthlyBox();
    setMsg(msgMonthly, "", "ok");
    lastSync.textContent = nowText();
  }

  async function monthlySet(body) {
    curlMonthly.textContent = curlFor("monthly.set", "POST", body, true);
    const r = await jfetch("monthly.set", { method: "POST", admin: true, body });
    jsonMonthly.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
    if (!r.ok) throw new Error(`monthly.set error (${r.status})`);
    return r;
  }

  async function discountApply(body) {
    curlApply.textContent = curlFor("discount.apply", "POST", body, false);
    const r = await jfetch("discount.apply", { method: "POST", admin: false, body });
    jsonApply.textContent = JSON.stringify({ ok: r.ok, status: r.status, data: r.json }, null, 2);
    return r;
  }

  // ========= AUTO UNLIMITED (your request) =========
  async function autoInsertUnlimitedOnce() {
    // only after logged in and monthly already loaded
    try {
      const done = localStorage.getItem(LS_AUTO_UNLIM_DONE) === "1";
      if (done) return;

      // if your prefilled deviceKey exists in monthly.unlimited, mark done
      const has =
        monthly &&
        monthly.unlimited &&
        typeof monthly.unlimited === "object" &&
        !!monthly.unlimited[PREFILL_DEVICEKEY];

      if (has) {
        localStorage.setItem(LS_AUTO_UNLIM_DONE, "1");
        return;
      }

      // try add it automatically
      await monthlySet({ addUnlimitedDeviceKey: PREFILL_DEVICEKEY });
      localStorage.setItem(LS_AUTO_UNLIM_DONE, "1");
      await loadMonthly();
      setMsg(msgUnlimited, "✅ Unlimited deviceKey sudah ditambahkan otomatis (prefill).", "ok");
    } catch (e) {
      // don't block app if fails
      setMsg(
        msgUnlimited,
        "⚠️ Gagal auto add unlimited. Coba klik Add Unlimited manual. (" + (e?.message || "error") + ")",
        "warn"
      );
    }
  }

  // ========= EVENTS =========
  navItems.forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });

  btnOpenGate?.addEventListener("click", () => {
    // open gate even if already logged (for changing key)
    gate.classList.add("is-on");
    gate.setAttribute("aria-hidden", "false");
  });

  btnRefreshAll?.addEventListener("click", async () => {
    try {
      await ping();
      await loadVouchers();
      await loadMonthly();
      renderVoucherTable();
      renderMonthlyBox();
      lastSync.textContent = nowText();
      setMsg(msgVoucher, "Refreshed ✅", "ok");
      setTimeout(() => setMsg(msgVoucher, "", "ok"), 1200);
    } catch (e) {
      setMsg(msgVoucher, "Refresh gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnLogin?.addEventListener("click", async () => {
    setMsg(loginMsg, "", "ok");

    ADMIN_KEY = String(adminKeyInput.value || "").trim();
    if (!ADMIN_KEY) {
      setMsg(loginMsg, "Admin Key kosong.", "warn");
      return;
    }

    try {
      // store
      localStorage.setItem(LS_ADMIN_KEY, ADMIN_KEY);

      // validate by hitting admin endpoint
      const ok = await validateAdminKey();
      if (!ok) {
        setMsg(loginMsg, "Admin Key salah (401).", "warn");
        return;
      }

      // success
      gate.classList.remove("is-on");
      gate.setAttribute("aria-hidden", "true");
      setLocked(false);

      await loadVouchers();
      await loadMonthly();
      await autoInsertUnlimitedOnce();

      lastSync.textContent = nowText();
    } catch (e) {
      setMsg(loginMsg, "Gagal login: " + (e?.message || "error"), "warn");
    }
  });

  btnLogout?.addEventListener("click", () => {
    if (!confirm("Logout admin?")) return;
    localStorage.removeItem(LS_ADMIN_KEY);
    ADMIN_KEY = "";
    setLocked(true);
    setMsg(loginMsg, "", "ok");
    setMsg(msgVoucher, "", "ok");
    setMsg(msgMonthly, "", "ok");
    setMsg(msgUnlimited, "", "ok");
  });

  // vouchers
  onlyActiveToggle?.addEventListener("change", renderVoucherTable);

  btnLoadVouchers?.addEventListener("click", async () => {
    try {
      await loadVouchers();
      setMsg(msgVoucher, "Loaded ✅", "ok");
      setTimeout(() => setMsg(msgVoucher, "", "ok"), 1200);
    } catch (e) {
      setMsg(msgVoucher, "Load vouchers gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnUpsertVoucher?.addEventListener("click", async () => {
    try {
      const body = buildVoucherPayload();
      await voucherUpsert(body);
      await loadVouchers();
      renderVoucherTable();
      setMsg(msgVoucher, "Voucher tersimpan ✅", "ok");
    } catch (e) {
      setMsg(msgVoucher, "Gagal simpan voucher: " + (e?.message || "error"), "warn");
    }
  });

  btnDisableVoucher?.addEventListener("click", async () => {
    try {
      const code = sanitizeCode(v_code.value);
      if (!code) {
        setMsg(msgVoucher, "Code kosong.", "warn");
        return;
      }
      if (!confirm(`Disable voucher ${code}?`)) return;

      await voucherDisable(code);
      await loadVouchers();
      renderVoucherTable();
      setMsg(msgVoucher, `Voucher ${code} di-disable ✅`, "ok");
    } catch (e) {
      setMsg(msgVoucher, "Gagal disable voucher: " + (e?.message || "error"), "warn");
    }
  });

  // keep curl preview updated
  [v_code, v_name, v_percent, v_maxRp, v_maxUses, v_expiresAt, v_enabled].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      try {
        const body = buildVoucherPayload();
        curlVoucher.textContent = curlFor("voucher.upsert", "POST", body, true);
      } catch {
        // ignore while invalid
      }
    });
    el.addEventListener("change", () => {
      try {
        const body = buildVoucherPayload();
        curlVoucher.textContent = curlFor("voucher.upsert", "POST", body, true);
      } catch {}
    });
  });

  // monthly
  btnLoadMonthly?.addEventListener("click", async () => {
    try {
      await loadMonthly();
      setMsg(msgMonthly, "Loaded ✅", "ok");
      setTimeout(() => setMsg(msgMonthly, "", "ok"), 1200);
    } catch (e) {
      setMsg(msgMonthly, "Load monthly gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnSaveMonthly?.addEventListener("click", async () => {
    try {
      const body = buildMonthlyPayload();
      await monthlySet(body);
      await loadMonthly();
      setMsg(msgMonthly, "Monthly tersimpan ✅", "ok");
    } catch (e) {
      setMsg(msgMonthly, "Gagal save monthly: " + (e?.message || "error"), "warn");
    }
  });

  [m_enabled, m_name, m_percent, m_maxRp, m_maxUses].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      try {
        const body = buildMonthlyPayload();
        curlMonthly.textContent = curlFor("monthly.set", "POST", body, true);
      } catch {}
    });
    el.addEventListener("change", () => {
      try {
        const body = buildMonthlyPayload();
        curlMonthly.textContent = curlFor("monthly.set", "POST", body, true);
      } catch {}
    });
  });

  // unlimited deviceKey (generate / add / remove)
  btnGenKey?.addEventListener("click", async () => {
    try {
      setMsg(msgUnlimited, "", "ok");
      const did = String(dev_id.value || "").trim();
      const pep = String(dev_pepper.value || "").trim();
      if (!did || !pep) {
        setMsg(msgUnlimited, "Device ID & Pepper wajib diisi.", "warn");
        return;
      }
      const key = await genDeviceKey(did, pep);
      dev_key.value = key;
      setMsg(msgUnlimited, "deviceKey generated ✅", "ok");
    } catch (e) {
      setMsg(msgUnlimited, "Gagal generate: " + (e?.message || "error"), "warn");
    }
  });

  btnAddUnlimited?.addEventListener("click", async () => {
    try {
      setMsg(msgUnlimited, "", "ok");
      const key = String(dev_key.value || "").trim();
      if (!key) {
        setMsg(msgUnlimited, "Generate deviceKey dulu.", "warn");
        return;
      }
      await monthlySet({ addUnlimitedDeviceKey: key });
      await loadMonthly();
      setMsg(msgUnlimited, "Added unlimited ✅", "ok");
    } catch (e) {
      setMsg(msgUnlimited, "Gagal add unlimited: " + (e?.message || "error"), "warn");
    }
  });

  btnRemoveUnlimited?.addEventListener("click", async () => {
    try {
      setMsg(msgUnlimited, "", "ok");
      const key = String(dev_key.value || "").trim();
      if (!key) {
        setMsg(msgUnlimited, "deviceKey kosong.", "warn");
        return;
      }
      if (!confirm("Remove unlimited untuk deviceKey ini?")) return;
      await monthlySet({ removeUnlimitedDeviceKey: key });
      await loadMonthly();
      setMsg(msgUnlimited, "Removed ✅", "ok");
    } catch (e) {
      setMsg(msgUnlimited, "Gagal remove: " + (e?.message || "error"), "warn");
    }
  });

  // tools: discount.apply (public)
  btnRunApply?.addEventListener("click", async () => {
    try {
      const body = {
        amount: Number(String(t_amount.value || "0").trim()),
        deviceId: String(t_deviceId.value || "").trim(),
        voucher: String(t_voucher.value || "").trim(),
        reserveTtlMs: Number(String(t_ttl.value || "360000").trim()),
      };
      await discountApply(body);
    } catch (e) {
      jsonApply.textContent = JSON.stringify({ ok: false, error: e?.message || "error" }, null, 2);
    }
  });

  // ========= INIT =========
  async function init() {
    // base
    API_BASE = String(localStorage.getItem(LS_API_BASE) || API_BASE_DEFAULT).trim();
    apiBaseText.textContent = API_BASE.replace(/^https?:\/\//, "");

    // prefill unlimited inputs (your values)
    dev_id.value = PREFILL_DEVICE_ID;
    dev_pepper.value = PREFILL_PEPPER;
    dev_key.value = PREFILL_DEVICEKEY; // you said this is sha256 result

    // tools prefill
    t_deviceId.value = PREFILL_DEVICE_ID;

    // show last tab
    showTab(localStorage.getItem(LS_LAST_TAB) || "vouchers");

    // set placeholders for curl boxes
    curlVoucher.textContent = curlFor(
      "voucher.upsert",
      "POST",
      { code: "VIPL", enabled: true, name: "VIP LEVEL", percent: 10, maxRp: 0, maxUses: 100, expiresAt: null },
      true
    );
    jsonVoucher.textContent = JSON.stringify({ hint: "Response akan muncul setelah Simpan/Disable" }, null, 2);

    curlMonthly.textContent = curlFor(
      "monthly.set",
      "POST",
      { enabled: true, name: "PROMO BULANAN", percent: 5, maxRp: 2000, maxUses: null },
      true
    );
    jsonMonthly.textContent = JSON.stringify({ hint: "Response akan muncul setelah Save" }, null, 2);

    curlApply.textContent = curlFor(
      "discount.apply",
      "POST",
      { amount: 10000, deviceId: PREFILL_DEVICE_ID, voucher: "VIPL", reserveTtlMs: 360000 },
      false
    );
    jsonApply.textContent = JSON.stringify({ hint: "Response akan muncul setelah Run" }, null, 2);

    // ping (best-effort)
    try {
      const r = await ping();
      if (!r.ok) {
        sysStatus.textContent = "API ERROR";
        sysStatus.style.color = "rgba(255,235,235,.92)";
      }
    } catch {}

    // auto login if key exists
    ADMIN_KEY = String(localStorage.getItem(LS_ADMIN_KEY) || "").trim();
    if (ADMIN_KEY) {
      try {
        const ok = await validateAdminKey();
        if (ok) {
          adminKeyInput.value = "";
          setLocked(false);
          await loadVouchers();
          await loadMonthly();
          await autoInsertUnlimitedOnce();
          lastSync.textContent = nowText();
          gate.classList.remove("is-on");
          gate.setAttribute("aria-hidden", "true");
          return;
        }
      } catch {}
    }

    // otherwise locked
    setLocked(true);
  }

  init();
})();