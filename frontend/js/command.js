// Central de Comando (aba Missões), ordem ativa no modo Céu, relatório por downlink e Hangar.
//
// O jogo é diegético: tudo fala de dentro do mundo. Você é a operadora ou o operador de um satélite
// (ilustrativo) com um indicativo de chamada; a Central manda ordens e responde pelo canal; o relatório
// é transmitido; subir de nível é uma promoção de patente. As medidas são sempre as do SPHEREx real,
// feitas pelas mesmas ferramentas do modo Céu, e o jogo nunca altera nenhuma delas.
import * as G from './missions.js';
import { sessionId } from './api.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d).replace('.', ','));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const KIND = {
  explore: 'Reconhecimento', measure_motion: 'Medir movimento', measure_variability: 'Medir brilho',
  pick_band: 'Escolher banda', classify: 'Patrulha', consensus: 'Consenso',
};
const BADGE = {
  act1: ['Cadete de órbita', 'Concluiu o ato 1'], act2: ['Observador de campo', 'Concluiu o ato 2'],
  act3: ['Patrulha do céu', 'Concluiu o ato 3'], consenso: ['Primeiro consenso', 'Votou em um candidato que chegou ao consenso'],
  'campo-novo': ['Campo novo', 'Marcou algo em uma região nova'],
};
/** Patente por nível (o nível continua sendo floor(sqrt(xp/100)) + 1). */
const RANKS = ['Cadete', 'Operador júnior', 'Operador', 'Observador', 'Observador sênior', 'Navegador', 'Comandante de órbita'];
export const rankName = (lvl) => RANKS[Math.min(RANKS.length, Math.max(1, lvl)) - 1];

let ctx = null;          // { getContext(): {target, band, ra, dec}, goTarget(id, band), askNick(), showTab(tab) }
let lastMeasure = null;  // último evento spx:measure
let bound = false;

// ------------------------------------------------------------------ indicativo e códigos
/** Indicativo de chamada: o nome do satélite, ou SPX- e três letras do id da aba. */
export function callsign(sat = G.get()?.sat) {
  return (sat?.name || '').trim() || `SPX-${sessionId().replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase()}`;
}
const code = (m) => `OP-${String((G.get()?.missions.findIndex((x) => x.id === m.id) ?? 0) + 1).padStart(2, '0')}`;
const utc = (ts) => new Date(ts).toISOString().slice(11, 16) + ' UTC';

// ------------------------------------------------------------------ canal com a Central (fica no navegador)
const COMMS = () => `spx_comms_${sessionId()}`;
const FAILS = () => `spx_fails_${sessionId()}`;
function readLS(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } }
let comms = null;
function log() { return (comms ||= readLS(COMMS(), [])); }
/**
 * Põe uma mensagem no canal. from: 'central' | 'voce'. `tag` evita repetir a mesma mensagem
 * (com `replace`, a nova toma o lugar da anterior com a mesma tag).
 */
function say(text, { from = 'central', tag = null, replace = false, tone = '' } = {}) {
  const l = log();
  if (tag) {
    const i = l.findIndex((x) => x.tag === tag);
    if (i >= 0 && !replace) return;
    if (i >= 0) l.splice(i, 1);
  }
  l.push({ ts: Date.now(), from, text, tag, tone });
  while (l.length > 80) l.shift();
  writeLS(COMMS(), l);
  if (from === 'central') announce(`Central: ${text}`);
  renderComms(); renderBar();
}
const lastCentral = () => [...log()].reverse().find((x) => x.from === 'central');
function fails(id, add = 0) {
  const f = readLS(FAILS(), {});
  if (add) { f[id] = (f[id] || 0) + add; writeLS(FAILS(), f); }
  return f[id] || 0;
}

// ------------------------------------------------------------------ emblemas e desenho do satélite (ilustrativos)
const EMB = {
  estrela: '<path d="M0-9 2.6-2.8 9.4-2.8 3.9 1.3 6 8 0 4 -6 8 -3.9 1.3 -9.4-2.8 -2.6-2.8Z"/>',
  cometa: '<circle cx="3" cy="-3" r="4"/><path d="M0 0-9 9M1 2-6 9M-2-1-9 6" stroke-width="2" stroke="currentColor" fill="none"/>',
  anel: '<circle r="4.5"/><ellipse rx="9.5" ry="3" fill="none" stroke="currentColor" stroke-width="1.6" transform="rotate(-20)"/>',
  lua: '<path d="M3-8A8.5 8.5 0 1 0 3 8 6.5 6.5 0 1 1 3-8Z"/>',
  olho: '<path d="M-9 0Q0-8 9 0 0 8-9 0Z"/><circle r="3" fill="#0b0d13"/>',
  raio: '<path d="M2-9-6 1H0L-2 9 6-1H0Z"/>',
  orbita: '<circle r="2.6"/><circle r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" r="1.8"/>',
  flor: '<g>' + [0, 60, 120, 180, 240, 300].map((a) => `<ellipse rx="2.6" ry="5.4" cy="-4.4" transform="rotate(${a})"/>`).join('') + '<circle r="2.4" fill="#0b0d13"/></g>',
};
export const emblemSVG = (name, size = 18, color = 'currentColor') =>
  name && EMB[name] ? `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}" style="color:${color}" fill="currentColor" aria-hidden="true">${EMB[name]}</svg>` : '';

