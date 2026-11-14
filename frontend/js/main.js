// Modo Explorar: busca, estado na URL, player e medições por clique.
import { Viewer } from './viewer.js';
import { SkyMap, skyLabel, eqToGal } from './skymap.js';
import { SkySphere, FOV_EARTH, HOME_VIEW } from './skysphere.js';
import { loadAladin, SURVEYS, BARE, spherexChannels } from './aladin.js';
import * as api from './api.js';
import * as missions from './missions.js';
import * as command from './command.js';
import { scatter, PALETTE } from './plot.js';
import {
  aperture, ringPhot, centroid, holeCentroid, computeEpochs, medianStack, robustSigma, tanDeproject, parseCoords,
  fmtRA, fmtDec, fmtDay, fmtDateTime, mjdToDate,
} from './science.js';

const $ = (s) => document.querySelector(s);
const BANDS = { D1: '0,74–1,12 µm', D2: '1,10–1,65 µm', D3: '1,63–2,43 µm', D4: '2,40–3,84 µm', D5: '3,81–4,43 µm', D6: '4,41–5,01 µm' };
const RGB_BANDS = ['D5', 'D3', 'D1'];   // vermelho, verde, azul
const ARCSEC = Math.PI / 180 / 3600;
const HELP = {
  anim: 'Os quadros passam em ordem de data. Tudo foi alinhado: o que pula de lugar se moveu de verdade.',
  blink: 'Alterna entre os quadros A e B. É a técnica que revelou Plutão em 1930.',
  diff: 'A menos B. O que não mudou some. Laranja: ficou mais brilhante ou chegou. Azul: enfraqueceu ou saiu. Um par azul e laranja colado é um objeto que andou.',
  sum: 'Mediana de todas as exposições desta banda: o ruído cai e aparecem objetos fracos.',
  rgb: 'Cor falsa com três bandas: D5 (4 µm) em vermelho, D3 (2 µm) em verde e D1 (0,9 µm) em azul. Objetos frios ficam vermelhos.',
};

const st = { ra: null, dec: null, fov: 6, band: 'D2', target: null };
let targets = [], loadToken = 0, aladin = null, pick = null, queueRegions = [];

