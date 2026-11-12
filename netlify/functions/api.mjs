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

// One-time (meta/atividades-v1): activities get a status and carry their own price; the cost lines they replace
// are only marked (substituidoPor), never deleted, so an older copy of the app still adds up the same total.
const MIGRA_ATIV = [["rafting", "t-rafting"], ["payunia-guia", "t-volcanes"], ["llancanelo", "t-llancanelo"], ["cacheuta", "t-cacheuta"],
  ["aconcagua", "t-horcones"], ["inca", "t-inca"], ["payunia-parque", "t-payunia-parque"]];
// original group totals that are really per person; an edited line keeps its own value as a group price
const POR_PESSOA = { rafting: [525, "BRL", 175], cacheuta: [210, "BRL", 70], aconcagua: [165000, "ARS", 55000], inca: [30000, "ARS", 10000] };
async function migrateAtividades(s) {
  const [trilhas, custos] = await Promise.all([s.get("col/trilhas", { type: "json" }), s.get("col/custos", { type: "json" })]);
  const tr = trilhas || {}, cu = custos || {};
  for (const t of Object.values(tr)) if (!t.status) t.status = "roteiro";
  for (const [cid, tid] of MIGRA_ATIV) {
    const c = cu[cid];
    if (!c || c.substituidoPor) continue;
    let t = tr[tid];
    if (!t && tid === "t-payunia-parque") t = tr[tid] = { id: tid, tipo: "outro", nome: "La Payunia: tarifa do parque", onde: "La Payunia", km: "", desnivel: "", tempo: "",
      nivel: 0, quem: "todos", leve: "", obs: "Paga uma vez por veículo.", dia: "d25", status: "roteiro" };
    if (!t) continue;
    if (t.preco == null || t.preco === "") {
      const pp = POR_PESSOA[cid];
      if (pp && +c.valor === pp[0] && (c.moeda || "BRL") === pp[1]) Object.assign(t, { preco: pp[2], moeda: pp[1], base: "pessoa", qtd: null });
      else Object.assign(t, { preco: c.valor ?? null, moeda: c.moeda || "BRL", base: "grupo" });
      Object.assign(t, { pago: !!c.pago, precoNota: c.nota || "" });
    }
    cu[cid] = { ...c, substituidoPor: tid };
  }
  await Promise.all([s.setJSON("col/trilhas", tr), s.setJSON("col/custos", cu)]);
  await s.setJSON("meta/atividades-v1", { at: Date.now() });
}