function satelliteSVG(sat) {
  const body = sat.gold ? 'url(#gold)' : '#9aa3b5';
  return `<svg viewBox="0 0 240 170" class="sat-svg" role="img" aria-label="Seu satélite ${esc(callsign(sat))} (ilustrativo)">
    <defs><linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#8a6a1c"/><stop offset=".5" stop-color="#f6d77a"/><stop offset="1" stop-color="#a87f22"/></linearGradient></defs>
    <ellipse cx="120" cy="92" rx="112" ry="38" fill="none" stroke="${esc(sat.trail)}" stroke-width="1.5" stroke-dasharray="4 5" opacity=".75"/>
    <g transform="translate(120 88)">
      ${sat.panel ? '<rect x="-96" y="-8" width="44" height="16" rx="2" fill="#2b4f9e" stroke="#7c9cff" stroke-width="1"/><path d="M-52 0h14" stroke="#9aa3b5" stroke-width="2"/>' : ''}
      <rect x="44" y="-8" width="48" height="16" rx="2" fill="#2b4f9e" stroke="#7c9cff" stroke-width="1"/><path d="M30 0h14" stroke="#9aa3b5" stroke-width="2"/>
      <path d="M-38-46 38-46 26 30-26 30Z" fill="${esc(sat.shield)}" opacity=".92"/>
      <path d="M-30-34 30-34M-27-20 27-20M-24-6 24-6M-21 8 21 8" stroke="#000" stroke-opacity=".18"/>
      <rect x="-18" y="30" width="36" height="22" rx="3" fill="${body}"/>
      <g transform="translate(0 41)" style="color:#0b0d13">${sat.emblem ? `<g transform="scale(.8)" fill="currentColor">${EMB[sat.emblem]}</g>` : ''}</g>
    </g>
    <text x="120" y="164" text-anchor="middle" class="sat-name">${esc(callsign(sat))}</text>
  </svg>`;
}