const viewer = new Viewer($('#view'), { onFrame: onFrame, onPick: (x, y) => analyze(x, y) });
// roda do mouse sobre a imagem: aproxima o céu inteiro em volta da região, e a imagem vai junto
viewer.onWheel = (e) => {
  if (sky.kind !== 'sphere' || st.ra == null) return false;        // mapa plano: zoom próprio da imagem
  const f = e.deltaY < 0 ? 1.35 : 1 / 1.35;
  sky.flyTo(st.ra, st.dec, Math.min(60, Math.max(0.02, sky.fov() / f)), 0.25);
  return true;
};
const SKY_HINT = 'Role para zoom · arraste para mover · clique para escolher';
const fmtGal = (p) => { const g = eqToGal(p.ra, p.dec); return `l ${g.l.toFixed(2)}° b ${g.b >= 0 ? '+' : '−'}${Math.abs(g.b).toFixed(2)}°`; };
const skyHandlers = {
  onGo: (m) => { hidePop(); $('#q').value = ''; go({ ra: m.ra, dec: m.dec, fov: m.fov ?? st.fov, band: m.band ?? st.band }); },
  onPick: (p, at) => {
    if (!p) return hidePop();
    // com uma região aberta, clicar no céu fora do recorte sai dela (arrastar continua só movendo o céu)
    if (!$('#work').hidden) { closeWork(); writeURL(); return; }
    if (globe?.hits(at.x, at.y)) return hidePop();      // o céu atrás da Terra não está à vista
    const pop = $('#sky-pop');
    $('#sky-pop-coord').innerHTML = `${skyLabel(p)}<br><span class="muted">${p.ra.toFixed(4)}° ${p.dec.toFixed(4)}° · ${fmtGal(p)}</span>`;
    sky.impl?.showPick?.(p);
    pop.hidden = false;
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(innerWidth - r.width - 12, at.x + 14)}px`;
    pop.style.top = `${Math.min(innerHeight - r.height - 12, at.y + 14)}px`;
    $('#sky-pop-go').onclick = () => { hidePop(); $('#q').value = `${p.ra.toFixed(4)} ${p.dec.toFixed(4)}`; go({ ra: p.ra, dec: p.dec, fov: +$('#fov').value, band: $('#band').value }); };
    $('#sky-pop-go').focus();
  },
  onHover: (h) => {
    const el = $('#sky-read');
    if (!h) { el.textContent = SKY_HINT; return; }
    const p = h.marker || h, g = eqToGal(p.ra, p.dec), sg = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
    const f = sky.fov(), ro = (k, v) => `<span class="ro"><i>${k}</i>${v}</span>`;
    el.innerHTML = (h.marker ? ro('alvo', esc(h.marker.label)) : '') + ro('AR', fmtRA(p.ra)) + ro('Dec', fmtDec(p.dec))
      + ro('l', g.l.toFixed(2) + '°') + ro('b', sg(g.b) + '°') + (f ? ro('campo', f >= 1 ? f.toFixed(0) + '°' : (f * 60).toFixed(1) + '′') : '');
  },
};

/**
 * Fachada do panorama: guarda o estado e repassa para a implementação ativa, que é o céu
 * 360° do Aladin (SkySphere) ou, se ele não carregar, o mapa desenhado à mão (SkyMap).
 */
const sky = {
  impl: null, kind: null, state: { markers: null, stars: null, current: null, layers: {} },
  set(o) { if (o.markers) this.state.markers = o.markers; if (o.stars) this.state.stars = o.stars; this.impl?.set(o); },
  setCurrent(ra, dec, fov) { this.state.current = [ra, dec, fov]; this.impl?.setCurrent(ra, dec, fov); },
  setLayer(n, on) { this.state.layers[n] = on; this.impl?.setLayer(n, on); },
  clearPick() { this.impl?.clearPick(); },
  zoomBy(f) { this.impl?.zoomBy(f); },
  reset() { this.impl?.reset(); },
  /** fov em graus; o mapa plano converte para o seu fator de zoom. */
  flyTo(ra, dec, fov, dur) {
    if (!this.impl) { this.pendingFly = [ra, dec, fov, dur]; return; }
    this.kind === 'sphere' ? this.impl.flyTo(ra, dec, fov, dur) : this.impl.flyTo(ra, dec, Math.min(80, Math.max(1, 140 / fov)));
  },
  /** Posição (px da janela) de um ponto do céu, ou null se não estiver à vista. Só no céu 360°. */
  toScreen(ra, dec) {
    if (this.kind !== 'sphere') return null;
    let p = null;
    try { p = this.impl.al.world2pix(ra, dec); } catch { return null; }   // o Aladin lança erro para pontos fora da vista
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
  },
  fov() { return this.kind === 'sphere' ? this.impl.fov() : null; },
  setSurvey(k, slice) { this.impl?.setSurvey?.(k, slice); },
  setSlice(i) { this.impl?.setSlice?.(i); },
  use(impl, kind) {
    this.impl = impl; this.kind = kind;
    const s = this.state;
    if (s.stars || s.markers) impl.set({ stars: s.stars, markers: s.markers });
    if (s.current) impl.setCurrent(...s.current);
    for (const [n, on] of Object.entries(s.layers)) impl.setLayer(n, on);
    setSkyRight(this.inset || 0);
    if (this.pendingFly) { this.flyTo(...this.pendingFly); this.pendingFly = null; }
    if (!$('#work').hidden) fitCutout(0);        // região aberta antes de o céu carregar: encaixa agora
    document.body.dataset.sky = kind;
  },
};
async function initSky() {
  const el = $('#sky');
  try {
    if (new URLSearchParams(location.search).get('sky') === 'plano') throw new Error('mapa plano pedido na URL');
    const sphere = await Promise.race([SkySphere.create(el, skyHandlers), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 15000))]);
    sky.use(sphere, 'sphere');
    sphere.setFovMax(earthOn() ? FOV_EARTH : 230, 0);
    initGlobe();
  } catch (e) {
    console.warn('Panorama 360 indisponível, usando o mapa plano:', e);
    el.innerHTML = '<canvas></canvas>';
    sky.use(new SkyMap(el.firstChild, skyHandlers), 'flat');
    api.loadSky().then((s) => sky.set({ stars: s.stars })).catch(() => {});
  }
}
/**
 * A Terra em tamanho real vista de ~700 km, com o SPHEREx ao lado da câmera (js/globe.js). Só no
 * céu 360°, na aba Céu, com nenhuma região aberta e o botão Terra ligado. Some ao aproximar.
 */
let globe = null;
const earthOn = () => document.querySelector('#sky-layers [data-layer=earth]').classList.contains('on');
async function initGlobe() {
  try {
    const { startGlobe } = await import('./globe.js');
    const R = Math.PI / 180;
    // a vista do céu agora; `earth` diz se a Terra aparece no panorama (a miniatura usa a vista mesmo sem ela)
    const view = () => {
      if (sky.kind !== 'sphere' || document.body.dataset.tab !== 'explore' || !$('#work').hidden
        || document.documentElement.dataset.intro) return null;
      const al = sky.impl.al, [ra, dec] = al.getRaDec(), fov = al.getFov()[0];
      const c = sky.toScreen(ra, dec), n = sky.toScreen(ra, Math.min(89.9, dec + 0.5));
      if (!c) return null;
      const roll = n ? Math.atan2(n[0] - c[0], -(n[1] - c[1])) : 0;
      const a = ra * R, d = dec * R, W = $('#sky').clientWidth || innerWidth;
      return {
        fov, roll, cx: c[0], cy: c[1], raC: ra, decC: dec,
        k: W / 2 / (2 * Math.tan((fov / 4) * R)),                 // escala da projeção estereográfica do Aladin
        C: [Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a)],
        N: [-Math.sin(d) * Math.cos(a), Math.cos(d), Math.sin(d) * Math.sin(a)],
        E: [-Math.sin(a), 0, -Math.cos(a)],
        atMax: fov >= sky.impl.fovMax - 1, toScreen: (r, d) => sky.toScreen(r, d), earth: earthOn(),
      };
    };
    globe = await startGlobe($('#globe'), () => { const v = view(); return v?.earth ? v : null; }, $('#sky'));
    // miniatura da Terra (giroscópio) e a tela grande com quem está online
    const { startEarthView } = await import('./earthview.js');
    await startEarthView({
      mini: $('#mini-earth'), full: $('#earth-full'), snapshot: () => globe.snapshot(view()),
      // o panorama gira junto com o globo enquanto ele está aberto (e volta à vista anterior ao sair)
      skyLink: {
        get: () => { const [ra, dec] = sky.impl.al.getRaDec(); return [ra, dec, sky.fov()]; },
        set: (ra, dec) => sky.impl.al.gotoRaDec(ra, dec),
        restore: (ra, dec, fov) => sky.flyTo(ra, dec, fov, 0.6),
      },
    });
  } catch (e) { console.warn('Terra 3D indisponível:', e); }
}
/** Faixa coberta pela gaveta: o mapa plano encolhe (CSS); o céu 360 só desloca o centro da vista. */
function setSkyRight(px) {
  sky.inset = px;
  document.body.style.setProperty('--sky-right', `${sky.kind === 'flat' ? px : 0}px`);
  sky.impl?.setInset?.({ right: sky.kind === 'flat' ? 0 : px });
}
/** Rótulo do canal do SPHEREx: banda, canal e comprimento de onda (lidos do HiPS do IRSA). */
async function showLambda() {
  const i = +$('#lambda').value;
  let txt = `canal ${i + 1}`;
  try {
    const c = (await spherexChannels()).channels[i];
    if (c) txt = `D${c.band} · ${c.um.toFixed(2).replace('.', ',')} µm`;
  } catch { /* sem o arquivo de propriedades: mostra só o número */ }
  $('#lambda-read').textContent = txt;
}
function hidePop() { $('#sky-pop').hidden = true; sky.clearPick(); }

/** A área de trabalho abre como gaveta; o panorama voa até a região e fica visível ao lado. */
function openWork() {
  hidePop();
  $('#work').hidden = false; $('#work-open').hidden = true; delete document.body.dataset.resume;
  $('#status-slot').append($('#status'));          // as mensagens vão para dentro da gaveta
  document.body.dataset.work = 'open';
  setSkyRight(0);
  fitCutout();
  trackCutout();
}

/**
 * Espaço livre para o recorte: entre a barra de cima e os controles de baixo, e à esquerda dos
 * detalhes quando eles estão abertos. Devolve as margens (px) e o lado do recorte.
 */
function cutoutBox() {
  const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top')) || 60) + 84;   // barra do título + rótulo do recorte
  const bottom = ($('#work .dock')?.offsetHeight || 120) + 30;
  const right = document.body.dataset.details && innerWidth > 900 ? 380 : 0;
  const size = Math.max(180, Math.min(innerWidth - right - 40, innerHeight - top - bottom - 16, 640));
  return { top, bottom, right, size };
}
/** Aproxima o céu até o campo da região ocupar o espaço livre. */
function fitCutout(dur) {
  const b = cutoutBox();
  sky.impl?.setInset?.({ right: b.right, top: b.top, bottom: b.bottom });
  if (st.ra != null) sky.flyTo(st.ra, st.dec, sky.kind === 'sphere' ? ((st.fov / 60) * ($('#sky').clientWidth || innerWidth)) / b.size : 12, dur);
}
/**
 * Mantém a imagem do SPHEREx colada ao céu: a cada quadro lê onde o centro e a borda norte do campo
 * caem na tela e ajusta posição, tamanho e rotação. Assim arrastar ou dar zoom no céu leva a imagem
 * junto, e o resto do céu continua visível em volta. No mapa plano a imagem fica fixa no centro.
 */
let cutRaf = 0, cutKey = '';
function trackCutout() {
  cancelAnimationFrame(cutRaf);
  const wrap = $('#work .canvas-wrap');
  const place = () => {
    // centro e tamanho reais do cubo (meta), não os pedidos: o cubo tem n pixels de pixscale″
    const m = viewer.meta, ra0 = m?.ra ?? st.ra, dec0 = m?.dec ?? st.dec;
    const half = m ? (viewer.n * m.pixscale) / 7200 : st.fov / 120;           // meio lado, em graus
    let x, y, side, ang = 0, flip = 1, show = true;
    const lab = `SPHEREx · ${st.band} · ${((half * 120)).toFixed(1).replace('.', ',')}′`;
    if (wrap.dataset.label !== lab) wrap.dataset.label = lab;
    if (sky.kind === 'sphere') {
      // eixos norte e leste do campo na tela: dão posição, escala, rotação (o céu pode estar girado)
      // e espelhamento; se o campo sai da vista, a imagem some em vez de ficar solta na tela
      const c = ra0 != null ? sky.toScreen(ra0, dec0) : null;
      const nP = c && sky.toScreen(ra0, Math.min(89.999, dec0 + half));
      const eP = c && sky.toScreen((ra0 + half / Math.max(0.01, Math.cos(dec0 * Math.PI / 180)) + 360) % 360, dec0);
      if (c && nP && eP) {
        const nx = nP[0] - c[0], ny = nP[1] - c[1], ex = eP[0] - c[0], ey = eP[1] - c[1];
        side = 2 * Math.hypot(nx, ny); [x, y] = c; ang = Math.atan2(nx, -ny);
        flip = nx * ey - ny * ex < 0 ? 1 : -1;     // leste à esquerda do norte (padrão do céu) ou espelhado
      } else show = false;
    }
    if (side == null) { const b = cutoutBox(); side = b.size; x = (innerWidth - b.right) / 2; y = b.top + (innerHeight - b.top - b.bottom) / 2; }
    // a resolução do canvas tem teto; acima dele a imagem só é ampliada
    const base = Math.min(side, 1400), k = side / base;
    const key = `${show} ${x.toFixed(1)} ${y.toFixed(1)} ${side.toFixed(1)} ${ang.toFixed(4)} ${flip}`;
    if (key === cutKey) return;
    cutKey = key;
    wrap.style.cssText = `width:${base}px;height:${base}px;left:${x - base / 2}px;top:${y - base / 2}px;`
      + `transform:rotate(${ang}rad) scale(${k * flip},${k});visibility:${show ? 'visible' : 'hidden'}`;
  };
  const step = () => {
    if ($('#work').hidden || document.body.classList.contains('embed')) { cutRaf = 0; return; }
    try { place(); } catch (e) { console.warn('recorte:', e); }   // um erro não pode parar o acompanhamento
    cutRaf = requestAnimationFrame(step);
  };
  step();
}
function closeWork() {
  if ($('#work').hidden) return;
  $('#work').hidden = true; delete document.body.dataset.work;
  $('.top').after($('#status'));
  viewer.set({ playing: false }); syncControls();
  if (!$('#status').classList.contains('err')) status('');
  $('#work-open').hidden = st.ra == null;
  if (st.ra != null) document.body.dataset.resume = '1';
  cancelAnimationFrame(cutRaf); cutRaf = 0;
  setSkyRight(0); sky.impl?.setInset?.({ right: 0, top: 0, bottom: 0 });
  if (st.ra != null) sky.flyTo(st.ra, st.dec, 40);
}

/** Atualiza os marcadores do panorama e a lista de buscas recentes. */
async function refreshSky() {
  let regions = [];
  try { regions = await api.loadRegions(); } catch { /* sem API: só os exemplos */ }
  const isTarget = (r) => targets.some((t) => Math.abs(t.ra - r.ra) < 2e-4 && Math.abs(t.dec - r.dec) < 2e-4);
  const extra = regions.filter((r) => !isTarget(r));
  const seen = new Set();
  const recent = extra.filter((r) => { const k = `${r.ra},${r.dec}`; if (seen.has(k)) return false; seen.add(k); return true; });
  sky.set({ markers: [
    ...targets.map((t) => ({ ra: t.ra, dec: t.dec, fov: t.fov, band: t.band, label: t.title, kind: 'example' })),
    ...queueRegions.map((q) => ({ ...q, kind: 'queue' })),
    ...recent.map((r) => ({ ra: r.ra, dec: r.dec, fov: r.fov, band: r.bands[0], label: 'busca recente', kind: 'cached' })),
  ] });
  $('#regions-panel').hidden = !recent.length;
  $('#regions').innerHTML = recent.slice(0, 8).map((r, i) => `<button data-i="${i}">${fmtRA(r.ra)} ${fmtDec(r.dec)}<small>campo ${r.fov}′ · ${r.bands.sort().join(', ')}</small></button>`).join('');
  $('#regions').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = recent[+b.dataset.i];
    $('#q').value = ''; go({ ra: r.ra, dec: r.dec, fov: r.fov, band: r.bands.includes(st.band) ? st.band : r.bands[0] });
  };
}

/** Coluna de detalhes da janela (Região, Medição, Quadro): fechada por padrão. */
function setDetails(on) {
  const was = !!document.body.dataset.details;
  if (on) document.body.dataset.details = '1'; else delete document.body.dataset.details;
  $('#details-btn').classList.toggle('on', !!on);
  if (was !== !!on && !$('#work').hidden && innerWidth > 900) fitCutout(0.5);   // abre espaço para a coluna
}
function showPane(name) {
  document.querySelectorAll('.itabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === name));
  for (const p of ['about', 'measure', 'frame']) $(`#pane-${p}`).hidden = p !== name;
}

