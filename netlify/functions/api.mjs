import { getStore } from "@netlify/blobs";
import seed from "../../data/viagem.json" with { type: "json" };

// One invite code for the family (env KEY_WILDERS, never in the repo). Without it the API answers nothing.
console.log(`invite code configured: ${process.env.KEY_WILDERS ? "yes" : "no"}`);
const authed = (req) => !!process.env.KEY_WILDERS && req.headers.get("x-key") === process.env.KEY_WILDERS;

// Each collection is one blob ({ id: item }), so a full state read is a handful of gets.
const COLLS = ["dias", "pernoites", "trilhas", "checklist", "pendencias", "custos", "hoteis"];
const ID_RE = /^[A-Za-z0-9_\-.]{1,60}$/;
const store = () => getStore({ name: "wilders", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const people = (cfg) => (cfg && Array.isArray(cfg.pessoas) && cfg.pessoas.length ? cfg.pessoas : seed.config.pessoas);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// "curtidas.Alan": true sets one nested field, so two people liking at once do not overwrite each other
function merge(cur, data) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(data)) {
    const parts = k.split(".");
    if (parts.length === 1) { next[k] = v; continue; }
    let o = next;
    for (const p of parts.slice(0, -1)) { o[p] = isObj(o[p]) ? { ...o[p] } : {}; o = o[p]; }
    const last = parts[parts.length - 1];
    if (v === null) delete o[last]; else o[last] = v;
  }
  return next;
}

// file shape (arrays) -> stored shape (maps by id)
function toStored(d) {
  const out = { config: isObj(d.config) ? d.config : {} };
  for (const c of COLLS) {
    const m = {};
    for (const it of Array.isArray(d[c]) ? d[c] : []) if (isObj(it) && ID_RE.test(String(it.id || ""))) m[it.id] = it;
    out[c] = m;
  }
  return out;
}

async function writeAll(s, stored) {
  await Promise.all([s.setJSON("config", stored.config), ...COLLS.map((c) => s.setJSON(`col/${c}`, stored[c]))]);
}

async function readAll(s) {
  const [config, log, ...cols] = await Promise.all([
    s.get("config", { type: "json" }), s.get("log", { type: "json" }),
    ...COLLS.map((c) => s.get(`col/${c}`, { type: "json" })),
  ]);
  return { config, log, cols };
}

async function state() {
  const s = store();
  let { config, log, cols } = await readAll(s);
  if (!config) {
    await writeAll(s, toStored(seed));
    await s.setJSON("meta/seeded", { at: Date.now(), versao: seed.versao });
    ({ config, log, cols } = await readAll(s));
  }
  const out = { config: config || {}, log: (log || []).slice(0, 60) };
  COLLS.forEach((c, i) => { out[c] = Object.values(cols[i] || {}); });
  return json(out);
}

async function addLog(s, who, txt) {
  if (!txt) return;
  const log = (await s.get("log", { type: "json" })) || [];
  log.unshift({ id: rid(), who, txt: String(txt).slice(0, 200), at: Date.now() });
  await s.setJSON("log", log.slice(0, 80));
}

async function write(req) {
  const body = await req.json().catch(() => null);
  if (!body || JSON.stringify(body).length > 200000) return json({ error: "bad request" }, 400);
  const { op, coll, id, data, who, log } = body;
  const s = store();
  const config = (await s.get("config", { type: "json" })) || {};
  if (!people(config).includes(who)) return json({ error: "bad name" }, 400);

  if (coll === "config") {
    if (op !== "update" || !isObj(data)) return json({ error: "bad op" }, 400);
    await s.setJSON("config", merge(config, data));
  } else {
    if (!COLLS.includes(coll) || !ID_RE.test(String(id || ""))) return json({ error: "bad path" }, 400);
    const key = `col/${coll}`;
    const items = (await s.get(key, { type: "json" })) || {};
    if (op === "set") {
      if (!isObj(data)) return json({ error: "bad data" }, 400);
      items[id] = { ...data, id };
    } else if (op === "update") {
      if (!isObj(data)) return json({ error: "bad data" }, 400);
      if (!items[id]) return json({ error: "not found" }, 404);
      items[id] = { ...merge(items[id], data), id };
    } else if (op === "delete") {
      delete items[id];
    } else return json({ error: "bad op" }, 400);
    await s.setJSON(key, items);
  }
  await addLog(s, who, log);
  return json({ ok: true });
}

// Replace everything with an uploaded file (same shape as data/viagem.json). The current data is kept as a backup first.
async function importData(req) {
  const body = await req.json().catch(() => null);
  if (!body || !isObj(body.dados) || !isObj(body.dados.config) || !Array.isArray(body.dados.dias)) return json({ error: "arquivo inválido" }, 400);
  if (!people(body.dados.config).includes(body.who)) return json({ error: "bad name" }, 400);
  const s = store();
  const cur = await readAll(s);
  if (cur.config) {
    const backup = { config: cur.config };
    COLLS.forEach((c, i) => { backup[c] = Object.values(cur.cols[i] || {}); });
    await s.setJSON(`backup/${Date.now()}`, backup);
  }
  await writeAll(s, toStored(body.dados));
  await addLog(s, body.who, "carregou um arquivo de dados novo");
  return json({ ok: true });
}

async function uploadPhoto(req) {
  const type = req.headers.get("content-type") || "";
  if (!type.startsWith("image/")) return json({ error: "images only" }, 400);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 4.5 * 1024 * 1024) return json({ error: "too big" }, 413);
  const id = rid();
  await store().set(`photos/${id}`, buf, { metadata: { type } });
  return json({ id, url: `/api/photo/${id}` });
}

async function getPhoto(id) {
  if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = await store().getWithMetadata(`photos/${id}`, { type: "arrayBuffer" });
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(r.data, {
    headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  try {
    // photos load in <img> tags, which cannot send the code; their ids are random
    if (req.method === "GET" && path.startsWith("photo/")) return await getPhoto(path.slice(6));
    if (!authed(req)) return json({ error: "sem código" }, 401);
    if (req.method === "GET" && path === "state") return await state();
    if (req.method === "POST" && path === "write") return await write(req);
    if (req.method === "POST" && path === "import") return await importData(req);
    if (req.method === "POST" && path === "photo") return await uploadPhoto(req);
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
};

export const config = { path: "/api/*" };