// ------------------------------------------------------------------ avisos
function announce(text) { const el = $('#cmd-live'); if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); } }
/** Coluna de avisos no rodapé: vários avisos ficam empilhados em vez de um por cima do outro. */
function toastBox() {
  let b = document.getElementById('toasts');
  if (!b) { b = document.createElement('div'); b.id = 'toasts'; b.className = 'toasts'; document.body.append(b); }
  return b;
}
function toast(html, cls = '') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`; t.innerHTML = html; t.setAttribute('role', 'status');
  toastBox().append(t);
  setTimeout(() => t.classList.add('out'), 4200);
  setTimeout(() => t.remove(), 4800);
}

// ------------------------------------------------------------------ etapas da ordem ativa
/** Lista de verificação da ordem: o que já está feito agora, olhando o estado real da tela. */
function steps(m) {
  const here = ctx?.getContext() || {};
  const onTarget = !m.target || here.target === m.target;
  const bandOk = !m.band || here.band === m.band;
  const lm = lastMeasure && lastMeasure.target === here.target && (!m.target || lastMeasure.target === m.target) ? lastMeasure : null;
  const out = [];
  if (m.target) out.push({ t: 'Alvo', ok: onTarget, go: !onTarget });
  if (m.band && m.kind !== 'pick_band') out.push({ t: `Banda ${m.band}`, ok: onTarget && bandOk, go: onTarget && !bandOk });
  if (m.kind === 'measure_motion') out.push({ t: 'Medir', ok: !!(lm && lm.pm != null) });
  if (m.kind === 'measure_variability') out.push({ t: 'Medir', ok: !!(lm && lm.varPct != null) });
  if (m.kind === 'pick_band') out.push({ t: 'Escolher banda', ok: false });
  if (m.kind === 'explore') out.push({ t: m.check?.mark ? 'Regiões novas + marcar' : 'Abrir um exemplo', ok: false });
  if (m.kind === 'classify') out.push({ t: 'Classificar 5', ok: false });
  if (m.kind === 'consensus') out.push({ t: 'Consenso', ok: false });
  out.push({ t: 'Transmitir', ok: false, last: true });
  return { list: out, onTarget, bandOk, lm };
}

// ------------------------------------------------------------------ ordem ativa no modo Céu
// Faixa compacta: código e título, etapas como pontos e UM botão principal que muda sozinho conforme a
// etapa (ir ao alvo → banda → medir → transmitir). A última fala da Central aparece por alguns segundos.
let flash = null;           // {ok, text, until}: resultado da última transmissão, mostrado na própria faixa
let busy = false;
/** Próxima ação da ordem, olhando o estado real da tela. */
function nextAction(m) {
  const st = steps(m), here = ctx?.getContext() || {};
  if (m.target && !st.onTarget) return { id: 'go', label: 'Ir ao alvo', icon: '🎯' };
  if (m.band && m.kind !== 'pick_band' && !st.bandOk) return { id: 'band', label: `Banda ${m.band}`, icon: '◐' };
  if (m.kind === 'measure_motion' && !(st.lm && st.lm.pm != null)) return { id: 'measure', label: 'Medir', icon: '⌖' };
  if (m.kind === 'measure_variability' && !(st.lm && st.lm.varPct != null)) return { id: 'measure', label: 'Medir', icon: '⌖' };
  if (m.kind === 'measure_motion') return { id: 'send', label: `Transmitir ${num(st.lm.pm)}″/ano`, icon: '📡' };
  if (m.kind === 'measure_variability') return { id: 'send', label: `Transmitir ${Math.round(st.lm.varPct)}%`, icon: '📡' };
  if (m.kind === 'pick_band') return { id: 'send', label: `Transmitir ${here.band}`, icon: '📡' };
  if (m.kind === 'classify' || m.kind === 'consensus') return document.body.dataset.tab === 'queue'
    ? { id: 'send', label: 'Transmitir', icon: '📡' } : { id: 'queue', label: 'Abrir a Fila', icon: '☰' };
  return { id: 'send', label: 'Transmitir', icon: '📡' };
}

function renderBar() {
  const bar = $('#mission-bar'), m = G.activeMission();
  if (!bar) return;
  bar.hidden = !m;
  const dot = $('#mission-dot'); if (dot) dot.hidden = !m;
  if (!m) return;
  const st = steps(m), act = nextAction(m), msg = lastCentral();
  const fresh = flash && flash.until > Date.now() ? flash : null;
  const line = fresh ? fresh.text : msg && Date.now() - msg.ts < 7000 ? msg.text : '';
  bar.classList.toggle('ok', !!fresh?.ok); bar.classList.toggle('bad', !!fresh && !fresh.ok);
  bar.innerHTML = `
    <span class="mb-code mono">${code(m)}</span>
    <div class="mb-text"><b>${esc(m.title)}</b>
      <span class="mb-dots" aria-label="Etapas">${st.list.map((x) => `<i class="${x.ok ? 'ok' : ''}" title="${esc(x.t)}${x.ok ? ' ✓' : ''}"></i>`).join('')}</span>
      ${line ? `<span class="mb-line">${esc(line)}</span>` : ''}</div>
    <button data-mb="${act.id}" class="primary mb-main" ${busy ? 'disabled' : ''}><span aria-hidden="true">${act.icon}</span> ${esc(act.label)}</button>
    ${m.kind === 'pick_band' && st.onTarget ? '<button data-mb="nextband" class="mb-icon" title="Próxima banda" aria-label="Próxima banda">◐</button>' : ''}
    <button data-mb="edit" class="mb-icon" title="Relatório detalhado" aria-label="Relatório detalhado">✎</button>
    <button data-mb="central" class="mb-icon" title="Canal com a Central" aria-label="Canal com a Central">≡</button>`;
}
// a fala da Central some sozinha da faixa
setInterval(() => { const m = G.activeMission(), msg = lastCentral(); if (m && msg && Date.now() - msg.ts < 8000) renderBar(); }, 1000);

/** Envia o relatório direto da faixa, com a medida já feita. O formulário fica para quem quer editar. */
async function quickSend(m) {
  const here = ctx.getContext(), st = steps(m), answer = { target: here.target, band: here.band };
  if (m.kind === 'measure_motion') Object.assign(answer, { pm: +st.lm.pm.toFixed(1), pa: Math.round(st.lm.pa) });
  if (m.kind === 'measure_variability') answer.var_pct = Math.round(st.lm.varPct);
  busy = true; renderBar();
  say(packetText(m, answer), { from: 'voce' });
  try {
    const r = await G.report(m.id, answer);
    const s = G.get();
    if (r.ok && !r.repeat) {
      flash = { ok: true, text: `✓ Confirmado · +${r.xp} XP · +${r.credits} cr`, until: Date.now() + 6000 };
      toast(`✓ <b>${esc(m.title)}</b> · +${r.xp} XP`, 'gold');
      say(`${code(m)} confirmado. +${r.xp} XP.${r.ref ? ` Catálogo: ${r.ref}.` : ''}`, { tone: 'ok' });
      if (r.level_up) { say(`Promoção: ${rankName(s.level)}.`, { tone: 'gold' }); toast(`Promoção · <b>${esc(rankName(s.level))}</b>`, 'gold'); }
      afterSuccess(s);
    } else if (r.ok) {
      flash = { ok: true, text: '✓ Já cumprida', until: Date.now() + 4000 };
    } else {
      const n = fails(m.id, 1), hint = hintAfter(m, n);
      flash = { ok: false, text: `✗ ${hint}`, until: Date.now() + 9000 };
      say(`Não confere. ${r.detail} ${hint}`, { tone: 'warn' });
    }
  } catch (e) {
    flash = { ok: false, text: `✗ ${e.message}`, until: Date.now() + 6000 };
  } finally { busy = false; renderBar(); setTimeout(renderBar, 9100); }
}

/** Depois de cumprir: insígnias novas e, sem pedir, a próxima ordem fica pronta para iniciar. */
function afterSuccess(s) {
  for (const b of s.badges) if (!readLS(`spx_badge_seen_${sessionId()}`, []).includes(b)) {
    writeLS(`spx_badge_seen_${sessionId()}`, [...readLS(`spx_badge_seen_${sessionId()}`, []), b]);
    say(`Insígnia: ${BADGE[b]?.[0] || b}.`, { tone: 'gold' });
    toast(`Insígnia · <b>${esc(BADGE[b]?.[0] || b)}</b>`, 'gold');
  }
  const nx = nextOrder();
  if (nx) {
    say(`Próxima: ${code(nx)} · ${nx.title}.`, { tag: 'next', replace: true });
    const t = document.createElement('div');
    t.className = 'toast next'; t.setAttribute('role', 'status');
    t.innerHTML = `<span>Próxima ordem · <b>${esc(nx.title)}</b></span><button class="primary">Iniciar</button>`;
    t.querySelector('button').onclick = () => { t.remove(); doAccept(nx.id); };
    toastBox().prepend(t);
    setTimeout(() => t.classList.add('out'), 9000); setTimeout(() => t.remove(), 9600);
  }
}

// ------------------------------------------------------------------ relatório por downlink
function reportForm(m) {
  const here = ctx.getContext(), lm = lastMeasure && lastMeasure.target === here.target ? lastMeasure : null;
  const wrongTarget = m.target && here.target !== m.target;
  let fields = '';
  if (m.kind === 'measure_motion') {
    fields = `<label>Velocidade (″/ano) <input name="pm" type="number" step="0.1" min="0" max="100" value="${lm?.pm != null ? lm.pm.toFixed(1) : ''}" required></label>
      <label>Direção (graus, 0 = norte, 90 = leste) <input name="pa" type="number" step="1" min="0" max="360" value="${lm?.pa != null ? Math.round(lm.pa) : ''}" required></label>`;
  } else if (m.kind === 'measure_variability') {
    fields = `<label>Variação de brilho entre épocas (%) <input name="var_pct" type="number" step="1" min="0" max="500" value="${lm?.varPct != null ? Math.round(lm.varPct) : ''}" required></label>`;
  } else if (m.kind === 'pick_band') {
    fields = `<label>Banda em que o objeto aparece melhor <select name="band">${BANDS.map((b) => `<option ${b === here.band ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`;
  }
  const pre = m.kind.startsWith('measure')
    ? (lm ? `<p class="muted small">Pacote montado com a sua última medida (banda ${esc(lm.band)}). Confira antes de transmitir.</p>`
      : '<p class="muted small">Ainda não há medida neste alvo. Clique no objeto na imagem para medir; se preferir, digite o valor.</p>') : '';
  return `<p class="label">Downlink · ${esc(callsign())} → Central</p>
    <h3 id="rp-title">Relatório da ordem ${code(m)} · ${esc(m.title)}</h3>
    <p>${esc(m.brief)}</p>
    ${wrongTarget ? '<p class="status err">O satélite não está apontado para o alvo desta ordem. Use “Apontar para o alvo” primeiro.</p>' : ''}
    <form id="rp-form" class="rp-form">${fields}${pre}
      <div class="row end"><button type="button" class="ghost" data-rp="close">Fechar</button>
      <button type="submit" class="primary">Transmitir</button></div>
    </form>
    <div id="rp-link" class="rp-link" hidden aria-hidden="true"></div>
    <div id="rp-result" aria-live="polite"></div>`;
}