window.spx = { viewer, sky, st, get globe() { return globe; }, get pick() { return pick; }, variability: (pts, sat) => variability(pts, sat) };   // facilita depuração e testes

// ------------------------------------------------------------------ utilidades
function status(msg, cls = '') { const s = $('#status'); s.textContent = msg; s.className = 'status ' + cls; }
function loading(msg, frac) {
  const l = $('#loading');
  l.hidden = msg == null;
  if (msg != null) { l.querySelector('span').textContent = msg; l.querySelector('i').style.width = `${Math.max(5, (frac || 0) * 100)}%`; }
}
const num = (v, d = 2) => v.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function askNick(force = false) {
  return new Promise((resolve) => {
    if (api.getNick() && !force) return resolve(api.getNick());
    const dlg = $('#nick-dialog');
    $('#nick-input').value = api.getNick();
    // Enter salva (sem isso o formulário usaria o primeiro botão, que é o Cancelar)
    $('#nick-input').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); dlg.close('ok'); } };
    dlg.onclose = () => {
      const v = $('#nick-input').value.trim();
      if (dlg.returnValue === 'ok' && v) { api.setNick(v); showNick(); resolve(v); } else resolve(null);
    };
    dlg.showModal();
  });
}
function showNick() { $('#nick-btn').textContent = api.getNick() ? `👤 ${api.getNick()}` : 'Escolher apelido'; }

// ------------------------------------------------------------------ URL
function readURL() {
  const p = new URLSearchParams(location.search);
  const out = { tab: p.get('tab') || 'explore', embed: p.get('embed') === '1' };
  const ra = parseFloat(p.get('ra')), dec = parseFloat(p.get('dec'));
  if (Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90) {
    out.ra = ra; out.dec = dec;
    const fov = parseFloat(p.get('fov'));
    out.fov = Number.isFinite(fov) ? Math.min(30, Math.max(2, fov)) : 6;
    out.band = BANDS[p.get('band')] ? p.get('band') : null;
  } else if (p.get('target')) out.targetId = p.get('target');
  out.view = HELP[p.get('view')] ? p.get('view') : null;
  out.frames = ['epochs', 'exposures'].includes(p.get('frames')) ? p.get('frames') : null;
  out.f = parseInt(p.get('f'), 10);
  return out;
}
function writeURL(push = false) {
  const p = new URLSearchParams();
  const tab = document.querySelector('.tabs .on').dataset.tab;
  if (tab !== 'explore') p.set('tab', tab);
  if (st.ra != null) {
    p.set('ra', st.ra.toFixed(4)); p.set('dec', st.dec.toFixed(4)); p.set('fov', String(st.fov)); p.set('band', st.band);
    const s = viewer.s;
    if (s.view !== 'anim') p.set('view', s.view);
    if (s.frameMode !== 'epochs') p.set('frames', s.frameMode);
    if (!s.playing && s.view === 'anim' && s.idx) p.set('f', String(s.idx));
  }
  if (document.body.classList.contains('embed')) p.set('embed', '1');
  if (new URLSearchParams(location.search).get('sky') === 'plano') p.set('sky', 'plano');   // o modo plano continua visível no endereço
  const url = `${location.pathname}?${p}`;
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}

