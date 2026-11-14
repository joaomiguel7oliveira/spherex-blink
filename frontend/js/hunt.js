// Caça ao movimento: partida rápida de 5 rodadas com imagens reais do SPHEREx.
//
// Cada rodada pisca as épocas de um recorte (enquadramento, rotação e espelhamento sorteados).
// Você clica no objeto que se move ou muda de brilho; quanto mais perto, mais pontos (até 5000).
// Depois do clique aparecem a posição certa, o nome do objeto e o que ele é.
import { sessionId, getNick } from './api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pts = (v) => Number(v || 0).toLocaleString('pt-BR');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function post(url, body = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sessionId(), nickname: getNick(), ...body }) });
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).detail || m; } catch { /* sem JSON */ } throw new Error(m); }
  return r.json();
}

let ctx = null;   // { askNick(), showTab(tab) }
let G = null;     // { game, rounds, max, size, i, results, pin, hint, answer, ep, timer }
let el = null;

export function init(c) { ctx = c; }

export async function play() {
  await ctx?.askNick?.();
  let g;
  try { g = await post('api/hunt/new'); } catch (e) { alert(`Não deu para começar: ${e.message}`); return; }
  G = { ...g, i: 0, results: [] };
  if (!el) {
    el = document.createElement('div');
    el.className = 'hunt-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Caça ao movimento');
    el.addEventListener('click', onClick);
    addEventListener('keydown', onKey, true);
    document.body.append(el);
  }
  el.hidden = false;
  document.body.classList.add('hunt-on');
  startRound();
}

function img(rnd, ep) { return `api/hunt/img/${G.game}/${rnd}/${ep}`; }

function startRound() {
  Object.assign(G, { pin: null, hint: null, answer: null, ep: 0, diff: false });
  const r = G.rounds[G.i];
  for (let k = 0; k <= r.frames; k++) new Image().src = img(G.i, k);   // pré-carrega as épocas
  render();
  blink(true);
}

/** Pisca as épocas (o mesmo jeito de ver do modo Céu). Com movimento reduzido, troca só no botão. */
function blink(on) {
  clearInterval(G?.timer);
  if (!G || !on || still || G.diff) return;
  G.timer = setInterval(() => { G.ep = (G.ep + 1) % G.rounds[G.i].frames; paintFrame(); }, 650);
}
function paintFrame() {
  const r = G.rounds[G.i], im = el.querySelector('.hn-img');
  if (!im) return;
  im.src = img(G.i, G.diff ? r.frames : G.ep);
  el.querySelectorAll('.hn-ep i').forEach((d, k) => d.classList.toggle('on', k === G.ep));
  const lab = el.querySelector('.hn-date'); if (lab) lab.textContent = r.dates[G.ep] || '';
}

function hud() {
  const total = G.results.reduce((a, x) => a + x.points, 0);
  return `<header class="hn-hud"><span>Rodada <b>${G.i + 1}</b>/${G.rounds.length}</span>
    <span class="gh-dots">${G.rounds.map((_, k) => `<i class="${k < G.i ? 'done' : k === G.i ? 'now' : ''}"></i>`).join('')}</span>
    <span class="gh-s"><b>${pts(total)}</b> pts</span><button class="ghost gh-x" data-h="quit" aria-label="Sair da partida" title="Sair">✕</button></header>`;
}

function marks() {
  const S = G.size, p = (v) => `${(100 * (v + 0.5)) / S}%`;
  let h = '';
  if (G.hint) h += `<span class="hn-quad" style="left:${p(G.hint.x0 - 0.5)};top:${p(G.hint.y0 - 0.5)};width:${(100 * G.hint.w) / S}%;height:${(100 * G.hint.w) / S}%"></span>`;
  if (G.answer) {
    const a = G.answer;
    if (G.pin) h += `<svg class="hn-line" viewBox="0 0 ${S} ${S}" preserveAspectRatio="none"><line x1="${G.pin[0] + 0.5}" y1="${G.pin[1] + 0.5}" x2="${a.x + 0.5}" y2="${a.y + 0.5}"/></svg>`;
    h += `<span class="hn-truth" style="left:${p(a.x)};top:${p(a.y)}"><i></i></span>`;
  }
  if (G.pin) h += `<span class="hn-pin" style="left:${p(G.pin[0])};top:${p(G.pin[1])}"></span>`;
  return h;
}