/** Animação curta do downlink (pula com movimento reduzido). Roda junto com a chamada à API. */
async function downlink(nvals) {
  const el = $('#rp-link');
  if (!el || still) return;
  el.hidden = false;
  const lines = ['Abrindo downlink…', `Transmitindo pacote (${nvals} valor${nvals === 1 ? '' : 'es'})…`, 'Aguardando a Central…'];
  for (const l of lines) {
    el.innerHTML = `<span class="rp-wave"><i></i><i></i><i></i></span> ${l}`;
    await new Promise((r) => setTimeout(r, 420));
  }
}

async function openReport() {
  const m = G.activeMission();
  if (!m) return;
  const dlg = $('#report-dialog');
  dlg.querySelector('.rp-body').innerHTML = reportForm(m);
  dlg.showModal();
  dlg.querySelector('[data-rp=close]').onclick = () => dlg.close();
  dlg.querySelector('#rp-form').onsubmit = async (e) => {
    e.preventDefault();
    const here = ctx.getContext(), fd = new FormData(e.target), answer = { target: here.target, band: here.band };
    for (const [k, v] of fd.entries()) answer[k] = k === 'band' ? v : Number(String(v).replace(',', '.'));
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    $('#rp-result').innerHTML = '';
    say(packetText(m, answer), { from: 'voce' });
    try {
      const [r] = await Promise.all([G.report(m.id, answer), downlink([...fd.keys()].length || 1)]);
      $('#rp-link').hidden = true;
      showResult(m, r);
    } catch (err) {
      $('#rp-link').hidden = true;
      $('#rp-result').innerHTML = `<p class="status err">Falha no downlink: ${esc(err.message)}</p>`;
    } finally { btn.disabled = false; }
  };
}