// ------------------------------------------------------------------ carregar região
async function go(req, { push = true, view, frames, f } = {}) {
  const token = ++loadToken;
  Object.assign(st, { ra: +req.ra.toFixed(4), dec: +req.dec.toFixed(4), fov: req.fov ?? st.fov, band: req.band ?? st.band });
  sky.setCurrent(st.ra, st.dec, st.fov);
  st.target = targets.find((t) => Math.abs(t.ra - st.ra) < 2e-4 && Math.abs(t.dec - st.dec) < 2e-4) || null;
  $('#fov').value = String(st.fov); $('#band').value = st.band;
  document.querySelectorAll('#targets button').forEach((b) => b.classList.toggle('on', b.dataset.id === st.target?.id));
  renderTitle();
  if ($('#tab-explore').hidden) await showTab('explore', false);
  if ($('#work').hidden) openWork(); else fitCutout();
  viewer.set({ playing: false });
  status('');
  loading('Procurando imagens do SPHEREx…', 0);
  try {
    const { meta, cube } = await api.loadCube(st.ra, st.dec, st.fov, st.band, (d, t) => {
      if (token === loadToken) loading(t ? `Baixando e alinhando exposições: ${d} de ${t}` : 'Consultando o arquivo do IRSA…', t ? d / t : 0.03);
    });
    if (token !== loadToken) return;
    pick = null; showPane('about'); setDetails(false);
    viewer.markers = st.target?.markers || [];
    viewer.cats = {};
    viewer.setData(meta, cube);
    const wantView = view && view !== 'rgb' ? view : 'anim';
    viewer.set({ view: wantView, frameMode: frames || (viewer.epochs.length >= 2 ? 'epochs' : 'exposures') });
    if (Number.isFinite(f)) viewer.set({ idx: f });
    else viewer.set({ playing: true, fps: +$('#fps').value });
    buildFrameUI(); renderAbout(); renderPickEmpty(); syncControls();
    $('#stretch').value = String(viewer.s.stretch);
    loading(null);
    const nE = viewer.epochs.length;
    status(`${meta.n} exposições em ${nE} época${nE > 1 ? 's' : ''}, de ${fmtDay(meta.frames[0].mjd)} a ${fmtDay(meta.frames[meta.n - 1].mjd)}.`
      + (meta.n_failed ? ` ${meta.n_failed} não puderam ser baixadas.` : ''), 'ok');
    writeURL(push);
    refreshSky();
    missions.regionOpened(st.ra, st.dec, !!st.target);
    document.dispatchEvent(new CustomEvent('spx:region', { detail: { target: st.target?.id || null, band: st.band } }));
    api.loadFlags(meta).then((fl) => { if (token === loadToken) viewer.setFlags(fl); }).catch(() => {});
    for (const cat of ['gaia', 'catwise']) if ($(`#ck-${cat}`).checked) toggleCatalog(cat, true);
    if (view === 'rgb') setView('rgb');
    if (aladin) { aladin.gotoRaDec(st.ra, st.dec); aladin.setFoV((st.fov / 60) * 1.6); }
  } catch (e) {
    if (token !== loadToken) return;
    loading(null);
    if (!viewer.cube) closeWork();
    status(e.message || String(e), 'err');
  }
}

function renderTitle() {
  $('#work-title').textContent = st.target ? st.target.title : 'Região escolhida';
  $('#work-sub').textContent = `${fmtRA(st.ra)} ${fmtDec(st.dec)} · ${st.fov}′ · ${st.band}`;
}

function renderAbout() {
  const t = st.target, m = viewer.meta;
  const coords = `<p class="muted small mono">${fmtRA(st.ra)} ${fmtDec(st.dec)} · campo ${st.fov}′ · banda ${st.band} (${BANDS[st.band]})</p>`;
  $('#about').innerHTML = t
    ? `<h2>${esc(t.title)}</h2><div class="kind">${esc(t.kind)}</div><p>${esc(t.legend)}</p>${coords}`
    : `<h2>Região escolhida</h2><p>Compare as épocas. O que estiver parado é estrela ou galáxia distante; o que mudar de lugar está perto de nós.</p>${coords}`;
  void m;
}

// ------------------------------------------------------------------ player e controles
function buildFrameUI() {
  const k = viewer.frameCount();
  $('#slider').max = String(k - 1);
  const opts = Array.from({ length: k }, (_, i) => { const f = viewer.frameInfo(i); return `<option value="${i}">${f.kind === 'epoch' ? f.label : `${f.label.slice(0, 16)} · ${f.sub}`}</option>`; }).join('');
  $('#sel-a').innerHTML = opts; $('#sel-b').innerHTML = opts;
  $('#sel-a').value = String(viewer.s.a); $('#sel-b').value = String(viewer.s.b);
  // linha do tempo: um risco por exposição, proporcional à data
  const ex = viewer.exposures, t0 = ex[0].mjd, span = Math.max(1, ex[ex.length - 1].mjd - t0);
  const pos = (mjd) => 1 + ((mjd - t0) / span) * 97;
  let lastLabel = -99;
  $('#timeline').innerHTML = ex.map((f) => `<i style="left:${pos(f.mjd).toFixed(2)}%"></i>`).join('')
    + viewer.epochs.map((e) => {
      const at = Math.min(84, pos(e.mjdMax) + 0.8);
      if (at - lastLabel < 16) return '';   // evita rótulos sobrepostos
      lastLabel = at;
      return `<span style="left:${at.toFixed(2)}%">${e.label}</span>`;
    }).join('');
}

