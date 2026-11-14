// Acesso aos dados. Tudo que já está no cache é lido como arquivo estático, então
// os alvos de exemplo funcionam mesmo sem a API (ou em hospedagem estática).
export const cubeKey = (ra, dec, fov, band) =>
  `r${ra.toFixed(4)}_d${dec >= 0 ? '+' : ''}${dec.toFixed(4)}_f${fov.toFixed(1)}_${band}`;

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* resposta sem JSON */ }
    throw new Error(msg);
  }
  return r.json();
}

const memo = new Map();   // chave -> {meta, cube}

async function readCached(key) {
  const meta = await getJSON(`data/cache/${key}/meta.json`);
  // o parâmetro v muda quando o cubo é refeito, então o cache do navegador nunca fica velho
  const buf = await (await fetch(`data/cache/${key}/cube.f32?v=${encodeURIComponent(meta.created)}`)).arrayBuffer();
  return { meta, cube: new Float32Array(buf) };
}

/** Carrega o cubo; se não existir, pede para a API montar e acompanha o progresso. */
export async function loadCube(ra, dec, fov, band, onProgress = () => {}, signal) {
  const key = cubeKey(ra, dec, fov, band);
  if (memo.has(key)) return memo.get(key);
  let data;
  try { data = await readCached(key); } catch {
    for (;;) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      let st;
      try { st = await getJSON(`api/cube?ra=${ra}&dec=${dec}&fov=${fov}&band=${band}`, { signal }); } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new Error(e instanceof TypeError
          ? 'Servidor de dados fora do ar. Os alvos de exemplo continuam funcionando.' : e.message);
      }
      if (st.status === 'ready') break;
      if (st.status === 'error') throw new Error(st.error);
      onProgress(st.done, st.total);
      await new Promise((r) => setTimeout(r, 1200));
    }
    data = await readCached(key);
  }
  if (memo.size > 8) memo.delete(memo.keys().next().value);  // limita a memória usada
  memo.set(key, data);
  return data;
}

export async function loadFlags(meta) {
  const r = await fetch(`data/cache/${meta.key}/flags.i32?v=${encodeURIComponent(meta.created)}`);
  if (!r.ok) throw new Error('flags indisponíveis');
  return new Int32Array(await r.arrayBuffer());
}

export async function loadCatalog(ra, dec, fov, cat) {
  const file = `data/catalogs/${cat}_r${ra.toFixed(4)}_d${dec >= 0 ? '+' : ''}${dec.toFixed(4)}_f${fov.toFixed(1)}.json`;
  try { return await getJSON(file); } catch { return getJSON(`api/catalog?ra=${ra}&dec=${dec}&fov=${fov}&cat=${cat}`); }
}

export const resolveName = (name) => getJSON(`api/resolve?name=${encodeURIComponent(name)}`);
export const loadTargets = () => getJSON('data/targets.json');
export const loadSky = () => getJSON('data/sky.json');
export const loadRegions = () => getJSON('api/regions');
export const loadCandidates = (region) => getJSON(`data/candidates/${region}.json`);

// ---- apelido, votos e marcações (API quando existe; senão ficam só no navegador)
export const getNick = () => localStorage.getItem('spx_nick') || '';
export const setNick = (n) => localStorage.setItem('spx_nick', n.trim().slice(0, 24));
const local = (k, v) => (v === undefined ? JSON.parse(localStorage.getItem(k) || '[]') : localStorage.setItem(k, JSON.stringify(v)));

function summarize(votes) {
  const candidates = {}, rank = {};
  for (const v of votes) {
    const c = candidates[v.candidate] ||= { move: 0, nao_move: 0, defeito: 0, first: v.nickname, voters: {} };
    c[v.label]++; c.voters[v.nickname] = v.label; rank[v.nickname] = (rank[v.nickname] || 0) + 1;
  }
  return { candidates, ranking: Object.entries(rank).sort((a, b) => b[1] - a[1]), offline: true };
}

export async function getVotes() {
  try { return await getJSON('api/votes'); } catch { return summarize(local('spx_votes')); }
}
export async function sendVote(candidate, label) {
  const nickname = getNick();
  try {
    return await getJSON('api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate, nickname, label }) });
  } catch {
    const votes = local('spx_votes').filter((v) => !(v.candidate === candidate && v.nickname === nickname));
    votes.push({ candidate, nickname, label, ts: Date.now() });
    local('spx_votes', votes);
    return summarize(votes);
  }
}
// ---- quem está online: um id aleatório por navegador (não identifica ninguém) e o apelido, se houver
export function sessionId() {
  let id = null;
  try { id = localStorage.getItem('spx_sid'); } catch { /* sem armazenamento: id só desta aba */ }
  if (!id) {
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9-]/g, '');
    try { localStorage.setItem('spx_sid', id); } catch { /* idem */ }
  }
  return id;
}
/** Avisa que esta aba está aberta e devolve quem está online (só você, se a API não existir). */
export async function ping() {
  const me = { id: sessionId(), nickname: getNick() };
  try {
    return await getJSON('api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(me) });
  } catch { return [me]; }
}
export async function getMarks() {
  try { return await getJSON('api/marks'); } catch { return local('spx_marks'); }
}
export async function sendMark(mark) {
  const m = { ...mark, nickname: getNick() };
  try {
    await getJSON('api/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
  } catch {
    local('spx_marks', [...local('spx_marks'), { ...m, date: new Date().toISOString() }]);
  }
}