function packetText(m, a) {
  if (a.pm != null) return `Relatório ${code(m)}: ${num(a.pm)}″/ano rumo ${Math.round(a.pa)}°, banda ${a.band}.`;
  if (a.var_pct != null) return `Relatório ${code(m)}: brilho variou ${Math.round(a.var_pct)}%, banda ${a.band}.`;
  if (m.kind === 'pick_band') return `Relatório ${code(m)}: o objeto aparece melhor na banda ${a.band}.`;
  return `Relatório ${code(m)}: pronto para conferência.`;
}

/** Dica da Central depois de cada falha: começa pela dica da ordem e fica mais específica. */
function hintAfter(m, n) {
  const all = [m.hint, ...(m.hints || [])].filter(Boolean);
  return all[Math.min(all.length - 1, Math.max(0, n - 1))];
}

function nextOrder() {
  const s = G.get();
  return s?.missions.find((m) => m.status !== 'done' && !m.locked) || null;
}

function showResult(m, r) {
  const box = $('#rp-result'), s = G.get();
  let reply;
  if (r.ok && !r.repeat) {
    fails(m.id, 0);
    reply = `${code(m)} confirmado. ${r.detail} +${r.xp} XP · +${r.credits} cr.`;
  } else if (r.ok) {
    reply = `Confere. ${r.detail} (já cumprida, sem novo crédito)`;
  } else {
    const n = fails(m.id, 1);
    reply = `Não confere. ${r.detail} ${hintAfter(m, n)}`;
  }
  say(reply, { tone: r.ok ? 'ok' : 'warn' });
  box.innerHTML = `<div class="comms-msg central ${r.ok ? 'ok' : 'warn'}"><span class="mono small">CENTRAL · ${utc(Date.now())}</span><p>${esc(reply)}</p></div>
    ${r.ok ? `${r.ref ? `<p class="small"><b>Referência de catálogo:</b> ${esc(r.ref)}</p>` : ''}${r.explain ? `<p class="small muted">${esc(r.explain)}</p>` : ''}` : ''}`;
  if (r.ok && !r.repeat) {
    $('#rp-form')?.remove();
    const nx = nextOrder();
    if (r.level_up) {
      const msg = `Promoção: ${rankName(s.level)}. Novas peças no Hangar.`;
      say(msg, { tone: 'gold' });
      toast(`<b>Promoção</b> · ${esc(rankName(s.level))}`, 'gold');
    }
    afterSuccess(s);
    box.insertAdjacentHTML('beforeend', `<div class="row end"><button class="ghost" data-rp="close2">Fechar</button>
      <button class="primary" data-rp="central">${nx ? `Ver ordem ${code(nx)}` : 'Abrir a Central'}</button></div>`);
    box.querySelector('[data-rp=close2]').onclick = () => $('#report-dialog').close();
    box.querySelector('[data-rp=central]').onclick = () => { $('#report-dialog').close(); ctx.showTab('missions'); };
  } else if (!r.ok) {
    box.insertAdjacentHTML('beforeend', '<p class="small muted">Meça de novo e transmita outra vez. A medida vem das mesmas ferramentas do modo Céu.</p>');
  }
}

// ------------------------------------------------------------------ Central de Comando
function missionCard(m, active) {
  const done = m.status === 'done', locked = !!m.locked;
  const state = done ? '✓' : active ? 'ativa' : '';
  return `<article class="mcard ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${active ? 'active' : ''}">
    <div class="mc-top"><span class="tag mono">${code(m)}</span>${m.band ? `<span class="tag mono">${m.band}</span>` : ''}${state ? `<span class="tag ${done ? 'ok' : active ? 'warn' : ''}">${state}</span>` : ''}</div>
    <h4>${esc(m.title)}</h4>
    <p class="small muted">${esc(m.brief)}</p>
    ${locked ? `<p class="muted small">🔒 ${esc(m.locked)}</p>` : ''}
    <div class="mc-foot"><span class="mono small">+${m.reward.xp} XP · +${m.reward.credits} cr</span>
      ${done ? '' : locked ? ''
        : active ? `<button data-act="go" data-id="${m.id}" class="primary">Continuar</button>`
        : `<button data-act="accept" data-id="${m.id}">Iniciar</button>`}
    </div>
  </article>`;
}

