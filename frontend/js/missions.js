// Modo missões: estado do jogador e chamadas à API. Sem a API (hospedagem estática), tudo roda
// no navegador com o progresso no localStorage. As regras espelham backend/game.py.
import { sessionId, getNick } from './api.js';

const KEY = 'spx_game';
let state = null;          // última visão do jogador (mesmo formato de GET /api/player)
let offline = false;
let missionsFile = null;   // só no modo offline (contém as respostas)
const listeners = new Set();

export const isOffline = () => offline;
export const get = () => state;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) try { fn(state); } catch (e) { console.warn(e); } }

async function call(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (r.status === 404 && !body) throw new TypeError('sem API');
  let data = null;
  try { data = await r.json(); } catch { throw new TypeError('sem API'); }
  if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
  return data;
}
const who = () => ({ sid: sessionId(), nickname: getNick() });

// ------------------------------------------------------------------ modo offline
const level = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
const defaultSat = () => ({ name: '', shield: '#c9ccd4', emblem: null, trail: '#ffd166', panel: false, gold: false, owned: [] });
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function saveLocal(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sem armazenamento */ } }
function localPlayer() {
  return { xp: 0, credits: 0, sat: defaultSat(), extra: [], active: null, progress: {}, regions: {}, marks: 0, ...loadLocal() };
}
const findM = (id) => missionsFile.missions.find((m) => m.id === id);
const actDone = (act, done) => missionsFile.missions.filter((m) => m.act === act).every((m) => done.has(m.id));
function lockedReason(m, done, lvl) {
  for (const r of m.requires || []) if (!done.has(r)) return `Faça antes: ${findM(r)?.title || r}`;
  if (m.act > 1 && !actDone(m.act - 1, done) && lvl < 2 + m.act) return `Termine o ato ${m.act - 1} ou chegue ao nível ${2 + m.act}`;
  return null;
}
function viewLocal(p) {
  const done = new Set(Object.keys(p.progress).filter((k) => p.progress[k].status === 'done'));
  const lvl = level(p.xp);
  const badges = missionsFile.acts.filter((a) => actDone(a.act, done)).map((a) => `act${a.act}`).concat([...p.extra].sort());
  return {
    sid: sessionId(), nickname: getNick(), xp: p.xp, level: lvl, next_level_xp: 100 * lvl * lvl, level_xp: 100 * (lvl - 1) ** 2,
    credits: p.credits, sat: { ...defaultSat(), ...p.sat }, badges, active: p.active, acts: missionsFile.acts, shop: missionsFile.shop,
    missions: missionsFile.missions.map(({ check, ref, explain, ...m }) => {
      const pr = p.progress[m.id] || {};
      const it = { ...m, status: pr.status || 'open', locked: lockedReason(findM(m.id), done, lvl) };
      if (pr.status === 'done') Object.assign(it, { answer: pr.answer, score: pr.score, done_ts: pr.ts, ref, explain });
      return it;
    }),
  };
}
const inRange = (v, lo, hi) => v != null && v >= lo && v <= hi;
function angleIn(pa, lo, hi) {
  if (pa == null) return false;
  pa = ((pa % 360) + 360) % 360;
  return lo <= hi ? pa >= lo && pa <= hi : pa >= lo || pa <= hi;
}
function checkLocal(m, a, ctx) {
  const c = m.check || {}, n = (k) => (typeof a[k] === 'number' ? a[k] : null);
  if (m.target && a.target !== m.target) return { ok: false, score: 0, detail: 'Este relatório é de outro alvo. Abra o alvo da missão e meça de novo.' };
  if (m.kind === 'measure_motion') {
    const pm = n('pm'), pa = n('pa'), [lo, hi] = c.pm_arcsec_yr;
    if (inRange(pm, lo, hi) && angleIn(pa, ...c.pa_deg)) return { ok: true, score: 100, detail: `Medida aceita: ${String(pm.toFixed(1)).replace('.', ',')}″/ano a ${Math.round(pa)}°.` };
    return { ok: false, score: 0, detail: `Fora da faixa: ${pm == null ? 'faltou a velocidade' : `${String(pm.toFixed(1)).replace('.', ',')}″/ano (esperado ${String(lo).replace('.', ',')} a ${hi})`}, direção ${pa == null ? '?' : Math.round(pa) + '°'}.` };
  }
  if (m.kind === 'measure_variability') {
    if (c.band && a.band !== c.band) return { ok: false, score: 0, detail: `Meça na banda ${c.band} (você mediu na ${a.band || '?'}).` };
    const v = n('var_pct');
    return v != null && v >= c.min_pct ? { ok: true, score: 100, detail: `Variação aceita: ${Math.round(v)}%.` }
      : { ok: false, score: 0, detail: `Fora da faixa: ${Math.round(v || 0)}% é menos que os ${c.min_pct}% esperados.` };
  }
  if (m.kind === 'pick_band') return a.band === c.band ? { ok: true, score: 100, detail: `Isso: banda ${c.band}.` } : { ok: false, score: 0, detail: `Na banda ${a.band || '?'} o objeto não aparece bem. Tente outra.` };
  if (m.kind === 'explore') {
    const k = c.example ? ctx.ex : ctx.novo;
    if (k < c.n) return { ok: false, score: 0, detail: `Regiões abertas: ${k} de ${c.n}.` };
    if (c.mark && ctx.marks < 1) return { ok: false, score: 0, detail: 'Falta marcar um candidato.' };
    return { ok: true, score: 100, detail: 'Missão cumprida.' };
  }
  if (m.kind === 'classify') {
    if (ctx.votes < c.n) return { ok: false, score: 0, detail: `Classificados: ${ctx.votes} de ${c.n}.` };
    return { ok: true, score: 100, detail: `${ctx.votes} classificações (participação).` };
  }
  if (m.kind === 'consensus') return { ok: false, score: 0, detail: 'Consenso precisa de outros jogadores, e isso só existe com o servidor.' };
  return { ok: false, score: 0, detail: 'Tipo de missão desconhecido.' };
}

