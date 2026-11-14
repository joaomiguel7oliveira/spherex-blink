// Fila de candidatos e mural. A máquina filtra, o humano decide.
import { Viewer } from './viewer.js';
import * as api from './api.js';
import { fmtRA, fmtDec } from './science.js';

const $ = (s) => document.querySelector(s);
const REGION = 'queue';
const LABEL = { move: 'Se move', nao_move: 'Não se move', defeito: 'É defeito' };
const TYPE = {
  dipolo: 'Par claro-escuro na diferença entre épocas: assinatura de algo que mudou de lugar.',
  apareceu: 'Fonte presente na época mais recente e ausente (ou bem mais fraca) na anterior.',
  sumiu: 'Fonte presente na época anterior e ausente (ou bem mais fraca) na mais recente.',
};
const MIN_VOTES = 3;

let data = null, votes = { candidates: {}, ranking: [] }, pos = 0, viewer = null, askNick = null, bound = false;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function consensus(c) {
  const total = c ? c.move + c.nao_move + c.defeito : 0;
  if (total < MIN_VOTES) return { total, text: `${total} de ${MIN_VOTES} votos para fechar`, cls: '' };
  const [best, k] = Object.entries({ move: c.move, nao_move: c.nao_move, defeito: c.defeito }).sort((a, b) => b[1] - a[1])[0];
  if (k / total < 2 / 3) return { total, text: 'sem consenso, precisa de mais votos', cls: 'warn' };
  return best === 'move' ? { total, text: 'consenso: se move → enviado para revisão de astrônomos', cls: 'ok', done: true }
    : { total, text: `consenso: ${LABEL[best].toLowerCase()}`, cls: '', done: true };
}

async function ensure() {
  if (!data) data = await api.loadCandidates(REGION);
  votes = await api.getVotes();
}

// ------------------------------------------------------------------ fila
async function showCandidate() {
  const list = data.candidates, c = list[pos];
  if (!c) return;
  const mine = votes.candidates[c.id]?.voters?.[api.getNick()];
  renderProgress();
  $('#q-info').innerHTML = `
    <h3>Candidato ${pos + 1} de ${list.length} <span class="muted">${esc(c.id)}</span></h3>
    <p>${TYPE[c.type] || ''}</p>
    <div class="kv">
      <span class="k">Região</span><span class="v">${esc(c.region)}</span>
      <span class="k">Posição</span><span class="v mono">${fmtRA(c.ra)} ${fmtDec(c.dec)}</span>
      <span class="k">Banda</span><span class="v">${c.band} · sinal ${c.snr.toFixed(0)}σ</span>
      <span class="k">Épocas</span><span class="v">${esc(c.epoch_a)} comparada com ${esc(c.epoch_b)}</span>
      ${c.sep ? `<span class="k">Separação</span><span class="v">${c.sep.toFixed(1).replace('.', ',')}″ entre o lado claro e o escuro</span>` : ''}
      <span class="k">Catálogos</span><span class="v">${c.control ? 'resultado guardado até você votar' : esc(c.match || 'nenhum objeto conhecido que explique a mudança')}</span>
    </div>
    <div class="row"><a class="btn ghost" href="?ra=${c.ra.toFixed(4)}&dec=${c.dec.toFixed(4)}&fov=6&band=${c.band}">Abrir no modo Explorar</a></div>`;
  document.querySelectorAll('.vote button[data-label]').forEach((b) => b.classList.toggle('chosen', b.dataset.label === mine));
  renderResult(c, mine);
  try {
    const { meta, cube } = await api.loadCube(c.rra, c.rdec, c.rfov, c.band);
    if (list[pos] !== c) return;
    if (viewer.meta !== meta) viewer.setData(meta, cube);
    const [x, y] = viewer.skyToPixel(c.ra, c.dec);
    const near = (mjd) => viewer.epochs.reduce((best, e, i) => (Math.abs(e.mjd - mjd) < Math.abs(viewer.epochs[best].mjd - mjd) ? i : best), 0);
    const a = near(c.mjd_a), b = near(c.mjd_b);
    viewer.extra = [{ x, y, r: 16, color: '#ffd54f' }];
    Object.assign(viewer.s, { zoom: Math.max(1, (c.rfov * 60) / 150), cx: x + 0.5, cy: viewer.n - 1 - y + 0.5 });
    const mode = document.querySelector('#q-mode .on').dataset.v;
    viewer.set({ frameMode: mode === 'anim' ? 'exposures' : 'epochs', view: mode });
    viewer.set({ a, b, mira: false, playing: mode !== 'diff', fps: mode === 'anim' ? 5 : 1.5, stretch: 0.3 });
  } catch (e) {
    $('#q-info').insertAdjacentHTML('beforeend', `<p class="status err">${esc(e.message)}</p>`);
  }
}