function renderStatus(s) {
  const pct = Math.min(100, Math.round(((s.xp - s.level_xp) / Math.max(1, s.next_level_xp - s.level_xp)) * 100));
  $('#cmd-status').innerHTML = `
    <div class="ck"><span class="label">Indicativo</span><b class="mono cs">${esc(callsign(s.sat))}</b><span class="small muted">${esc(rankName(s.level))} · nível ${s.level}</span></div>
    <div class="ck grow"><span class="label">Experiência de operação</span>
      <div class="xpbar" role="progressbar" aria-label="Experiência até a próxima patente" aria-valuenow="${s.xp}" aria-valuemin="${s.level_xp}" aria-valuemax="${s.next_level_xp}"><i style="width:${pct}%"></i></div>
      <span class="mono small muted">${s.xp} XP · faltam ${s.next_level_xp - s.xp} para ${esc(rankName(s.level + 1))}</span></div>
    <div class="ck"><span class="label">Créditos de missão</span><b>${s.credits}</b></div>
    <div class="ck"><span class="label">Insígnias</span><span class="badges">${s.badges.length ? s.badges.map((b) => `<span class="badge" title="${esc(BADGE[b]?.[1] || b)}">${esc(BADGE[b]?.[0] || b)}</span>`).join('') : '<span class="muted small">nenhuma ainda</span>'}</span></div>`;
}

/** Telemetria: órbita e período são de uma órbita como a do SPHEREx (ilustrativa); apontamento e banda são os reais da tela. */
function renderTelemetry() {
  const el = $('#cmd-telemetry');
  if (!el) return;
  const here = ctx?.getContext() || {}, P = 98.6 * 60;
  const t = Date.now() / 1000, orbit = Math.floor(t / P) % 10000, phase = Math.round(((t % P) / P) * 360);
  const point = here.ra != null ? `RA ${num(here.ra, 2)}° · Dec ${num(here.dec, 2)}°` : 'céu inteiro';
  el.innerHTML = `<span class="label">Telemetria · ${esc(callsign())}</span>
    <dl>
      <div><dt>Órbita</dt><dd>polar, 700 km <span class="tag">ilustrativo</span></dd></div>
      <div><dt>Passagem</dt><dd class="mono">nº ${orbit} · ${phase}°</dd></div>
      <div><dt>Apontamento</dt><dd class="mono">${point}</dd></div>
      <div><dt>Banda</dt><dd class="mono">${esc(here.band || '—')}</dd></div>
      <div><dt>Status</dt><dd><span class="ok-dot"></span>nominal</dd></div>
    </dl>`;
}

function renderComms() {
  const el = $('#cmd-comms');
  if (!el || $('#tab-missions').hidden) return;
  const l = log().slice(-14);
  el.innerHTML = l.map((x) => `<div class="comms-msg ${x.from} ${x.tone || ''}"><span class="mono small">${x.from === 'central' ? 'CENTRAL' : esc(callsign())} · ${utc(x.ts)}</span><p>${esc(x.text)}</p></div>`).join('')
    || '<p class="muted small">Canal em silêncio.</p>';
  el.scrollTop = el.scrollHeight;
}

function renderOrderBox(s) {
  const act = G.activeMission(), el = $('#cmd-order');
  if (!el) return;
  if (act) {
    const st = steps(act);
    el.innerHTML = `<span class="label">Ativa · ${code(act)}</span><b>${esc(act.title)}</b>
      <ol class="mb-steps">${st.list.map((x) => `<li class="${x.ok ? 'ok' : ''}">${x.ok ? '✓' : '○'} ${esc(x.t)}</li>`).join('')}</ol>
      <div class="row"><button class="primary" data-act="go" data-id="${act.id}">Continuar</button>
      <button class="ghost" data-act="abandon">Pausar</button></div>`;
  } else {
    const nx = nextOrder();
    el.innerHTML = nx
      ? `<span class="label">Próxima · ${code(nx)}</span><b>${esc(nx.title)}</b><p class="small muted">${esc(nx.brief)}</p>
         <div class="row"><button class="primary" data-act="accept" data-id="${nx.id}">Iniciar</button></div>`
      : '<span class="label">Tudo cumprido</span>';
  }
}