function syncControls() {
  const s = viewer.s;
  document.querySelectorAll('#view-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.view));
  document.querySelectorAll('#frame-mode button').forEach((b) => {
    b.classList.toggle('on', b.dataset.m === s.frameMode);
    b.disabled = b.dataset.m === 'epochs' && viewer.epochs && viewer.epochs.length < 2;
  });
  $('#ab-row').hidden = !(s.view === 'blink' || s.view === 'diff');
  $('#view-help').textContent = HELP[s.view];
  $('#play').textContent = s.playing ? '❚❚' : '▶';
  const canPlay = s.view === 'anim' || s.view === 'blink';
  for (const id of ['#play', '#prev', '#next', '#slider']) $(id).disabled = !canPlay || (id !== '#play' && s.view === 'blink');
}

function onFrame(v) {
  const s = v.s, i = v.current(), k = v.frameCount(), info = v.frameInfo(i);
  $('#slider').value = String(i);
  $('#counter').textContent = s.view === 'anim' || s.view === 'blink' ? `${i + 1}/${k}` : '';
  const ticks = $('#timeline').children;
  const active = (s.view === 'diff' || s.view === 'sum' || s.view === 'rgb') ? null : (info.kind === 'epoch' ? new Set(info.epoch.members) : new Set([i]));
  for (let t = 0; t < v.exposures.length && t < ticks.length; t++) ticks[t].classList.toggle('on', !!active && active.has(t));
  let html;
  if (s.view === 'sum' || s.view === 'rgb') {
    html = `<span class="k">Imagem</span><span class="v">${s.view === 'sum' ? `mediana de ${v.exposures.length} exposições` : 'composição de três bandas'}</span>`;
  } else if (info.kind === 'epoch') {
    html = `<span class="k">Época</span><span class="v">${info.label}</span>
      <span class="k">Período</span><span class="v">${info.range}</span>
      <span class="k">Imagem</span><span class="v">${info.sub}</span>`;
  } else {
    const f = info.frame;
    const tags = f.flags_center.length ? f.flags_center.map((n) => `<span class="tag ${v.meta.bad_bits.some((b) => v.meta.flag_bits[b] === n) ? 'bad' : ''}">${n}</span>`).join('') : '<span class="tag ok">nenhuma</span>';
    html = `<span class="k">Data</span><span class="v">${info.label}</span>
      <span class="k">Comprimento de onda</span><span class="v">${num(f.wl, 3)} µm (largura ${num(f.bw, 3)})</span>
      <span class="k">Observação</span><span class="v">${f.obsid} · <a href="${f.url}" target="_blank" rel="noopener">FITS original</a></span>
      <span class="k">Flags no centro</span><span class="v">${tags}</span>`;
  }
  $('#frame-info').innerHTML = html;
}

async function setView(view) {
  if (view === 'rgb') {
    const token = loadToken;
    try {
      const chans = [];
      for (const [k, b] of RGB_BANDS.entries()) {
        loading(`Carregando banda ${b} para a cor falsa (${k + 1} de 3)…`, k / 3);
        const { meta, cube } = await api.loadCube(st.ra, st.dec, st.fov, b, (d, t) => loading(`Banda ${b}: ${d} de ${t || '?'} exposições`, (k + (t ? d / t : 0)) / 3));
        if (token !== loadToken) return;
        const img = medianStack(cube, meta.size * meta.size, meta.frames.map((_, i) => i));
        chans.push({ img, sigma: robustSigma(img).sigma * 3 });
      }
      viewer.rgb = chans;
    } catch (e) { loading(null); status(`Cor falsa indisponível: ${e.message}`, 'err'); return; }
    loading(null);
  }
  viewer.set({ view, playing: view === 'blink' ? true : viewer.s.playing && view === 'anim' });
  syncControls(); writeURL();
}

async function toggleCatalog(cat, on) {
  if (!on) { delete viewer.cats[cat]; viewer.render(); return; }
  try {
    const c = await api.loadCatalog(st.ra, st.dec, st.fov, cat);
    viewer.cats[cat] = c.rows; viewer.render();
  } catch (e) { $(`#ck-${cat}`).checked = false; status(`Catálogo ${cat} indisponível: ${e.message}`, 'err'); }
}

// ------------------------------------------------------------------ medições por clique
function renderPickEmpty() {
  $('#pick').innerHTML = '<p class="muted">Clique em um objeto na imagem para medir se ele se moveu, ver a curva de luz e o espectro.</p>';
}

/**
 * Fotometria em todas as exposições de um cubo. `track(mjd)` devolve a posição do objeto
 * naquela data (objetos que andam levam a abertura junto). Se o miolo está saturado na
 * maioria das exposições, usa a fotometria das asas.
 */
function photometry(meta, cube, x, y, band, track, forceWings) {
  const n = meta.size, n2 = n * n, sc = meta.pixscale, c = (n - 1) / 2;
  const rAp = 12.3 / sc, rIn = 24.6 / sc, rOut = 43 / sc, toMJy = (sc * ARCSEC) ** 2 * 1e9;
  const ap = [], wing = [];
  // o anel das asas começa fora da mancha saturada, cujo tamanho é estimado em três exposições
  let hole = 0;
  for (const i of [0, meta.n >> 1, meta.n - 1]) {
    const h = holeCentroid(cube.subarray(i * n2, (i + 1) * n2), n, x, y);
    if (h) hole = Math.max(hole, Math.sqrt(h.area / Math.PI));
  }
  const w1 = Math.max(36 / sc, hole + 12 / sc), w2 = w1 + 19 / sc;
  const b2 = Math.min(w2 + 55 / sc, n / 2 - 2), b1 = Math.max(w2 + 8 / sc, b2 - 30 / sc);
  meta.frames.forEach((f, i) => {
    const [px, py] = track ? track(f.mjd) : [x, y];
    const img = cube.subarray(i * n2, (i + 1) * n2);
    const base = { mjd: f.mjd, wl: f.wl + f.dwl[0] * (px - c) + f.dwl[1] * (py - c), band };
    const a = aperture(img, n, px, py, rAp, rIn, rOut);
    if (a && a.nanFrac <= 0.15) ap.push({ ...base, flux: a.sum * toMJy, err: a.err * toMJy });
    const w = ringPhot(img, n, px, py, w1, w2, b1, b2);
    if (w) wing.push({ ...base, flux: w.sum * toMJy, err: w.err * toMJy });
  });
  const saturated = forceWings ?? (ap.length < 0.5 * meta.n && wing.length > ap.length);
  const pts = saturated ? wing : ap;
  return { pts, skipped: meta.n - pts.length, saturated };
}

function motion(x, y) {
  const v = viewer, sc = v.meta.pixscale, rows = [];
  let cx = x, cy = y;
  v.epochs.forEach((e, k) => {
    let c = centroid(v.stacks[k], v.n, cx, cy, Math.max(3, Math.round(15 / sc)));
    if (!c || c.snr < 4) {
      const h = holeCentroid(v.stacks[k], v.n, cx, cy);   // estrela saturada: mede pelo contorno da mancha
      c = h ? { x: h.x, y: h.y, snr: Infinity, hole: true } : null;
    }
    if (!c) { rows.push({ e, ok: false }); return; }
    cx = c.x; cy = c.y;
    rows.push({ e, ok: true, x: c.x, y: c.y, snr: c.snr, hole: c.hole, err: c.hole ? 2.0 : 7 / c.snr + 0.4 });
  });
  const ok = rows.filter((r) => r.ok);
  if (ok.length < 2) return { rows, ok };
  const a = ok[0], b = ok[ok.length - 1];
  for (const r of ok) { r.de = -(r.x - a.x) * sc; r.dn = (r.y - a.y) * sc; }
  const d = Math.hypot(b.de, b.dn), err = Math.hypot(a.err, b.err), years = (b.e.mjd - a.e.mjd) / 365.25;
  // posições medidas de jeitos diferentes (mancha saturada x centroide normal) não são comparáveis
  const hole = ok.some((r) => r.hole), mixed = hole && !ok.every((r) => r.hole);
  return { rows, ok, d, err, years, hole, mixed, rate: d / years, moving: !mixed && d > 3 * err && d > 1.5, pa: (Math.atan2(b.de, b.dn) * 180 / Math.PI + 360) % 360 };
}

/**
 * O brilho mudou entre as épocas? Cada exposição cai em um comprimento de onda diferente,
 * e o espectro pode ser bem acidentado. Por isso só comparamos medidas "casadas": pontos de
 * épocas diferentes com quase o mesmo comprimento de onda (menos de meio canal de distância).
 */
function variability(pts, saturated) {
  const good = pts.filter((p) => p.flux > 4 * p.err && p.flux > 0);
  if (good.length < 8) return null;
  const sorted = [...good].sort((a, b) => a.mjd - b.mjd);
  const eps = computeEpochs(sorted);
  if (eps.length < 2) return null;
  const ref = eps.reduce((a, b) => (b.members.length > a.members.length ? b : a));
  const refPts = ref.members.map((i) => sorted[i]);
  const per = [{ label: ref.label, r: 1, sd: 0, n: refPts.length }];
  for (const e of eps) {
    if (e === ref) continue;
    const ratios = [];
    for (const i of e.members) {
      const p = sorted[i];
      let best = null;
      for (const q of refPts) if (!best || Math.abs(q.wl - p.wl) < Math.abs(best.wl - p.wl)) best = q;
      if (best && Math.abs(best.wl - p.wl) < 0.012 * p.wl) ratios.push(p.flux / best.flux);
    }
    if (ratios.length < 4) continue;
    ratios.sort((x, y) => x - y);
    const med = ratios[ratios.length >> 1];
    const mad = ratios.map((r) => Math.abs(r - med)).sort((x, y) => x - y)[ratios.length >> 1];
    per.push({ label: e.label, r: med, sd: (1.4826 * mad) / Math.sqrt(ratios.length), n: ratios.length });
  }
  if (per.length < 2) return null;
  const hi = per.reduce((a, b) => (b.r > a.r ? b : a)), lo = per.reduce((a, b) => (b.r < a.r ? b : a));
  const mean = per.reduce((t, x) => t + x.r, 0) / per.length;
  const amp = (hi.r - lo.r) / mean, sd = Math.hypot(hi.sd, lo.sd) / mean + 0.01;
  // a fotometria das asas tem um piso de erro maior (~10%, medido na Estrela de Barnard, que é estável)
  const variable = saturated ? amp > 0.2 && amp > 3 * sd : amp > 0.08 && amp > 5 * sd;
  const stable = saturated ? amp < 0.12 && sd < 0.06 : amp < 0.08 && sd < 0.03;
  return { amp, sd, per: per.map((x) => [x.label, x.r / mean]), variable, stable };
}

function drawPlots(pts) {
  const ylabel = pick?.saturated ? 'brilho nas asas (mJy)' : 'fluxo (mJy)';
  if (!pts.length) { $('#plots').innerHTML = '<p class="muted">Sem medidas válidas (pixels saturados ou sinalizados).</p>'; return; }
  const sorted = [...pts].sort((a, b) => a.mjd - b.mjd);
  const eps = computeEpochs(sorted);
  const eg = eps.map((e, i) => ({ label: e.label, color: PALETTE[i % PALETTE.length] }));
  const wls = pts.map((p) => p.wl), w0 = Math.min(...wls), w1 = Math.max(...wls) + 1e-9, nb = 3;
  const wg = Array.from({ length: nb }, (_, i) => ({ label: `${num(w0 + (i * (w1 - w0)) / nb)}–${num(w0 + ((i + 1) * (w1 - w0)) / nb)} µm`, color: ['#7c9cff', '#4fc38a', '#f0a050'][i] }));
  $('#plots').innerHTML = '<p class="plot-title">Espectro: brilho por comprimento de onda, uma cor por época</p><div id="p-spec"></div>'
    + '<p class="plot-title">Curva de luz: brilho ao longo do tempo</p><div id="p-lc"></div>';
  scatter($('#p-spec'), sorted.map((p) => ({ x: p.wl, y: +p.flux.toPrecision(4), err: p.err, group: p.ep, tip: `${num(p.wl, 3)} µm · ${p.flux.toPrecision(3)} mJy · ${fmtDay(p.mjd)}` })), eg,
    { xlabel: 'comprimento de onda (µm)', ylabel, xfmt: (v) => String(v).replace('.', ',') });
  scatter($('#p-lc'), sorted.map((p) => ({ x: p.mjd, y: +p.flux.toPrecision(4), err: p.err, group: Math.min(nb - 1, Math.floor(((p.wl - w0) / (w1 - w0)) * nb)), tip: `${fmtDateTime(p.mjd)} · ${num(p.wl, 3)} µm · ${p.flux.toPrecision(3)} mJy` })), wg,
    { xlabel: 'data', ylabel, xfmt: (v) => { const d = mjdToDate(v); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; } });
}

function analyze(x, y) {
  const v = viewer, n = v.n;
  const snap = centroid(v.total, n, x, y, 3, 2);
  if (snap && Math.hypot(snap.x - x, snap.y - y) < 4 && snap.snr > 5) { x = snap.x; y = snap.y; }
  v.sel = { x, y }; v.render(); showPane('measure'); setDetails(true);
  const off = v.pixelToOffset(x, y), sky = tanDeproject(off.xi, off.eta, v.meta.ra, v.meta.dec);
  const mv = motion(x, y);
  // objetos que andam: a abertura acompanha a posição medida em cada época
  const track = mv.moving && !mv.hole ? (mjd) => {
    let best = null;
    for (const r of mv.ok) if (!best || Math.abs(r.e.mjd - mjd) < Math.abs(best.e.mjd - mjd)) best = r;
    return [best.x, best.y];
  } : null;
  const ph = photometry(v.meta, v.cube, x, y, st.band, track), vr = variability(ph.pts, ph.saturated);
  pick = { x, y, sky, pts: ph.pts, bands: new Set([st.band]), track, saturated: ph.saturated };

  let verdict = '';
  if (mv.d != null && mv.mixed) {
    verdict = '<div class="verdict">Estrela saturada em parte das épocas: as posições não são comparáveis, então não dá para dizer se ela se moveu.</div>';
  } else if (mv.d != null) {
    verdict = mv.moving
      ? `<div class="verdict move"><b>Parece se mover: ${num(mv.d, 1)}″</b> em ${num(mv.years, 2)} ano(s), cerca de <b>${num(mv.rate, 1)}″ por ano</b>, direção ${Math.round(mv.pa)}° (0° = norte, 90° = leste). Precisão estimada ±${num(mv.err, 1)}″.</div>`
      : `<div class="verdict still"><b>Parado</b> dentro da precisão: deslocamento medido ${num(mv.d, 1)}″ (±${num(mv.err, 1)}″) em ${num(mv.years, 2)} ano(s).</div>`;
  } else verdict = '<div class="verdict">Sinal fraco demais para medir a posição em duas épocas. Tente a visão Soma ou outra banda.</div>';
  if (vr?.variable) {
    verdict += `<div class="verdict move"><b>Brilho mudou ${Math.round(vr.amp * 100)}%</b> entre as épocas (${vr.per.map(([l, r]) => `${l}: ${r >= 1 ? '+' : '−'}${Math.abs(Math.round((r - 1) * 100))}%`).join(' · ')}).</div>`;
  } else if (vr?.stable) {
    verdict += `<div class="verdict still"><b>Brilho estável</b>: variação de ${Math.round(vr.amp * 100)}% entre as épocas.</div>`;
  } else if (vr) {
    verdict += `<div class="verdict">Variação de ${Math.round(vr.amp * 100)}% entre as épocas, dentro da incerteza desta medida. Tente outra banda.</div>`;
  }
  if (ph.saturated) verdict += '<div class="verdict">Este objeto é tão brilhante que saturou o detector. O brilho foi medido nas “asas” (o halo em volta da mancha): serve para comparar épocas, mas não é o fluxo total.</div>';
  const rows = mv.rows.map((r) => r.ok
    ? `<tr><td>${r.e.label}</td><td>${r.de == null ? '' : num(r.de, 1) + '″'}</td><td>${r.dn == null ? '' : num(r.dn, 1) + '″'}</td><td>${r.hole ? 'saturada' : Math.round(r.snr)}</td></tr>`
    : `<tr><td>${r.e.label}</td><td colspan="3" class="muted">sem detecção</td></tr>`).join('');
  $('#pick').innerHTML = `
    <p class="mono small">${fmtRA(sky.ra)} ${fmtDec(sky.dec)}<br><span class="muted">${sky.ra.toFixed(5)}° ${sky.dec.toFixed(5)}°</span></p>
    ${verdict}
    <table><tr><th>Época</th><th>Δ leste</th><th>Δ norte</th><th>S/R</th></tr>${rows}</table>
    <p class="muted small">Posição medida em cada época em relação à primeira. Um pixel do SPHEREx tem 6,15″.</p>
    <div id="flags-here" class="small"></div>
    <div id="plots"></div>
    <p class="muted small" id="phot-note">${ph.skipped ? `${ph.skipped} de ${v.meta.n} exposições ficaram de fora por terem pixels sinalizados (saturação, raio cósmico) na abertura.` : ''}</p>
    <div class="row">
      <button id="btn-full">Espectro completo (6 bandas)</button>
      <button id="btn-mark" class="primary">Marcar candidato</button>
    </div>`;
  drawPlots(ph.pts);
  if (v.flags) {
    const p = Math.round(y) * n + Math.round(x), count = {};
    for (let i = 0; i < v.meta.n; i++) { const f = v.flags[i * v.n2 + p]; for (const [bit, name] of Object.entries(v.meta.flag_bits)) if (f & (1 << bit)) count[name] = (count[name] || 0) + 1; }
    const bad = new Set(v.meta.bad_bits.map((b) => v.meta.flag_bits[b]));
    $('#flags-here').innerHTML = '<span class="muted">Flags neste pixel: </span>' + (Object.keys(count).length
      ? Object.entries(count).map(([k, c]) => `<span class="tag ${bad.has(k) ? 'bad' : ''}" title="${c} de ${v.meta.n} exposições">${k} ${c}/${v.meta.n}</span>`).join('')
      : '<span class="tag ok">nenhuma</span>');
  }
  $('#btn-full').onclick = fullSpectrum;
  $('#btn-mark').onclick = markHere;
  // para o modo missões: a mesma medida mostrada acima, sem nenhuma alteração
  const okMotion = mv.d != null && !mv.mixed;
  document.dispatchEvent(new CustomEvent('spx:measure', { detail: {
    pm: okMotion ? mv.rate : null, pa: okMotion ? mv.pa : null, moving: okMotion && mv.moving,
    varPct: vr ? vr.amp * 100 : null, band: st.band, target: st.target?.id || null, ra: sky.ra, dec: sky.dec,
  } }));
}

async function fullSpectrum() {
  const btn = $('#btn-full'), token = loadToken, here = pick;
  btn.disabled = true;
  try {
    for (const b of Object.keys(BANDS)) {
      if (here.bands.has(b)) continue;
      btn.textContent = `Carregando banda ${b}…`;
      const { meta, cube } = await api.loadCube(st.ra, st.dec, st.fov, b, (d, t) => { btn.textContent = `Banda ${b}: ${d}/${t || '?'}`; });
      if (token !== loadToken || pick !== here) return;
      here.pts.push(...photometry(meta, cube, here.x, here.y, b, here.track, here.saturated).pts);
      here.bands.add(b);
      drawPlots(here.pts);
    }
    btn.textContent = 'Espectro completo carregado';
  } catch (e) { btn.textContent = 'Falhou: ' + e.message; btn.disabled = false; }
}

async function markHere() {
  if (!(await askNick())) return;
  const note = prompt('Uma nota curta sobre o que você viu (opcional):', '') ?? '';
  await api.sendMark({ ra: pick.sky.ra, dec: pick.sky.dec, band: st.band, note: note.slice(0, 200), sid: api.sessionId() });
  missions.markMade();
  $('#btn-mark').textContent = 'Marcado ✓'; $('#btn-mark').disabled = true;
}

// ------------------------------------------------------------------ busca
async function search(text) {
  const q = text.trim();
  if (!q) return;
  const fov = +$('#fov').value, band = $('#band').value;
  const c = parseCoords(q);
  if (c) return go({ ra: c.ra, dec: c.dec, fov, band });
  const t = targets.find((t) => t.title.toLowerCase() === q.toLowerCase());
  if (t) return go({ ra: t.ra, dec: t.dec, fov, band });
  status(`Procurando “${q}” no SIMBAD…`);
  try {
    const r = await api.resolveName(q);
    await go({ ra: r.ra, dec: r.dec, fov, band });
    if (r.epoch !== 2000) status(`${r.name}: posição do SIMBAD corrigida pelo movimento próprio até ${r.epoch}. ` + $('#status').textContent, 'ok');
  } catch (e) {
    status(e instanceof TypeError ? 'Busca por nome indisponível sem o servidor. Use coordenadas ou um exemplo.' : e.message, 'err');
  }
}

// ------------------------------------------------------------------ abas
async function showTab(tab, push = true) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((m) => { m.hidden = m.id !== `tab-${tab}`; });
  if (tab !== 'explore') viewer.set({ playing: false });
  if (tab === 'missions') await command.show().catch((e) => console.warn(e));
  else if (tab !== 'explore') {
    const q = await import('./queue.js'); await q.show(tab, askNick);
    if (tab === 'wall') command.renderLeaderboard($('#wall-xp')).catch(() => {});
  }
  command.renderBar();
  if (push) writeURL(true);
}