/** Um traço por candidato: claro = você já classificou, branco = o atual. */
function renderProgress() {
  const nick = api.getNick(), list = data.candidates;
  const done = list.filter((c) => votes.candidates[c.id]?.voters?.[nick]).length;
  $('#q-progress').innerHTML = list.map((c, i) => `<i class="${i === pos ? 'on' : ''} ${votes.candidates[c.id]?.voters?.[nick] ? 'done' : ''}"></i>`).join('');
  $('#q-progress-read').textContent = `${done} de ${list.length} classificados`;
}

function renderResult(c, mine) {
  const box = $('#q-result');
  box.hidden = !mine;
  if (!mine) return;
  const v = votes.candidates[c.id] || { move: 0, nao_move: 0, defeito: 0 }, cs = consensus(v), tot = cs.total || 1;
  let reveal = '';
  if (c.control) {
    const right = mine === 'move';
    reveal = `<div class="verdict ${right ? 'still' : 'move'}"><b>${right ? 'Acertou!' : 'Quase.'}</b> Este era um controle: ${esc(c.match)}.
      Controles conhecidos servem para medir a precisão de cada participante.</div>`;
  }
  box.innerHTML = `<h3>Seu voto: ${LABEL[mine]}</h3>${reveal}
    <div class="barvote"><i style="width:${(v.move / tot) * 100}%"></i><i style="width:${(v.nao_move / tot) * 100}%"></i><i style="width:${(v.defeito / tot) * 100}%"></i></div>
    <p class="small">${v.move} se move · ${v.nao_move} não se move · ${v.defeito} defeito</p>
    <p class="small"><span class="tag ${cs.cls}">${cs.text}</span></p>
    <p class="muted small">${v.first === api.getNick() ? 'Você foi a primeira pessoa a classificar este candidato.' : `Primeira classificação: ${esc(v.first || '')}.`}
    ${votes.offline ? ' Sem servidor: seus votos ficaram guardados só neste navegador.' : ''}</p>`;
}

async function vote(label) {
  if (!(await askNick())) return;
  const c = data.candidates[pos];
  votes = await api.sendVote(c.id, label);
  document.querySelectorAll('.vote button[data-label]').forEach((b) => b.classList.toggle('chosen', b.dataset.label === label));
  renderResult(c, label);
  renderProgress();
}

function next() { pos = (pos + 1) % data.candidates.length; showCandidate(); }

function bind() {
  if (bound) return;
  bound = true;
  viewer = new Viewer($('#qview'));
  document.querySelector('.vote').onclick = (e) => { const b = e.target.closest('button[data-label]'); if (b) vote(b.dataset.label); };
  $('#q-skip').onclick = next;
  $('#q-mode').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#q-mode button').forEach((x) => x.classList.toggle('on', x === b));
    showCandidate();
  };
  document.addEventListener('keydown', (e) => {
    if ($('#tab-queue').hidden || e.target.matches('input, select, textarea') || $('#nick-dialog').open) return;
    const k = { 1: 'move', 2: 'nao_move', 3: 'defeito' }[e.key];
    if (k) vote(k);
    if (e.key === 'ArrowRight' || e.key === 'Enter') next();
  });
}