// One-time (meta/situacao-v1): each stay gets three separate facts instead of the old single "status":
// politica (reserva | chegada | confirmar), situacao (nao | aguardando | concluida) and pagStatus (nao | parcial | pago),
// plus proximaAcao, regra and fonte. New fields are only filled when absent; old text is only replaced while it still
// equals what the app first shipped with, so anything the family edited stays. A full backup is written first.
const SITUACAO = {
  suizo: { politica: "chegada", situacao: "aguardando", pagStatus: "nao",
    proximaAcao: "Consultar vaga poucos dias antes de 21/12 e de 1/1. Mensagem enviada ao novo contato; aguardando retorno desde 11/11.",
    regra: "Não aceita reserva: a vaga se consulta poucos dias antes. A indicação antiga de que em 1/1 costuma ter vaga depois das 20h precisa ser revalidada; não é garantia.",
    fonte: "Resposta do camping em 6/10" },
  rincon: { politica: "confirmar", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Perguntar de novo, uma pergunta por vez: precisa reservar? Tem vaga em 22 e 23/12? Aceita a Hilux com cabine camper?",
    regra: "Regra de reserva, vaga, datas e Hilux ainda a confirmar. Pagar em dinheiro ou transferência no local não prova que dispensa reserva, e o \"Exacto\" não respondeu cada pergunta separadamente.",
    fonte: "WhatsApp de 11/11" },
  pincheira: { politica: "confirmar", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Confirmar com o próprio local: abre no Natal (24/12)? Tem vaga? Precisa reservar?",
    regra: "A abertura em 24/12 veio de um diretório, não do operador.",
    fonte: "Diretório de campings (não é o operador)" },
  payunia: { politica: "reserva", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Reservar e pagar o acampe no turnero ANP (actividadesanp.mendoza.gov.ar).",
    regra: "Dormir no camper no acampe não exige guia. Vagas de dezembro não confirmadas: o turnero abre mês a mês, e consultar em 1/12 não garante que dezembro já esteja liberado nessa data.",
    fonte: "Turismo Malargüe, 11/11" },
  llancanelo: { politica: "reserva", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Reservar e pagar o acampe no turnero ANP (actividadesanp.mendoza.gov.ar).",
    regra: "Dormir no camper no acampe não exige guia. Visitar o interior da reserva exige turno e guia contratado antes; o percurso autoguiado pela Ruta 186 fica fora da reserva. Vagas de dezembro não confirmadas: o turnero abre mês a mês.",
    fonte: "Turismo Malargüe, 11/11" },
  bosquecito: { politica: "chegada", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Confirmar o preço de dezembro, a forma de pagamento e os serviços para a Hilux (a tabela em PDF só vale até 30/11).",
    regra: "Sem reserva, por ordem de chegada. Vaga não garantida.",
    fonte: "E-mail de 11/11" },
  ranquil: { politica: "chegada", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Nada a reservar: chegar e acertar no local. Ainda vale perguntar sobre o despejo.",
    regra: "Sem reserva: chegar e acertar no local. Vaga específica não garantida.",
    fonte: "Contato de 11/11" },
  tipi: { politica: "reserva", situacao: "aguardando", pagStatus: "nao",
    proximaAcao: "Cobrar de Martín os detalhes por escrito que ele prometeu e confirmar as duas noites (30 e 31/12), o preço, os serviços e o sinal.",
    regra: "Reserva a combinar com Martín; nada foi concluído. Os 20% de sinal são referência de outubro, não condição atual confirmada.",
    fonte: "Áudio de Martín, 11/11 (prometeu os detalhes por escrito)" },
  hotel: { politica: "reserva", situacao: "nao", pagStatus: "nao",
    proximaAcao: "Escolher uma opção na aba Hotel e reservar.", regra: "", fonte: "" },
};
// [current value as first shipped, replacement]
const TEXTO_ANTIGO = {
  pernoites: {
    tipi: { obs: ["Falar com Martin, o dono. Vaga confirmada para 30 e 31/12. Área de motorhome, água quente e acesso à cozinha. Sem chuveiro.",
                  "Falar com Martín, o dono. Área de motorhome, água quente e acesso à cozinha. Sem chuveiro."],
            pagamento: ["Sem cartão. Sinal de 20%", "Sem cartão"] },
    ranquil: { pagamento: ["A confirmar", "Dinheiro ou transferência, no local"], horario: ["A confirmar", "Diária das 11h às 11h"] },
    payunia: { obs: ["Área protegida, sem nenhum serviço. Guia obrigatório, agendado com a Municipalidade de Malargüe (telefone acima). Levar todo o lixo.",
                     "Área protegida, sem nenhum serviço. Levar todo o lixo. O telefone é da Municipalidade de Malargüe, que agenda guias para os passeios."] },
    pincheira: { obs: ["Abre em 24/12. 27 km de ripio. Banheiros, chuveiro quente, tomada, parrilla, piscinas, mercado e restaurante. Despejo crítico: se não tiver, usar posto em Malargüe.",
                       "27 km de ripio. Banheiros, chuveiro quente, tomada, parrilla, piscinas, mercado e restaurante. Despejo crítico: se não tiver, usar posto em Malargüe."] },
  },
  dias: {
    d25: { fazer: ["Circuito Los Volcanes com guia habilitado. Noite no acampe da seccional.",
                   "Noite no acampe da seccional La Amarga (dormir no camper não exige guia). O circuito Los Volcanes é opcional."] },
    d26: { fazer: ["Circuito parcial autoguiado (Pozos de Carpacho e Volcán Trapal). Flamingos.",
                   "Noite no acampe da seccional El Sauce. Visitar o interior da reserva só com turno e guia contratado antes."] },
  },
  pendencias: {
    p5: { titulo: ["Cotar o guia da Payunia e reservar o acampe", "Reservar e pagar o acampe de La Amarga (Payunia)"],
          detalhe: ["Guia com a Municipalidade de Malargüe, (260) 4471659. Turno do acampe na Seccional La Amarga pelo portal.",
                    "No turnero ANP (actividadesanp.mendoza.gov.ar). Dormir no camper não exige guia. O guia só entra se escolhermos o circuito Los Volcanes."] },
    p6: { titulo: ["Reservar o turno do acampe no Llancanelo", "Reservar e pagar o acampe de El Sauce (Llancanelo)"],
          detalhe: ["Pelo portal actividadesanp.mendoza.gov.ar.", "No turnero ANP (actividadesanp.mendoza.gov.ar). O turnero abre mês a mês."] },
    p8: { titulo: ["Reservar Pincheira e confirmar o despejo", "Pincheira: confirmar abertura em 24/12, vaga, regra de reserva e despejo"] },
    p9: { titulo: ["Reservar o camping do Atuel", "Rincón: confirmar regra de reserva, vaga, datas e Hilux"],
          detalhe: ["Rincón de la Ensenada ou uma das alternativas.", "Perguntar uma coisa por vez. Se não der, ver as alternativas no Rincón."] },
    p10: { titulo: ["Reservar Ranquil Luncay e confirmar o despejo", "Luncay: perguntar sobre o despejo (sem reserva)"] },
    p7: { detalhe: ["Só cartão e com antecedência: o parque não vende na hora.",
                    "Turno online antecipado, pago por cupom (Pago Fácil ou Mercado Pago). Não vendem na entrada."] },
    p11: { detalhe: ["ARS 13.000 por adulto é por dia ou por noite?", "Valor de dezembro pendente: a tabela em PDF só vale até 30/11."] },
  },
  checklist: {
    c7: { texto: ["Cartão de crédito (o Aconcágua só aceita cartão)", "Cartão de crédito"] },
  },
};
async function migrateSituacao(s) {
  const cur = await readAll(s);
  const backup = { config: cur.config, motivo: "antes de meta/situacao-v1" };
  COLLS.forEach((c, i) => { backup[c] = Object.values(cur.cols[i] || {}); });
  await s.setJSON(`backup/${Date.now()}`, backup);
  const col = Object.fromEntries(COLLS.map((c, i) => [c, cur.cols[i] || {}]));
  const absent = (v) => v === undefined || v === null || v === "";
  for (const [id, f] of Object.entries(SITUACAO)) {
    const p = col.pernoites[id];
    if (!p) continue;
    for (const [k, v] of Object.entries(f)) if (absent(p[k]) && v !== "") p[k] = v;
  }
  for (const [c, byId] of Object.entries(TEXTO_ANTIGO))
    for (const [id, fields] of Object.entries(byId)) {
      const it = col[c][id];
      if (!it) continue;
      for (const [k, [old, next]] of Object.entries(fields)) if (it[k] === old) it[k] = next;
    }
  await Promise.all(["pernoites", "dias", "pendencias", "checklist"].map((c) => s.setJSON(`col/${c}`, col[c])));
  await s.setJSON("meta/situacao-v1", { at: Date.now() });
}

async function state() {
  const s = store();
  let { config, log, cols } = await readAll(s);
  if (!config) {
    await writeAll(s, toStored(seed));
    await s.setJSON("meta/seeded", { at: Date.now(), versao: seed.versao });
    await s.setJSON("meta/atividades-v1", { at: Date.now(), seed: true });
    await s.setJSON("meta/situacao-v1", { at: Date.now(), seed: true });
    ({ config, log, cols } = await readAll(s));
  } else {
    let changed = false;
    if (!(await s.get("meta/atividades-v1", { type: "json" }))) { await migrateAtividades(s); changed = true; }
    if (!(await s.get("meta/situacao-v1", { type: "json" }))) { await migrateSituacao(s); changed = true; }
    if (changed) ({ config, log, cols } = await readAll(s));
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