async function initAladin() {
  if (aladin) return;
  try {
    const A = await loadAladin();
    aladin = A.aladin('#aladin', { ...BARE, showZoomControl: true, showReticle: true, target: `${st.ra} ${st.dec}`, fov: (st.fov / 60) * 1.6, survey: SURVEYS.twomass.url });
  } catch { $('#aladin').innerHTML = '<p class="muted">Não foi possível carregar o Aladin Lite (sem internet?).</p>'; }
}

// ------------------------------------------------------------------ início
/** Tela inicial (só no endereço sem parâmetros). A cena 3D carrega à parte; o céu carrega por trás. */
function setupIntro() {
  const el = $('#intro');
  let scene = null, left = false;
  import('./intro.js').then((m) => m.startIntro($('#intro-scene')))
    .then((s) => { if (left) s.stop(); else scene = s; })
    .catch((e) => console.warn('Tela inicial sem 3D:', e));
  const leave = (tab) => {
    if (left) return;
    left = true;
    if (tab) showTab(tab);
    el.classList.add('leaving');
    setTimeout(() => { delete document.documentElement.dataset.intro; el.classList.remove('leaving'); scene?.stop(); scene = null; }, 650);
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-intro]');
    if (!b) return;
    if (b.dataset.intro === 'credits') $('#credits-dialog').showModal();
    else leave(b.dataset.intro === 'queue' ? 'queue' : null);
  };
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !left && !$('#credits-dialog').open && !e.target.closest('button, input')) leave(); });
}