function renderPipeline() {
  const p = data.pipeline;
  $('#q-pipeline').innerHTML = `<h3>O que a máquina já fez</h3>
    <div class="kv">
      <span class="k">Regiões analisadas</span><span class="v">${data.regions.length} campos pequenos</span>
      <span class="k">Mudanças detectadas</span><span class="v">${p.detected}</span>
      <span class="k">Explicadas por estrelas conhecidas</span><span class="v">${p.known_static}</span>
      <span class="k">Descartadas como defeito ou resíduo</span><span class="v">${p.artifacts}</span>
      <span class="k">Na fila para você</span><span class="v"><b>${data.candidates.length}</b> (${p.controls} controle${p.controls === 1 ? '' : 's'})</span>
    </div>
    <p class="muted small">Detecção: diferença entre épocas e busca de fontes acima de ${p.threshold}σ. Cruzamento com Gaia DR3 e CatWISE2020, com as posições levadas até ${p.ref_epoch} pelo movimento próprio.</p>`;
}

// ------------------------------------------------------------------ mural
async function renderWall() {
  const cands = data?.candidates || [], vs = cands.map((c) => votes.candidates[c.id]);
  const total = vs.reduce((s, v) => s + (v ? v.move + v.nao_move + v.defeito : 0), 0);
  const closed = vs.filter((v) => consensus(v).done).length;
  const kpi = (n, t) => `<div class="kpi"><b>${n}</b><span>${t}</span></div>`;
  $('#wall-kpis').innerHTML = kpi(cands.length, 'candidatos') + kpi(total, 'votos') + kpi(closed, 'com consenso') + kpi(votes.ranking.length, 'participantes');
  const rows = (data?.candidates || []).map((c) => {
    const v = votes.candidates[c.id], cs = consensus(v);
    return `<tr><td>${esc(c.id)}</td><td>${v ? `${v.move} / ${v.nao_move} / ${v.defeito}` : '—'}</td><td><span class="tag ${cs.cls}">${cs.text}</span></td><td>${esc(v?.first || '—')}</td></tr>`;
  }).join('');
  $('#wall-cands').innerHTML = rows
    ? `<table><tr><th>Candidato</th><th>move / não / defeito</th><th>Situação</th><th>Primeiro voto</th></tr>${rows}</table>`
    : '<p class="muted">Fila ainda não gerada.</p>';
  $('#wall-rank').innerHTML = votes.ranking.length
    ? `<table><tr><th>#</th><th>Apelido</th><th>Classificações</th></tr>${votes.ranking.map(([n, k], i) => `<tr><td>${i + 1}</td><td>${esc(n)}</td><td>${k}</td></tr>`).join('')}</table>`
    : '<p class="muted">Ninguém classificou ainda. Seja a primeira pessoa.</p>';
  const marks = await api.getMarks();
  $('#wall-marks').innerHTML = marks.length
    ? `<table><tr><th>Apelido</th><th>Posição</th><th>Banda</th><th>Nota</th><th>Data</th></tr>${marks.map((m) => `<tr><td>${esc(m.nickname)}</td><td class="mono"><a href="?ra=${m.ra.toFixed(4)}&dec=${m.dec.toFixed(4)}&fov=6&band=${esc(m.band || 'D2')}">${fmtRA(m.ra)} ${fmtDec(m.dec)}</a></td><td>${esc(m.band)}</td><td>${esc(m.note)}</td><td>${esc((m.date || '').slice(0, 10))}</td></tr>`).join('')}</table>`
    : '<p class="muted">Nenhuma marcação ainda. No modo Explorar, clique em um objeto e use “Marcar candidato”.</p>';
}

export async function show(tab, ask) {
  askNick = ask;
  try { await ensure(); } catch {
    if (tab === 'queue') $('#q-info').innerHTML = '<p class="status err">Fila ainda não gerada. Rode: python -m backend.candidates</p>';
  }
  if (tab === 'queue' && data) {
    bind(); renderPipeline();
    const nick = api.getNick();   // começa pelo primeiro candidato que você ainda não classificou
    const firstNew = data.candidates.findIndex((c) => !votes.candidates[c.id]?.voters?.[nick]);
    if (firstNew >= 0 && !viewer.meta) pos = firstNew;
    await showCandidate();
  }
  if (tab === 'wall') await renderWall();
}
