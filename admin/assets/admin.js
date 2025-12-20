(() => {
  // ✅ Hidden: jangan tampilkan endpoint di UI
  const API_PATH = "/api/levpay";
  const KEY_STORAGE = "levpay_admin_key";

  // ====== helpers ======
  const $ = (id) => document.getElementById(id);

  const lock = $("lock");
  const adminKeyInput = $("adminKeyInput");
  const btnUnlock = $("btnUnlock");
  const lockMsg = $("lockMsg");

  const btnLogout = $("btnLogout");
  const btnPing = $("btnPing");
  const btnHelp = $("btnHelp");

  const toast = $("toast");

  const pillStatus = $("pillStatus");
  const statService = $("statService");
  const statTime = $("statTime");

  const pillVoucherOn = $("pillVoucherOn");
  const statVoucherTotal = $("statVoucherTotal");
  const statVoucherActive = $("statVoucherActive");

  const pillMonthly = $("pillMonthly");
  const statMonthlyName = $("statMonthlyName");
  const statMonthlyMaxUses = $("statMonthlyMaxUses");

  // Tabs
  const tabButtons = Array.from(document.querySelectorAll(".tab"));
  const panels = {
    vouchers: $("tab-vouchers"),
    monthly: $("tab-monthly"),
    tools: $("tab-tools"),
    tutor: $("tab-tutor"),
  };

  // Voucher form
  const vCode = $("vCode");
  const vName = $("vName");
  const vPercent = $("vPercent");
  const vMaxRp = $("vMaxRp");
  const vMaxUses = $("vMaxUses");
  const vExpired = $("vExpired");
  const vEnabled = $("vEnabled");

  const btnVoucherUpsert = $("btnVoucherUpsert");
  const btnVoucherDisable = $("btnVoucherDisable");
  const btnRefreshVouchers = $("btnRefreshVouchers");

  const voucherTbody = $("voucherTbody");
  const voucherCurlBox = $("voucherCurlBox");
  const voucherJsonBox = $("voucherJsonBox");
  const btnCopyCurlVoucher = $("btnCopyCurlVoucher");
  const btnCopyJsonVoucher = $("btnCopyJsonVoucher");

  // Monthly
  const mEnabled = $("mEnabled");
  const mName = $("mName");
  const mPercent = $("mPercent");
  const mMaxRp = $("mMaxRp");
  const mMaxUses = $("mMaxUses");

  const btnMonthlyLoad = $("btnMonthlyLoad");
  const btnMonthlySave = $("btnMonthlySave");
  const monthlyCurlBox = $("monthlyCurlBox");
  const monthlyJsonBox = $("monthlyJsonBox");
  const btnCopyCurlMonthly = $("btnCopyCurlMonthly");
  const btnCopyJsonMonthly = $("btnCopyJsonMonthly");

  const mDeviceKey = $("mDeviceKey");
  const btnUnlimitedAdd = $("btnUnlimitedAdd");
  const btnUnlimitedRemove = $("btnUnlimitedRemove");
  const btnCopyCurlUnlimitedAdd = $("btnCopyCurlUnlimitedAdd");
  const btnCopyCurlUnlimitedRemove = $("btnCopyCurlUnlimitedRemove");

  const mSummaryPill = $("mSummaryPill");
  const mUsedCount = $("mUsedCount");
  const mReservedCount = $("mReservedCount");
  const mUnlimitedCount = $("mUnlimitedCount");

  // Tools
  const tDeviceId = $("tDeviceId");
  const tPepper = $("tPepper");
  const tDeviceKey = $("tDeviceKey");
  const btnGenDeviceId = $("btnGenDeviceId");
  const btnCopyDeviceKey = $("btnCopyDeviceKey");

  const tAmount = $("tAmount");
  const tVoucher = $("tVoucher");
  const applyCurlBox = $("applyCurlBox");
  const applyJsonBox = $("applyJsonBox");
  const btnCopyCurlApply = $("btnCopyCurlApply");
  const btnCopyJsonApply = $("btnCopyJsonApply");

  // Tutor
  const tutorBox = $("tutorBox");
  const btnTutorRefresh = $("btnTutorRefresh");
  const btnCopyTutor = $("btnCopyTutor");

  // Filter
  const vFilterInputs = Array.from(document.querySelectorAll('input[name="vFilter"]'));

  let ADMIN_KEY = "";
  let vouchersCache = [];
  let monthlyCache = null;

  function toastShow(text, type = "info") {
    toast.textContent = text;
    toast.classList.add("is-on");
    toast.dataset.type = type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("is-on"), 1800);
  }

  function fmtRp(n) {
    const x = Number(n || 0);
    if (!Number.isFinite(x)) return "0";
    return Math.round(x).toLocaleString("id-ID");
  }

  function safeUpper(v) {
    return String(v || "").trim().toUpperCase();
  }

  function maskCode(code) {
    const s = safeUpper(code);
    if (s.length <= 4) return s[0] + "***";
    return s.slice(0, 2) + "****" + s.slice(-2);
  }

  function toIsoFromDatetimeLocal(v) {
    // datetime-local: "2025-12-20T16:30"
    const s = String(v || "").trim();
    if (!s) return null;
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }

  function datetimeLocalFromIso(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    const pad = (x) => String(x).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      toastShow("Copied ✅");
      return true;
    } catch {
      toastShow("Gagal copy", "warn");
      return false;
    }
  }

  function getHostPlaceholder() {
    return "$HOST"; // jangan hardcode endpoint/host di UI
  }

  function apiUrl(action, extraQuery = "") {
    const q = extraQuery ? "&" + extraQuery.replace(/^\&/, "") : "";
    return `${API_PATH}?action=${encodeURIComponent(action)}${q}`;
  }

  async function apiPost(action, bodyObj, admin = false, extraQuery = "") {
    const headers = { "Content-Type": "application/json" };
    if (admin) headers["X-Admin-Key"] = ADMIN_KEY;

    const r = await fetch(apiUrl(action, extraQuery), {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj || {}),
    });

    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!r.ok) {
      const msg = json?.error || json?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return json;
  }

  // ====== login/lock ======
  function showLock(on) {
    lock.classList.toggle("is-on", !!on);
  }

  function loadKey() {
    const k = sessionStorage.getItem(KEY_STORAGE) || "";
    ADMIN_KEY = String(k || "");
    return ADMIN_KEY;
  }

  function saveKey(k) {
    ADMIN_KEY = String(k || "").trim();
    sessionStorage.setItem(KEY_STORAGE, ADMIN_KEY);
  }

  function clearKey() {
    ADMIN_KEY = "";
    sessionStorage.removeItem(KEY_STORAGE);
  }

  function lockError(msg) {
    lockMsg.hidden = false;
    lockMsg.textContent = msg;
  }

  function lockClear() {
    lockMsg.hidden = true;
    lockMsg.textContent = "";
  }

  async function unlockFlow() {
    lockClear();
    const k = String(adminKeyInput.value || "").trim();
    if (!k) return lockError("Admin Key wajib diisi.");
    saveKey(k);

    // test minimal: voucher.list (admin)
    try {
      await apiPost("voucher.list", {}, true);
      showLock(false);
      toastShow("Login OK ✅");
      await boot();
    } catch (e) {
      clearKey();
      lockError("Key salah / unauthorized.");
    }
  }

  // ====== tabs ======
  function setTab(name) {
    tabButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => {
      el.classList.toggle("is-active", k === name);
    });
  }

  tabButtons.forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });

  // ====== header actions ======
  btnLogout.addEventListener("click", () => {
    clearKey();
    showLock(true);
    toastShow("Logout");
  });

  btnPing.addEventListener("click", async () => {
    try {
      const r = await apiPost("ping", {}, false);
      pillStatus.textContent = "OK";
      pillStatus.className = "pill pill--ok";
      statService.textContent = r?.service || "levpay-api";
      statTime.textContent = r?.time || new Date().toISOString();
      toastShow("Ping OK");
    } catch (e) {
      pillStatus.textContent = "ERR";
      pillStatus.className = "pill pill--muted";
      toastShow("Ping gagal", "warn");
    }
  });

  btnHelp.addEventListener("click", async () => {
    try {
      const r = await apiPost("help", {}, false);
      toastShow("Help loaded");
      // Build tutor content from help
      tutorBox.textContent = buildTutorText(r);
      setTab("tutor");
    } catch {
      tutorBox.textContent = buildTutorText(null);
      setTab("tutor");
    }
  });

  // ====== vouchers ======
  function readVoucherForm() {
    const code = safeUpper(vCode.value);
    const name = String(vName.value || "").trim();
    const percent = Number(vPercent.value || 0);
    const maxRp = Number(vMaxRp.value || 0);
    const maxUsesRaw = String(vMaxUses.value || "").trim();
    const maxUses = maxUsesRaw === "" ? null : Number(maxUsesRaw);
    const expiresAt = toIsoFromDatetimeLocal(vExpired.value);
    const enabled = !!vEnabled.checked;

    return { code, name, percent, maxRp, maxUses, expiresAt, enabled };
  }

  function voucherUpsertCurl(body) {
    const host = getHostPlaceholder();
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=voucher.upsert" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  function voucherDisableCurl(code) {
    const host = getHostPlaceholder();
    const body = { code: safeUpper(code) };
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=voucher.disable" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  function setVoucherCurlJsonPreview() {
    const body = readVoucherForm();
    const bodySafe = { ...body };
    // safety: jangan taruh undefined
    if (!bodySafe.name) delete bodySafe.name;
    if (!bodySafe.expiresAt) delete bodySafe.expiresAt;
    if (bodySafe.maxUses == null || !Number.isFinite(bodySafe.maxUses)) delete bodySafe.maxUses;

    voucherCurlBox.textContent = voucherUpsertCurl(bodySafe);
    voucherJsonBox.textContent = JSON.stringify(bodySafe, null, 2);
  }

  ["input", "change"].forEach((evt) => {
    [vCode, vName, vPercent, vMaxRp, vMaxUses, vExpired, vEnabled].forEach((el) => {
      el.addEventListener(evt, setVoucherCurlJsonPreview);
    });
  });

  btnCopyCurlVoucher.addEventListener("click", () => copyText(voucherCurlBox.textContent));
  btnCopyJsonVoucher.addEventListener("click", () => copyText(voucherJsonBox.textContent));

  btnVoucherUpsert.addEventListener("click", async () => {
    const body = readVoucherForm();
    if (!body.code) return toastShow("Code wajib diisi", "warn");

    const payload = {
      code: body.code,
      name: body.name || body.code,
      enabled: body.enabled !== false,
      percent: clamp(body.percent, 0, 100),
      maxRp: Math.max(0, Number(body.maxRp || 0)),
      ...(body.maxUses != null && Number.isFinite(body.maxUses) ? { maxUses: Number(body.maxUses) } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    };

    try {
      await apiPost("voucher.upsert", payload, true);
      toastShow("Voucher tersimpan ✅");
      await refreshVouchers();
      // keep form preview updated
      setVoucherCurlJsonPreview();
    } catch (e) {
      toastShow("Gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnVoucherDisable.addEventListener("click", async () => {
    const code = safeUpper(vCode.value);
    if (!code) return toastShow("Isi code dulu", "warn");

    const ok = window.confirm(`Disable voucher ${code}?`);
    if (!ok) return;

    try {
      await apiPost("voucher.disable", { code }, true);
      toastShow("Voucher disabled ✅");
      await refreshVouchers();
    } catch (e) {
      toastShow("Gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnRefreshVouchers.addEventListener("click", refreshVouchers);
  vFilterInputs.forEach((r) => r.addEventListener("change", renderVouchers));

  function clamp(n, a, b) {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.max(a, Math.min(b, x));
  }

  function renderVouchers() {
    const mode = (vFilterInputs.find((x) => x.checked)?.value || "active").toLowerCase();
    const items = Array.isArray(vouchersCache) ? vouchersCache : [];

    const filtered = mode === "active"
      ? items.filter((v) => v && v.enabled !== false)
      : items;

    // Stats
    const total = items.length;
    const active = items.filter((v) => v && v.enabled !== false).length;

    pillVoucherOn.textContent = String(active);
    statVoucherTotal.textContent = String(total);
    statVoucherActive.textContent = String(active);

    if (!filtered.length) {
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Tidak ada data</td></tr>`;
      return;
    }

    voucherTbody.innerHTML = filtered.map((v) => {
      const code = safeUpper(v.code);
      const exp = v.expiresAt ? new Date(v.expiresAt).toLocaleString("id-ID") : "—";
      const enabled = v.enabled !== false;
      const st = enabled ? "ON" : "OFF";

      const maxUses = (v.maxUses == null) ? "—" : String(v.maxUses);
      const maxRp = fmtRp(v.maxRp || 0);

      return `
        <tr>
          <td>
            <div class="mono">${maskCode(code)}</div>
            <div class="miniAction">
              <button class="miniBtn" data-act="pick" data-code="${code}">Edit</button>
              <button class="miniBtn" data-act="reveal" data-code="${code}">Reveal</button>
            </div>
          </td>
          <td>${escapeHtml(v.name || code)}</td>
          <td><b>${Number(v.percent || 0)}%</b></td>
          <td>${maxRp}</td>
          <td>${maxUses}</td>
          <td>${exp}</td>
          <td>
            <span class="badge ${enabled ? "badge--on" : "badge--off"}">${st}</span>
          </td>
          <td>
            <button class="miniBtn miniBtn--primary" data-act="curl" data-code="${code}">Curl</button>
            ${enabled
              ? `<button class="miniBtn miniBtn--danger" data-act="off" data-code="${code}">Off</button>`
              : `<button class="miniBtn miniBtn--primary" data-act="on" data-code="${code}">On</button>`}
          </td>
        </tr>
      `;
    }).join("");

    // bind actions
    voucherTbody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => handleVoucherRowAction(btn.dataset.act, btn.dataset.code));
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function handleVoucherRowAction(act, code) {
    const v = vouchersCache.find((x) => safeUpper(x?.code) === safeUpper(code));
    if (!v) return toastShow("Voucher tidak ditemukan", "warn");

    if (act === "pick") {
      // fill form
      vCode.value = safeUpper(v.code);
      vName.value = v.name || "";
      vPercent.value = String(v.percent ?? "");
      vMaxRp.value = String(v.maxRp ?? "");
      vMaxUses.value = (v.maxUses == null ? "" : String(v.maxUses));
      vExpired.value = datetimeLocalFromIso(v.expiresAt);
      vEnabled.checked = v.enabled !== false;
      setVoucherCurlJsonPreview();
      toastShow("Form diisi ✅");
      return;
    }

    if (act === "reveal") {
      const ok = window.confirm("Reveal kode voucher? (disarankan hanya saat perlu)");
      if (!ok) return;
      toastShow("Kode: " + safeUpper(v.code));
      return;
    }

    if (act === "curl") {
      // show curl/json in preview using current row voucher (masked in list; full in curl via confirm)
      const ok = window.confirm("Buat curl untuk voucher ini?");
      if (!ok) return;

      const body = {
        code: safeUpper(v.code),
        name: v.name || safeUpper(v.code),
        enabled: v.enabled !== false,
        percent: clamp(v.percent, 0, 100),
        maxRp: Math.max(0, Number(v.maxRp || 0)),
        ...(v.maxUses != null ? { maxUses: Number(v.maxUses) } : {}),
        ...(v.expiresAt ? { expiresAt: String(v.expiresAt) } : {}),
      };

      voucherCurlBox.textContent = voucherUpsertCurl(body);
      voucherJsonBox.textContent = JSON.stringify(body, null, 2);
      toastShow("Curl siap ✅");
      return;
    }

    if (act === "off") {
      const ok = window.confirm(`Matikan voucher ${safeUpper(code)}?`);
      if (!ok) return;
      try {
        await apiPost("voucher.disable", { code: safeUpper(code) }, true);
        toastShow("OFF ✅");
        await refreshVouchers();
      } catch (e) {
        toastShow("Gagal: " + (e?.message || "error"), "warn");
      }
      return;
    }

    if (act === "on") {
      const ok = window.confirm(`Hidupkan voucher ${safeUpper(code)}?`);
      if (!ok) return;

      // on = upsert enabled true pakai value existing
      const body = {
        code: safeUpper(v.code),
        name: v.name || safeUpper(v.code),
        enabled: true,
        percent: clamp(v.percent, 0, 100),
        maxRp: Math.max(0, Number(v.maxRp || 0)),
        ...(v.maxUses != null ? { maxUses: Number(v.maxUses) } : {}),
        ...(v.expiresAt ? { expiresAt: String(v.expiresAt) } : {}),
      };

      try {
        await apiPost("voucher.upsert", body, true);
        toastShow("ON ✅");
        await refreshVouchers();
      } catch (e) {
        toastShow("Gagal: " + (e?.message || "error"), "warn");
      }
      return;
    }
  }

  async function refreshVouchers() {
    try {
      const r = await apiPost("voucher.list", {}, true);
      vouchersCache = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
      renderVouchers();
      toastShow("Voucher refreshed");
    } catch (e) {
      toastShow("Gagal list voucher: " + (e?.message || "error"), "warn");
      voucherTbody.innerHTML = `<tr><td colspan="8" class="mutedCell">Gagal load</td></tr>`;
    }
  }

  // ====== monthly ======
  function monthlySetCurl(body) {
    const host = getHostPlaceholder();
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=monthly.set" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  function monthlyGetCurl() {
    const host = getHostPlaceholder();
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=monthly.get" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" | jq`,
    ].join("\n");
  }

  function readMonthlyForm() {
    const enabled = !!mEnabled.checked;
    const name = String(mName.value || "").trim();
    const percent = Number(mPercent.value || 0);
    const maxRp = Number(mMaxRp.value || 0);
    const maxUsesRaw = String(mMaxUses.value || "").trim();
    const maxUses = maxUsesRaw === "" ? null : Number(maxUsesRaw);
    return { enabled, name, percent, maxRp, maxUses };
  }

  function renderMonthlySummary(p) {
    const used = p?.used ? Object.keys(p.used).length : 0;
    const reserved = p?.reserved ? Object.keys(p.reserved).length : 0;
    const unlimited = p?.unlimited ? Object.keys(p.unlimited).length : 0;

    mUsedCount.textContent = String(used);
    mReservedCount.textContent = String(reserved);
    mUnlimitedCount.textContent = String(unlimited);

    mSummaryPill.textContent = (p?.enabled ? "ON" : "OFF");
    mSummaryPill.className = p?.enabled ? "pill pill--ok" : "pill pill--muted";

    pillMonthly.textContent = (p?.enabled ? "ON" : "OFF");
    pillMonthly.className = p?.enabled ? "pill pill--ok" : "pill pill--muted";

    statMonthlyName.textContent = p?.name || "—";
    statMonthlyMaxUses.textContent = (p?.maxUses == null ? "—" : String(p.maxUses));
  }

  function setMonthlyCurlJsonPreview() {
    const form = readMonthlyForm();
    const payload = {
      ...(form.enabled != null ? { enabled: !!form.enabled } : {}),
      ...(form.name ? { name: form.name } : {}),
      ...(Number.isFinite(form.percent) ? { percent: clamp(form.percent, 0, 100) } : {}),
      ...(Number.isFinite(form.maxRp) ? { maxRp: Math.max(0, Number(form.maxRp || 0)) } : {}),
      ...(form.maxUses != null && Number.isFinite(form.maxUses) ? { maxUses: Number(form.maxUses) } : {}),
    };

    monthlyCurlBox.textContent = monthlySetCurl(payload) + "\n\n# get:\n" + monthlyGetCurl();
    monthlyJsonBox.textContent = JSON.stringify(payload, null, 2);

    statMonthlyName.textContent = form.name || statMonthlyName.textContent;
    statMonthlyMaxUses.textContent = (form.maxUses == null ? statMonthlyMaxUses.textContent : String(form.maxUses));
  }

  ["input", "change"].forEach((evt) => {
    [mEnabled, mName, mPercent, mMaxRp, mMaxUses].forEach((el) => {
      el.addEventListener(evt, setMonthlyCurlJsonPreview);
    });
  });

  btnCopyCurlMonthly.addEventListener("click", () => copyText(monthlyCurlBox.textContent));
  btnCopyJsonMonthly.addEventListener("click", () => copyText(monthlyJsonBox.textContent));

  btnMonthlyLoad.addEventListener("click", async () => {
    try {
      const r = await apiPost("monthly.get", {}, true);
      const p = r?.data || r;
      monthlyCache = p;

      mEnabled.checked = !!p?.enabled;
      mName.value = p?.name || "";
      mPercent.value = String(p?.percent ?? "");
      mMaxRp.value = String(p?.maxRp ?? "");
      mMaxUses.value = (p?.maxUses == null ? "" : String(p.maxUses));

      renderMonthlySummary(p);
      setMonthlyCurlJsonPreview();
      toastShow("Monthly loaded");
    } catch (e) {
      toastShow("Gagal load monthly: " + (e?.message || "error"), "warn");
    }
  });

  btnMonthlySave.addEventListener("click", async () => {
    const form = readMonthlyForm();
    const payload = {
      enabled: !!form.enabled,
      name: form.name || "PROMO BULANAN",
      percent: clamp(form.percent, 0, 100),
      maxRp: Math.max(0, Number(form.maxRp || 0)),
      ...(form.maxUses != null && Number.isFinite(form.maxUses) ? { maxUses: Number(form.maxUses) } : { maxUses: null }),
    };

    try {
      const r = await apiPost("monthly.set", payload, true);
      const p = r?.data || r;
      monthlyCache = p;
      renderMonthlySummary(p);
      setMonthlyCurlJsonPreview();
      toastShow("Monthly saved ✅");
    } catch (e) {
      toastShow("Gagal save: " + (e?.message || "error"), "warn");
    }
  });

  function monthlyUnlimitedAddCurl(deviceKey) {
    const host = getHostPlaceholder();
    const body = { addUnlimitedDeviceKey: String(deviceKey || "").trim() };
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=monthly.set" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  function monthlyUnlimitedRemoveCurl(deviceKey) {
    const host = getHostPlaceholder();
    const body = { removeUnlimitedDeviceKey: String(deviceKey || "").trim() };
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=monthly.set" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  btnCopyCurlUnlimitedAdd.addEventListener("click", () => {
    const dk = String(mDeviceKey.value || "").trim();
    copyText(monthlyUnlimitedAddCurl(dk || "<DEVICE_KEY_SHA256>"));
  });

  btnCopyCurlUnlimitedRemove.addEventListener("click", () => {
    const dk = String(mDeviceKey.value || "").trim();
    copyText(monthlyUnlimitedRemoveCurl(dk || "<DEVICE_KEY_SHA256>"));
  });

  btnUnlimitedAdd.addEventListener("click", async () => {
    const dk = String(mDeviceKey.value || "").trim();
    if (!dk) return toastShow("Isi deviceKey dulu", "warn");
    try {
      const r = await apiPost("monthly.set", { addUnlimitedDeviceKey: dk }, true);
      renderMonthlySummary(r?.data || r);
      toastShow("Unlimited added ✅");
    } catch (e) {
      toastShow("Gagal: " + (e?.message || "error"), "warn");
    }
  });

  btnUnlimitedRemove.addEventListener("click", async () => {
    const dk = String(mDeviceKey.value || "").trim();
    if (!dk) return toastShow("Isi deviceKey dulu", "warn");
    try {
      const r = await apiPost("monthly.set", { removeUnlimitedDeviceKey: dk }, true);
      renderMonthlySummary(r?.data || r);
      toastShow("Unlimited removed ✅");
    } catch (e) {
      toastShow("Gagal: " + (e?.message || "error"), "warn");
    }
  });

  // ====== tools ======
  function randId(len = 18) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "dev_";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(String(str || ""));
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function recomputeDeviceKey() {
    const deviceId = String(tDeviceId.value || "").trim();
    const pepper = String(tPepper.value || "").trim();
    if (!deviceId || !pepper) {
      tDeviceKey.value = "";
      return;
    }
    const dk = await sha256Hex(deviceId + "|" + pepper);
    tDeviceKey.value = dk;
    // prefill monthly field for convenience
    mDeviceKey.value = dk;
  }

  btnGenDeviceId.addEventListener("click", async () => {
    tDeviceId.value = randId(14);
    await recomputeDeviceKey();
    toastShow("DeviceId generated");
  });

  btnCopyDeviceKey.addEventListener("click", () => copyText(tDeviceKey.value || ""));

  tDeviceId.addEventListener("input", recomputeDeviceKey);
  tPepper.addEventListener("input", recomputeDeviceKey);

  function applyCurl(body) {
    const host = getHostPlaceholder();
    return [
      `curl -sS -X POST "${host}${API_PATH}?action=discount.apply" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify(body)}' | jq`,
    ].join("\n");
  }

  function setApplyPreview() {
    const amount = Number(tAmount.value || 0);
    const deviceId = String(tDeviceId.value || "").trim() || "dev_test_1";
    const voucher = String(tVoucher.value || "").trim();

    const body = { amount: Math.max(1, Number.isFinite(amount) ? amount : 1), deviceId, voucher };
    applyCurlBox.textContent = applyCurl(body);
    applyJsonBox.textContent = JSON.stringify(body, null, 2);
  }

  tAmount.addEventListener("input", setApplyPreview);
  tVoucher.addEventListener("input", setApplyPreview);
  tDeviceId.addEventListener("input", setApplyPreview);

  btnCopyCurlApply.addEventListener("click", () => copyText(applyCurlBox.textContent));
  btnCopyJsonApply.addEventListener("click", () => copyText(applyJsonBox.textContent));

  // ====== tutor ======
  function buildTutorText(helpJson) {
    const host = "$HOST";
    const lines = [];

    lines.push(`# LevPay Tutor (Termux)`);
    lines.push(`HOST="${host}"`);
    lines.push(``);
    lines.push(`## Public`);
    lines.push([
      `curl -sS -X POST "$HOST${API_PATH}?action=ping" | jq`,
      `curl -sS -X POST "$HOST${API_PATH}?action=help" | jq`,
      `curl -sS -X POST "$HOST${API_PATH}?action=discount.apply" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"amount":10000,"deviceId":"dev_demo_1","voucher":"VIPL"}' | jq`,
    ].join("\n"));

    lines.push(``);
    lines.push(`## Admin (butuh X-Admin-Key)`);
    lines.push([
      `# list vouchers`,
      `curl -sS -X POST "$HOST${API_PATH}?action=voucher.list" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" | jq`,
      ``,
      `# upsert voucher`,
      `curl -sS -X POST "$HOST${API_PATH}?action=voucher.upsert" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '{"code":"VIPL","name":"VIPL","percent":60,"maxRp":0,"maxUses":null,"enabled":true,"expiresAt":null}' | jq`,
      ``,
      `# disable voucher`,
      `curl -sS -X POST "$HOST${API_PATH}?action=voucher.disable" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '{"code":"VIPL"}' | jq`,
      ``,
      `# monthly get`,
      `curl -sS -X POST "$HOST${API_PATH}?action=monthly.get" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" | jq`,
      ``,
      `# monthly set (+ maxUses)`,
      `curl -sS -X POST "$HOST${API_PATH}?action=monthly.set" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '{"enabled":true,"name":"PROMO BULANAN","percent":10,"maxRp":5000,"maxUses":100}' | jq`,
      ``,
      `# unlimited add deviceKey`,
      `curl -sS -X POST "$HOST${API_PATH}?action=monthly.set" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "X-Admin-Key: <ADMIN_KEY>" \\`,
      `  -d '{"addUnlimitedDeviceKey":"<SHA256_DEVICE_KEY>"}' | jq`,
    ].join("\n"));

    if (helpJson?.actions && Array.isArray(helpJson.actions)) {
      lines.push(``);
      lines.push(`## Actions (detected)`);
      lines.push(helpJson.actions.map((x) => `- ${x}`).join("\n"));
    }

    return lines.join("\n");
  }

  btnTutorRefresh.addEventListener("click", async () => {
    try {
      const r = await apiPost("help", {}, false);
      tutorBox.textContent = buildTutorText(r);
      toastShow("Tutor updated");
    } catch {
      tutorBox.textContent = buildTutorText(null);
      toastShow("Tutor fallback");
    }
  });

  btnCopyTutor.addEventListener("click", () => copyText(tutorBox.textContent));

  // ====== boot ======
  async function boot() {
    // initial previews
    setVoucherCurlJsonPreview();
    setMonthlyCurlJsonPreview();
    setApplyPreview();

    // load voucher list & monthly
    await refreshVouchers();
    await btnMonthlyLoad.click?.();

    // ping
    await btnPing.click?.();
  }

  // ====== init ======
  (function init() {
    const k = loadKey();
    if (k) {
      showLock(false);
      boot().catch(() => {});
    } else {
      showLock(true);
    }

    btnUnlock.addEventListener("click", unlockFlow);
    adminKeyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") unlockFlow();
    });

    // default tab
    setTab("vouchers");

    // tutor default content
    tutorBox.textContent = buildTutorText(null);
  })();
})();

/* ====== small UI-only CSS injected via JS for row actions badges ====== */
(() => {
  const style = document.createElement("style");
  style.textContent = `
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace; font-weight: 900; }
    .miniAction{ margin-top: 6px; display:flex; gap: 6px; flex-wrap: wrap; }
    .miniBtn{
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      color: rgba(255,255,255,.88);
      padding: 7px 9px;
      font-weight: 900;
      font-size: 12px;
      cursor:pointer;
      transition: transform .12s ease, border-color .12s ease, background .12s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .miniBtn:active{ transform: scale(.98); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.18); }
    .miniBtn--primary{
      color:#061022;
      background: linear-gradient(90deg, rgba(124,58,237,1), rgba(34,211,238,1));
      border-color: transparent;
    }
    .miniBtn--danger{
      color: rgba(255,255,255,.95);
      background: rgba(239,68,68,.16);
      border-color: rgba(239,68,68,.35);
    }
    .badge{
      display:inline-flex; align-items:center; justify-content:center;
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 900;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.04);
    }
    .badge--on{
      background: rgba(34,197,94,.12);
      border-color: rgba(34,197,94,.35);
      color: rgba(209,255,224,.95);
    }
    .badge--off{
      background: rgba(239,68,68,.12);
      border-color: rgba(239,68,68,.30);
      color: rgba(255,235,235,.92);
    }
  `;
  document.head.appendChild(style);
})();