function renderCentral() {
  const s = G.get();
  if (!s) return;
  renderStatus(s);
  $('#cmd-offline').hidden = !G.isOffline();
  welcome(s);
  renderComms(); renderOrderBox(s); renderTelemetry();
  $('#cmd-acts').innerHTML = s.acts.map((a) => {
    const ms = s.missions.filter((m) => m.act === a.act), n = ms.filter((m) => m.status === 'done').length;
    return `<section class="act"><header><span class="label">Ato ${a.act}</span><h3>${esc(a.title)}</h3><span class="mono small muted">${n}/${ms.length}</span></header>
      <div class="mgrid">${ms.map((m) => missionCard(m, m.id === s.active)).join('')}</div></section>`;
  }).join('');
  renderHangar();
  const done = s.missions.filter((m) => m.status === 'done').sort((a, b) => b.done_ts - a.done_ts);
  $('#cmd-log').innerHTML = done.length ? `<table><tr><th>Ordem</th><th>Seu relatório</th><th>Catálogo</th></tr>${done.map((m) => `<tr>
      <td><span class="mono small">${code(m)}</span> ${esc(m.title)}<br><span class="muted small">${new Date(m.done_ts * 1000).toLocaleDateString('pt-BR')}</span></td>
      <td class="mono small">${answerText(m)}</td><td class="small">${esc(m.ref || '—')}</td></tr>`).join('')}</table>`
    : '<p class="muted small">Nenhuma ordem cumprida ainda. O diário guarda o que você mediu ao lado do valor de catálogo.</p>';
}

/** Primeira transmissão: apresenta o canal e a primeira ordem (uma vez por jogador). */
function welcome(s) {
  if (log().some((x) => x.tag === 'welcome')) return;
  const nx = nextOrder();
  say(`${callsign(s.sat)}, aqui é a Central. Sinal recebido.${nx ? ` Primeira ordem: ${code(nx)} · ${nx.title}.` : ''}`, { tag: 'welcome' });
}

function answerText(m) {
  const a = m.answer || {};
  if (a.pm != null) return `${num(a.pm)}″/ano a ${Math.round(a.pa)}° (${esc(a.band || '')})`;
  if (a.var_pct != null) return `${Math.round(a.var_pct)}% (${esc(a.band || '')})`;
  if (m.kind === 'pick_band') return esc(a.band);
  return 'cumprida';
}

function renderHangar() {
  const s = G.get(), sat = s.sat;
  $('#hangar-preview').innerHTML = satelliteSVG(sat);
  $('#hangar-shop').innerHTML = s.shop.map((it) => {
    const owned = !it.cost || sat.owned.includes(it.id);
    const lock = it.level && s.level < it.level ? `a patente ${rankName(it.level)}` : it.badge && !s.badges.includes(it.badge) ? 'a insígnia do ato 3' : null;
    let ctrl = '';
    if (lock) ctrl = `<span class="muted small">🔒 libera com ${lock}</span>`;
    else if (it.kind === 'text') ctrl = `<form class="shop-name" data-item="name"><input name="v" maxlength="20" value="${esc(sat.name)}" placeholder="${esc(callsign({}))}" aria-label="Nome do satélite (vira o indicativo)"><button>Registrar</button></form>`;
    else if (it.kind === 'toggle') ctrl = `<button data-item="${it.id}" data-value="${!sat[it.id]}">${sat[it.id] ? 'Remover' : 'Instalar'}</button>`;
    else if (!owned) ctrl = `<button data-item="${it.id}" data-value="${esc(it.options[1])}" ${s.credits < it.cost ? 'disabled' : ''}>Requisitar · ${it.cost} cr</button>`;
    else ctrl = `<div class="swatches">${it.options.map((o) => it.kind === 'color'
      ? `<button class="sw-btn ${sat[it.id] === o ? 'on' : ''}" data-item="${it.id}" data-value="${o}" style="--c:${o}" aria-label="Cor ${o}" aria-pressed="${sat[it.id] === o}" title="${o}"></button>`
      : `<button class="em-btn ${sat[it.id] === o ? 'on' : ''}" data-item="${it.id}" data-value="${o}" aria-label="Emblema ${o}" aria-pressed="${sat[it.id] === o}" title="${o}">${emblemSVG(o, 18)}</button>`).join('')}</div>`;
    return `<div class="shop-item"><div><b>${esc(it.title)}</b>${it.cost ? `<span class="muted small"> · ${owned ? 'em estoque' : `${it.cost} créditos`}</span>` : ''}</div>${ctrl}</div>`;
  }).join('');
}

// ------------------------------------------------------------------ ações
async function doAccept(id) {
  if (!(await ctx.askNick())) return;
  try {
    await G.accept(id);
    const m = G.activeMission();
    say(`${code(m)} · ${m.title}. ${m.brief}`, { tag: `order-${m.id}`, replace: true });
    goMission(m);
  } catch (e) { toast(esc(e.message), 'bad'); }
}

function goMission(m) {
  if (!m) return;
  if (m.target) ctx.goTarget(m.target, m.band);
  else if (m.kind === 'classify' || m.kind === 'consensus') ctx.showTab('queue');
  else ctx.showTab('explore');
  renderBar();
}

async function onCentralClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'accept') return doAccept(b.dataset.id);
  if (b.dataset.act === 'go') return goMission(G.get().missions.find((m) => m.id === b.dataset.id));
  if (b.dataset.act === 'abandon') {
    const m = G.activeMission();
    await G.abandon();
    if (m) say(`${code(m)} suspensa.`);
    renderCentral();
  }
}

