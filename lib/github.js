const axios = require("axios");

function b64(s) {
  return Buffer.from(String(s || ""), "utf8").toString("base64");
}

function fromB64(s) {
  return Buffer.from(String(s || ""), "base64").toString("utf8");
}

function ghHeaders() {
  const t = process.env.GH_TOKEN || "";
  const h = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "levpay-voucher-bot",
  };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function ghBase() {
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  if (!owner || !repo) throw new Error("GH_OWNER/GH_REPO belum di-set");
  return `https://api.github.com/repos/${owner}/${repo}`;
}

function ghRef() {
  return process.env.GH_BRANCH || "main";
}

function ghPath() {
  return process.env.GH_PATH || "database.json";
}

async function readJsonFile() {
  const url = `${ghBase()}/contents/${encodeURIComponent(ghPath())}?ref=${encodeURIComponent(ghRef())}`;
  const r = await axios.get(url, { headers: ghHeaders(), timeout: 20000, validateStatus: () => true });

  if (r.status === 404) {
    return { json: null, sha: null, exists: false };
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GitHub read failed: ${r.status} ${JSON.stringify(r.data || {})}`);
  }

  const content = r.data?.content;
  const sha = r.data?.sha || null;
  const txt = content ? fromB64(content.replace(/\n/g, "")) : "{}";

  let json;
  try { json = JSON.parse(txt); } catch { json = {}; }

  return { json, sha, exists: true };
}

async function writeJsonFile(nextJson, prevSha, message) {
  const token = process.env.GH_TOKEN || "";
  if (!token) throw new Error("GH_TOKEN kosong (ga bisa write ke GitHub)");

  const url = `${ghBase()}/contents/${encodeURIComponent(ghPath())}`;
  const body = {
    message: message || "update database.json",
    content: b64(JSON.stringify(nextJson, null, 2)),
    branch: ghRef(),
  };
  if (prevSha) body.sha = prevSha;

  const r = await axios.put(url, body, {
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    timeout: 25000,
    validateStatus: () => true,
  });

  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GitHub write failed: ${r.status} ${JSON.stringify(r.data || {})}`);
  }

  return r.data;
}

module.exports = {
  readJsonFile,
  writeJsonFile,
};
