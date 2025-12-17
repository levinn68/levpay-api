// lib/github.js
const axios = require("axios");

const GH_OWNER = process.env.GH_OWNER || "";
const GH_REPO = process.env.GH_REPO || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";
const GH_PATH = process.env.GH_PATH || "database.json";
const GH_TOKEN = process.env.GH_TOKEN || "";

function must(v, name) {
  if (!v) throw new Error(`${name} not set`);
  return v;
}

function apiBase() {
  must(GH_OWNER, "GH_OWNER");
  must(GH_REPO, "GH_REPO");
  must(GH_TOKEN, "GH_TOKEN");
  return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
}

async function loadDb() {
  const url = `${apiBase()}?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    },
    validateStatus: () => true,
    timeout: 20000,
  });

  if (r.status === 404) {
    return { vouchers: {}, promo: {}, tx: {} };
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`GitHub load failed (${r.status})`);
  }

  const contentB64 = r.data?.content || "";
  const text = Buffer.from(contentB64, "base64").toString("utf8");
  let json = {};
  try { json = JSON.parse(text || "{}"); } catch { json = {}; }

  json._sha = r.data?.sha;
  json.vouchers = json.vouchers || {};
  json.promo = json.promo || {};
  json.tx = json.tx || {};
  return json;
}

async function saveDb(db) {
  const sha = db._sha;
  const copy = { ...db };
  delete copy._sha;

  const body = {
    message: `update ${GH_PATH}`,
    content: Buffer.from(JSON.stringify(copy, null, 2)).toString("base64"),
    branch: GH_BRANCH,
    ...(sha ? { sha } : {}),
  };

  const r = await axios.put(apiBase(), body, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    },
    validateStatus: () => true,
    timeout: 20000,
  });

  if (r.status < 200 || r.status >= 300) throw new Error(`GitHub save failed (${r.status})`);
  return true;
}

module.exports = { loadDb, saveDb };