function render() {
  const r = G.rounds[G.i], a = G.answer;
  el.innerHTML = `${hud()}
  <div class="hn-body">
    <div class="hn-stage">
      <div class="hn-frame" data-h="pick" title="Clique no objeto">
        <img class="hn-img" src="${img(G.i, G.diff ? r.frames : G.ep)}" alt="Recorte do SPHEREx piscando entre as épocas" draggable="false">
        ${marks()}
      </div>
      <div class="hn-ep">
        <span class="seg" role="group" aria-label="Como ver"><button data-h="view" data-v="blink" aria-pressed="${!G.diff}" class="${G.diff ? '' : 'on'}">Piscar</button><button data-h="view" data-v="diff" aria-pressed="${G.diff}" class="${G.diff ? 'on' : ''}" title="Última época menos a primeira: o que se moveu vira um par claro e escuro">Diferença</button></span>
        ${G.diff ? `<span class="small muted">${esc(r.dates.at(-1))} − ${esc(r.dates[0])}</span>` : `<span class="hn-date mono">${esc(r.dates[G.ep] || '')}</span>
        <span class="hn-dots">${r.dates.map((_, k) => `<i class="${k === G.ep ? 'on' : ''}"></i>`).join('')}</span>
        ${still ? '<button data-h="step">Próxima época</button>' : ''}`}</div>
    </div>
    <aside class="hn-side">${a ? resultHTML(a) : `
      <p class="hn-kind">${r.kind === 'move' ? '↗ Movimento' : '✶ Brilho'}</p>
      <p class="hn-ask">${esc(r.ask)}</p>
      <p class="small muted">As imagens alternam entre ${r.frames} épocas. Ninguém está no centro: o recorte muda a cada partida.</p>
      ${G.hint ? '<p class="small muted">Pista usada: a rodada vale até 75%.</p>' : '<button class="ghost hn-hint" data-h="hint">Mostrar o quarto da imagem <small>−25%</small></button>'}
      <button class="primary big hn-go" data-h="guess" ${G.pin ? '' : 'disabled'}>${G.pin ? 'Confirmar' : 'Clique na imagem'}</button>`}
    </aside>
  </div>`;
  if (a) { countUp(el.querySelector('.rr-num'), a.points); requestAnimationFrame(() => { const b = el.querySelector('.rr-bar i'); if (b) b.style.width = `${a.points / 50}%`; }); }
  (el.querySelector('.hn-side .primary:not([disabled])') || el.querySelector('.gh-x'))?.focus({ preventScroll: true });
}

function resultHTML(a) {
  const last = G.i >= G.rounds.length - 1;
  const word = a.points >= 4500 ? 'Na mosca!' : a.points >= 3000 ? 'Muito perto!' : a.points >= 1000 ? 'Perto.' : 'Passou longe.';
  return `<p class="label">Rodada ${G.i + 1}</p>
    <div class="rr-score"><b class="rr-num">0</b><span>/ 5.000</span></div>
    <div class="rr-bar"><i></i></div>
    <p class="rr-msg"><b>${word}</b> ${G.pin ? `A ${String(a.dist).replace('.', ',')}″ do objeto.` : ''}</p>
    <p class="hn-obj"><b>${esc(a.title)}</b></p>
    <p class="small muted">${esc(a.legend)}</p>
    <button class="primary big hn-go" data-h="${last ? 'end' : 'next'}">${last ? 'Ver resultado' : 'Próxima rodada →'}</button>`;
}

function summary() {
  blink(false);
  const total = G.results.reduce((a, x) => a + x.points, 0);
  el.innerHTML = `<div class="hn-final gr-card">
    <p class="label">Fim da partida</p>
    <div class="rr-score"><b class="rr-num">0</b><span>/ ${pts(G.max)}</span></div>
    <div class="rr-bar"><i></i></div>
    <ol class="gr-rounds">${G.results.map((x, k) => `<li><span>${k + 1}. ${esc(x.title)}</span><span class="mono">${String(x.dist).replace('.', ',')}″</span>
      <span class="gr-mini"><i style="width:${x.points / 50}%"></i></span><b class="mono">${pts(x.points)}</b></li>`).join('')}</ol>
    <p class="small muted">${getNick() ? 'Sua pontuação entrou no ranking do Mural.' : 'Escolha um apelido para aparecer no ranking.'}</p>
    <div class="row center"><button class="primary big" data-h="again">Jogar de novo</button><button data-h="rank">Ranking</button><button class="ghost" data-h="exit">Sair</button></div></div>`;
  countUp(el.querySelector('.rr-num'), total, 1400);
  requestAnimationFrame(() => { el.querySelector('.rr-bar i').style.width = `${(100 * total) / G.max}%`; });
  el.querySelector('.primary').focus({ preventScroll: true });
}

async function onClick(e) {
  const b = e.target.closest('[data-h]'); if (!b || !G) return;
  const h = b.dataset.h;
  if (h === 'pick' && !G.answer) {
    const r = b.getBoundingClientRect();
    G.pin = [((e.clientX - r.left) / r.width) * G.size - 0.5, ((e.clientY - r.top) / r.height) * G.size - 0.5];
    render();
  }
  if (h === 'view') { G.diff = b.dataset.v === 'diff'; render(); blink(!G.diff); return; }
  if (h === 'step') { G.ep = (G.ep + 1) % G.rounds[G.i].frames; paintFrame(); }
  if (h === 'hint') {
    b.disabled = true;
    try { G.hint = await post('api/hunt/hint', { game: G.game, round: G.i }); } catch (err) { b.disabled = false; return alert(err.message); }
    render();
  }
  if (h === 'guess' && G.pin) {
    b.disabled = true; b.textContent = 'Conferindo…';
    try { G.answer = await post('api/hunt/guess', { game: G.game, round: G.i, x: G.pin[0], y: G.pin[1] }); }
    catch (err) { b.disabled = false; b.textContent = 'Confirmar'; return alert(err.message); }
    G.results.push(G.answer);
    render();
  }
  if (h === 'next') { G.i += 1; startRound(); }
  if (h === 'end') summary();
  if (h === 'again') { close(); play(); }
  if (h === 'rank') { close(); ctx?.showTab?.('wall'); }
  if (h === 'exit') close();
  if (h === 'quit' && (!G.results.length || confirm('Sair da partida? Os pontos desta partida não entram no ranking.'))) close();
}

function onKey(e) {
  if (!G || el.hidden) return;
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); el.querySelector('[data-h=quit]') ? el.querySelector('[data-h=quit]').click() : close(); }
}

function close() {
  blink(false);
  G = null;
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('hunt-on');
}

function countUp(node, to, ms = 900) {
  if (!node) return;
  if (still || !to) { node.textContent = pts(to); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / ms); node.textContent = pts(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