// ------------------------------------------------------------------ API pública
export async function load() {
  try {
    state = await call(`api/player?sid=${encodeURIComponent(sessionId())}&nickname=${encodeURIComponent(getNick())}`);
    offline = false;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    offline = true;
    missionsFile ||= await (await fetch('data/missions.json')).json();
    state = viewLocal(localPlayer());
  }
  emit();
  return state;
}

export async function accept(id) {
  if (!offline) state = await call('api/mission/accept', { ...who(), mission: id });
  else {
    const p = localPlayer(), v = viewLocal(p), m = v.missions.find((x) => x.id === id);
    if (m.locked) throw new Error(m.locked);
    if (m.status !== 'done') p.progress[id] = { status: 'accepted', ts: Date.now() / 1000 };
    p.active = id; saveLocal(p); state = viewLocal(p);
  }
  emit();
  return state;
}

export async function abandon() {
  if (!offline) state = await call('api/mission/abandon', who());
  else { const p = localPlayer(); p.active = null; saveLocal(p); state = viewLocal(p); }
  emit();
}

/** Envia o relatório. Devolve {ok, score, detail, xp, credits, level_up, explain, ref}. */
export async function report(id, answer) {
  let res;
  if (!offline) { res = await call('api/mission/report', { ...who(), mission: id, answer }); state = res.player; }
  else {
    const p = localPlayer(), m = findM(id), v = viewLocal(p);
    if (v.missions.find((x) => x.id === id).locked) throw new Error(v.missions.find((x) => x.id === id).locked);
    let votes = 0;
    try { votes = JSON.parse(localStorage.getItem('spx_votes') || '[]').filter((x) => x.nickname === getNick()).length; } catch { /* ok */ }
    const regs = Object.values(p.regions);
    const r = checkLocal(m, answer, { ex: regs.filter(Boolean).length, novo: regs.filter((x) => !x).length, marks: p.marks, votes });
    const was = p.progress[id]?.status === 'done';
    res = { ...r, mission: id, title: m.title, xp: 0, credits: 0, level_up: false, explain: m.explain, ref: m.ref, repeat: was };
    if (r.ok && !was) {
      const lvl0 = level(p.xp);
      res.xp = Math.round(m.reward.xp * r.score / 100); res.credits = Math.round(m.reward.credits * r.score / 100);
      p.xp += res.xp; p.credits += res.credits; p.active = null;
      if (m.kind === 'explore' && m.check.mark) p.extra = [...new Set([...p.extra, 'campo-novo'])];
      p.progress[id] = { status: 'done', answer, score: r.score, ts: Date.now() / 1000 };
      res.level_up = level(p.xp) > lvl0;
    }
    saveLocal(p); state = viewLocal(p);
  }
  emit();
  return res;
}

/** Registra uma região aberta (missões de exploração). Silencioso. */
export async function regionOpened(ra, dec, example) {
  if (!state) await load().catch(() => {});
  if (!offline) { call('api/player/region', { ...who(), ra, dec, example }).catch(() => {}); return; }
  const p = localPlayer(); p.regions[`${ra.toFixed(2)},${dec.toFixed(2)}`] = !!example; saveLocal(p);
}
export function markMade() {
  if (!offline) return;   // com servidor, a marcação já fica gravada com o sid
  const p = localPlayer(); p.marks = (p.marks || 0) + 1; saveLocal(p);
}

export async function customize(item, value) {
  if (!offline) state = await call('api/player/satellite', { ...who(), item, value });
  else {
    const p = localPlayer(), v = viewLocal(p), spec = missionsFile.shop.find((s) => s.id === item);
    if (spec.level && v.level < spec.level) throw new Error(`Libera no nível ${spec.level}.`);
    if (spec.badge && !v.badges.includes(spec.badge)) throw new Error('Libera com a insígnia do ato 3.');
    p.sat = { ...defaultSat(), ...p.sat };
    if (spec.cost && !p.sat.owned.includes(item)) {
      if (p.credits < spec.cost) throw new Error(`Faltam créditos: custa ${spec.cost}.`);
      p.credits -= spec.cost; p.sat.owned = [...p.sat.owned, item];
    }
    p.sat[item] = spec.kind === 'text' ? String(value || '').slice(0, 20) : value;
    saveLocal(p); state = viewLocal(p);
  }
  emit();
  return state;
}

export async function leaderboard() {
  try { return await call('api/leaderboard'); } catch { return []; }
}

export const activeMission = () => state?.active ? state.missions.find((m) => m.id === state.active) : null;

// ------------------------------------------------------------------ onde fica cada ordem no céu
// Os alvos vêm do targets.json (coordenadas reais); ordens de patrulha ficam nas regiões da fila.
let places = { targets: [], queue: [] };
export function setPlaces(p) { places = { ...places, ...p }; }
/** {ra, dec, fov, band, label} de uma ordem, ou null se ela não tem lugar fixo no céu. */
export function placeOf(m) {
  if (!m) return null;
  if (m.target) { const t = places.targets.find((x) => x.id === m.target); return t ? { ra: t.ra, dec: t.dec, fov: t.fov, band: m.band || t.band, label: t.title } : null; }
  if ((m.kind === 'classify' || m.kind === 'consensus') && places.queue.length) {
    const q = places.queue[0]; return { ra: q.ra, dec: q.dec, fov: q.fov, band: q.band, label: q.name || 'região da fila', queue: true };
  }
  return null;
}