async function onShopClick(e) {
  const b = e.target.closest('button[data-item]');
  if (!b) return;
  const v = b.dataset.value === 'true' ? true : b.dataset.value === 'false' ? false : b.dataset.value;
  const spec = G.get().shop.find((x) => x.id === b.dataset.item);
  const had = G.get().sat.owned.includes(b.dataset.item);
  try {
    await G.customize(b.dataset.item, v);
    if (spec?.cost && !had) say(`${spec.title} no Hangar. −${spec.cost} cr.`);
    else announce('Satélite atualizado.');
  } catch (err) { toast(esc(err.message), 'bad'); }
}

// ------------------------------------------------------------------ eventos do modo Céu
let autoMeasured = null;   // chave alvo+banda já medida automaticamente nesta chegada
function onRegion(e) {
  const m = G.activeMission();
  if (m?.target && e.detail?.target === m.target) {
    const bandOk = !m.band || e.detail.band === m.band;
    say(bandOk ? 'Alvo adquirido.' : `Alvo adquirido. Troque para ${m.band}.`, { tag: `acq-${m.id}-${e.detail.band}`, replace: true });
    // chegou no alvo certo, na banda certa: mede sozinho no centro (os alvos ficam centrados)
    const key = `${m.id}:${e.detail.band}`;
    if (bandOk && m.kind.startsWith('measure') && autoMeasured !== key) {
      autoMeasured = key;
      setTimeout(() => ctx.measureCenter?.(), 350);
    }
  }
  renderBar();
}
function onMeasure(e) {
  lastMeasure = e.detail;
  const m = G.activeMission(), d = e.detail;
  if (m && m.target && d.target === m.target && m.kind.startsWith('measure')) {
    const txt = m.kind === 'measure_motion'
      ? (d.pm != null ? `Medida: ${num(d.pm)}″/ano · ${Math.round(d.pa)}°.` : 'Sem posição confiável aqui. Clique no centro do objeto.')
      : (d.varPct != null ? `Medida: brilho variou ${Math.round(d.varPct)}%.` : 'Sem fotometria aqui. Clique no centro do objeto.');
    say(txt, { tag: `meas-${m.id}`, replace: true });
  }
  renderBar();
}

// ------------------------------------------------------------------ entrada
export async function init(context) {
  ctx = context;
  if (bound) return;
  bound = true;
  document.addEventListener('spx:measure', onMeasure);
  document.addEventListener('spx:region', onRegion);
  G.onChange(() => { renderBar(); if (!$('#tab-missions').hidden) renderCentral(); });
  $('#mission-bar').onclick = (e) => {
    const b = e.target.closest('[data-mb]'); if (!b || busy) return;
    const m = G.activeMission(), a = b.dataset.mb;
    if (a === 'go') goMission(m);
    if (a === 'band') ctx.setBand(m.band);
    if (a === 'nextband') { const here = ctx.getContext(); ctx.setBand(BANDS[(BANDS.indexOf(here.band) + 1) % BANDS.length]); }
    if (a === 'measure' && !ctx.measureCenter()) goMission(m);
    if (a === 'queue') ctx.showTab('queue');
    if (a === 'send') quickSend(m);
    if (a === 'edit') openReport();
    if (a === 'central') ctx.showTab('missions');
  };
  $('#tab-missions').addEventListener('click', onCentralClick);
  $('#hangar-shop').addEventListener('click', onShopClick);
  $('#hangar-shop').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await G.customize('name', e.target.v.value);
      say(`Indicativo: ${callsign()}.`);
    } catch (err) { toast(esc(err.message), 'bad'); }
  });
  setInterval(() => { if (!$('#tab-missions').hidden) renderTelemetry(); }, 5000);
  await G.load().catch((e) => console.warn('missões indisponíveis:', e));
}

export async function show() {
  await G.load();
  renderCentral();
}

export async function renderLeaderboard(el) {
  const rows = await G.leaderboard();
  el.innerHTML = rows.length
    ? `<table><tr><th>#</th><th>Apelido</th><th>Patente</th><th>XP</th><th>Insígnias</th></tr>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.nickname)}</td><td>${esc(rankName(r.level))}</td><td>${r.xp}</td><td>${r.badges.map((b) => esc(BADGE[b]?.[0] || b)).join(', ') || '—'}</td></tr>`).join('')}</table>`
    : `<p class="muted">${G.isOffline() ? 'O ranking precisa do servidor.' : 'Ninguém cumpriu ordens ainda.'}</p>`;
}

export { renderBar };
/** Ações usadas pelas ordens desenhadas no céu (skyorders.js) e pelo globo. */
export const orderActions = {
  code: (m) => code(m),
  accept: (id) => doAccept(id),
  go: (m) => goMission(m),
  report: () => openReport(),
  central: () => ctx.showTab('missions'),
};