async function init() {
  if (document.documentElement.dataset.intro) setupIntro();
  showNick();
  $('#band').innerHTML = Object.entries(BANDS).map(([b, r]) => `<option value="${b}">${b} · ${r}</option>`).join('');
  const url = readURL();
  if (url.embed) document.body.classList.add('embed');
  try { targets = (await api.loadTargets()).targets; } catch { status('Exemplos ainda não gerados. Rode: python -m backend.pregen', 'err'); }
  missions.setPlaces({ targets });
  $('#targets').innerHTML = targets.map((t, i) => `<button data-id="${t.id}" title="${esc(t.kind)}"><i>${String(i + 1).padStart(2, '0')}</i>${esc(t.title)}</button>`).join('')
    + '<button data-moon="1" title="A Lua na posição e na fase de agora (só no céu 360°)"><i>☾</i>Lua, agora</button>';
  $('#targets').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.moon) {                         // a Lua: só voa até ela no panorama (a Terra some ao aproximar)
      if (!globe || sky.kind !== 'sphere') return;
      if (!earthOn()) document.querySelector('#sky-layers [data-layer=earth]').click();   // a Lua vem junto com a Terra
      const m = globe.moonSky();
      hidePop(); if (!$('#work').hidden) closeWork();
      sky.flyTo(m.ra, m.dec, 3, 1.4); return;
    }
    const t = targets.find((t) => t.id === b.dataset.id);
    $('#q').value = '';
    go({ ra: t.ra, dec: t.dec, fov: t.fov, band: t.band });
  };
  $('#search').onsubmit = (e) => { e.preventDefault(); hidePop(); search($('#q').value || (st.ra != null ? `${st.ra} ${st.dec}` : '')); };
  $('#fov').onchange = $('#band').onchange = () => { if (st.ra != null) go({ ra: st.ra, dec: st.dec, fov: +$('#fov').value, band: $('#band').value }, { view: viewer.s.view === 'rgb' ? 'anim' : viewer.s.view, frames: viewer.s.frameMode }); };
  $('#share').onclick = async () => { writeURL(); try { await navigator.clipboard.writeText(location.href); status('Link copiado.', 'ok'); } catch { status(location.href, 'ok'); } };
  $('#nick-btn').onclick = () => askNick(true);
  $('#details-btn').onclick = () => setDetails(!document.body.dataset.details);
  $('#credits-btn').onclick = () => $('#credits-dialog').showModal();
  document.querySelector('.itabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showPane(b.dataset.pane); };

  $('#play').onclick = () => { viewer.set({ playing: !viewer.s.playing }); syncControls(); writeURL(); };
  $('#prev').onclick = () => { viewer.step(-1); syncControls(); writeURL(); };
  $('#next').onclick = () => { viewer.step(1); syncControls(); writeURL(); };
  $('#slider').oninput = (e) => { viewer.set({ playing: false, idx: +e.target.value }); syncControls(); writeURL(); };
  $('#fps').onchange = (e) => viewer.set({ fps: +e.target.value });
  $('#timeline').onclick = (e) => {
    if (!viewer.cube) return;
    const r = e.currentTarget.getBoundingClientRect(), frac = ((e.clientX - r.left) / r.width * 100 - 1) / 97;
    const ex = viewer.exposures, mjd = ex[0].mjd + frac * (ex[ex.length - 1].mjd - ex[0].mjd);
    let best = 0; ex.forEach((f, i) => { if (Math.abs(f.mjd - mjd) < Math.abs(ex[best].mjd - mjd)) best = i; });
    viewer.set({ playing: false, view: 'anim', idx: viewer.s.frameMode === 'epochs' ? ex[best].ep : best });
    syncControls(); writeURL();
  };
  $('#view-mode').onclick = (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); };
  $('#frame-mode').onclick = (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    viewer.set({ frameMode: b.dataset.m, fps: b.dataset.m === 'exposures' ? Math.max(5, +$('#fps').value) : +$('#fps').value });
    buildFrameUI(); syncControls(); writeURL();
  };
  $('#sel-a').onchange = (e) => viewer.set({ a: +e.target.value });
  $('#sel-b').onchange = (e) => viewer.set({ b: +e.target.value });
  $('#stretch').oninput = (e) => viewer.set({ stretch: +e.target.value });
  $('#cmap').onchange = (e) => viewer.set({ cmap: e.target.value });
  $('#ck-mira').onchange = (e) => viewer.set({ mira: e.target.checked });
  $('#ck-smooth').onchange = (e) => viewer.set({ smooth: e.target.checked });
  $('#ck-flags').onchange = (e) => {
    if (e.target.checked && viewer.s.frameMode !== 'exposures') { viewer.set({ frameMode: 'exposures' }); buildFrameUI(); }
    viewer.set({ flagged: e.target.checked }); syncControls();
  };
  for (const cat of ['gaia', 'catwise']) $(`#ck-${cat}`).onchange = (e) => toggleCatalog(cat, e.target.checked);
  document.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  // panorama: camadas, zoom, gaveta
  $('#sky-layers').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const on = b.classList.toggle('on');
    if (b.dataset.layer === 'earth') {             // o globo lê o estado do botão a cada quadro
      if (sky.kind === 'sphere') { sky.impl.setFovMax(on ? FOV_EARTH : 230); if (!on) globe?.home(); }
      return;
    }
    for (const n of ['grid', 'ecl', 'gal']) sky.setLayer(n, on);
  };
  $('#z-in').onclick = () => globe?.pull(-2) || sky.zoomBy(2);
  $('#z-out').onclick = () => globe?.pull(2) || sky.zoomBy(0.5);
  // com a Terra: volta para a órbita, ao lado do satélite, na vista inicial
  $('#z-reset').onclick = () => { if (globe && sky.kind === 'sphere' && earthOn()) { globe.home(); sky.flyTo(HOME_VIEW.ra, HOME_VIEW.dec, FOV_EARTH, 0.9); } else sky.reset(); };
  $('#sky-pop-x').onclick = hidePop;
  $('#work-close').onclick = () => { closeWork(); writeURL(); };
  $('#work-open').onclick = openWork;
  $('#sky-survey').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#sky-survey button').forEach((x) => x.classList.toggle('on', x === b));
    const k = b.dataset.survey;
    $('#sky-lambda').hidden = k !== 'spherex';
    if (k !== 'spherex') return sky.setSurvey(k);
    // começa no meio da banda escolhida na gaveta (D1–D6), que é o que a pessoa está olhando
    const band = +st.band.slice(1) || 2;
    $('#lambda').value = String(17 * (band - 1) + 8);
    sky.setSurvey(k, +$('#lambda').value);
    showLambda();
  };
  $('#lambda').oninput = (e) => {
    let i = +e.target.value;
    if (i === 49 || i === 50) i = +e.target.dataset.last > i ? 48 : 51;   // canais do dicroico vêm em branco
    e.target.value = String(i); e.target.dataset.last = String(i);
    sky.setSlice(i); showLambda();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#nick-dialog').open && !$('#credits-dialog').open && $('#earth-full').hidden) { if (!$('#sky-pop').hidden) hidePop(); else closeWork(); return; }
    if (e.key === '/' && !e.target.matches('input, select, textarea') && !document.documentElement.dataset.intro) { e.preventDefault(); $('#q').focus(); return; }
    if (e.key === 'Enter' && !$('#work-open').hidden && !e.target.matches('input, select, textarea, button')) { openWork(); return; }
    if (e.target.matches('input, select, textarea') || $('#tab-explore').hidden || !viewer.cube || $('#work').hidden) return;
    if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    if (e.key === 'ArrowRight') $('#next').click();
    if (e.key === 'ArrowLeft') $('#prev').click();
  });
  window.addEventListener('popstate', () => start(readURL(), false));
  command.init({
    getContext: () => ({ target: $('#work').hidden ? null : st.target?.id || null, band: st.band, ra: st.ra, dec: st.dec }),
    // mede o objeto no centro do recorte (os alvos ficam centrados): é o mesmo clique da pessoa, feito por ela num botão
    measureCenter: () => { if (!viewer.cube || $('#work').hidden) return false; const c = (viewer.n - 1) / 2; analyze(c, c); return true; },
    setBand: (b) => { if (st.ra != null) go({ ra: st.ra, dec: st.dec, fov: st.fov, band: b }, { view: viewer.s.view === 'rgb' ? 'anim' : viewer.s.view, frames: viewer.s.frameMode }); },
    goTarget: (id, band) => { const t = targets.find((x) => x.id === id); if (t) go({ ra: t.ra, dec: t.dec, fov: t.fov, band: band || t.band }); },
    askNick: () => askNick(), showTab: (t) => showTab(t),
  });
  // ordens da Central desenhadas no próprio céu, nas posições reais dos alvos
  import('./skyorders.js').then(({ startSkyOrders }) => startSkyOrders({
    layer: $('#sky-orders'), sky,
    visible: () => sky.kind === 'sphere' && document.body.dataset.tab === 'explore' && $('#work').hidden
      && !document.documentElement.dataset.intro && $('#earth-full').hidden,
    occluded: (x, y) => !!globe?.hits(x, y),
    actions: command.orderActions,
  })).catch((e) => console.warn('ordens no céu indisponíveis:', e));
  if (!url.embed) initSky();
  api.loadCandidates('queue').then((c) => {
    $('#queue-count').textContent = c.candidates.length;
    const by = {};
    for (const k of c.candidates) { const r = (by[`${k.rra},${k.rdec}`] ||= { ra: k.rra, dec: k.rdec, fov: k.rfov, band: k.band, n: 0, name: k.region }); r.n++; }
    queueRegions = Object.values(by).map((r) => ({ ...r, label: `${r.name}: ${r.n} candidato${r.n > 1 ? 's' : ''} na fila` }));
    missions.setPlaces({ queue: queueRegions });
    refreshSky();
  }).catch(() => {});
  refreshSky();
  await start(url, false);
}

async function start(url, push) {
  document.body.dataset.tab = url.tab;
  if (url.tab !== 'explore') await showTab(url.tab, false);
  else if (!$('#tab-explore').offsetParent && $('#tab-explore').hidden) await showTab('explore', false);
  let req = null;
  if (url.ra != null) req = { ra: url.ra, dec: url.dec, fov: url.fov, band: url.band || 'D2' };
  else {
    const t = targets.find((t) => t.id === url.targetId);
    if (t) req = { ra: t.ra, dec: t.dec, fov: t.fov, band: t.band };
  }
  // sem região no endereço: abre no céu inteiro
  if (req && url.tab === 'explore') await go(req, { push, view: url.view, frames: url.frames, f: url.f });
  else if (url.tab === 'explore') { closeWork(); setSkyRight(0); }
}

init();
