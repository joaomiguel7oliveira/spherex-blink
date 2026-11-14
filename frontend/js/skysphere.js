// Panorama 360° do céu real, escuro, com o Aladin Lite (CDS) sobre levantamentos HiPS do IRSA.
// Arraste para olhar em volta, role para zoom. Mesma interface do SkyMap (mapa desenhado à mão),
// que continua como reserva quando o Aladin não carrega.
import { loadAladin, SURVEYS, BARE } from './aladin.js';
import { eclToEq, galToEq } from './skymap.js';

const D2R = Math.PI / 180;
const FOV_MIN = 0.05, FOV_MAX = 230, FOV_HOME = 200;
/** Campo máximo com a Terra ligada: perto dela, mais que isso deforma demais; a roda passa a afastar a câmera. */
export const FOV_EARTH = 70;
/** Vista inicial: Dragão, perto do polo norte do céu (R Draconis quase no centro); a Terra fica logo abaixo. */
export const HOME_VIEW = { ra: 250, dec: 72 };

/** Divide uma curva fechada em trechos curtos: o Aladin desenha cada trecho reto na tela. */
function chunks(points, size = 12) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += size) out.push(points.slice(i, Math.min(points.length, i + size + 1)));
  return out;
}
const circle = (fn) => Array.from({ length: 361 }, (_, i) => fn(i));

export class SkySphere {
  /** Cria o panorama dentro de `el`. Rejeita se o Aladin ou o WebGL2 não estiverem disponíveis. */
  static async create(el, handlers) {
    const A = await loadAladin();
    return new SkySphere(A, el, handlers);
  }

  constructor(A, el, { onGo, onPick, onHover } = {}) {
    this.A = A; this.el = el;
    this.onGo = onGo || (() => {}); this.onPick = onPick || (() => {}); this.onHover = onHover || (() => {});
    this.markers = []; this.survey = 'dss';
    el.innerHTML = '';
    this.al = A.aladin(el, { ...BARE, survey: SURVEYS.dss.url, projection: 'STG', fov: FOV_HOME, target: `${HOME_VIEW.ra} ${HOME_VIEW.dec}` });
    // botão direito: no Aladin, arrastar com ele muda o contraste da imagem do céu. Aqui ele não faz nada.
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu']) {
      el.addEventListener(t, (e) => { if (e.button === 2 || t === 'contextmenu') { e.stopPropagation(); e.preventDefault(); } }, { capture: true });
    }
    this.fovMax = FOV_MAX;
    this.al.setFoVRange(FOV_MIN, FOV_MAX);
    this.al.setCooGrid({ enabled: true, color: 'rgb(150,170,210)', opacity: 0.12, labelSize: 10, showLabels: true, thickness: 1 });

    // linhas de referência
    this.ecl = A.graphicOverlay({ name: 'eclíptica', color: '#e0b04f', lineWidth: 1.3, lineDash: [6, 5] });
    this.gal = A.graphicOverlay({ name: 'plano galáctico', color: 'rgba(150,180,255,0.55)', lineWidth: 1, lineDash: [2, 4] });
    this.box = A.graphicOverlay({ name: 'campo', color: '#ffffff', lineWidth: 1.6 });
    for (const o of [this.gal, this.ecl, this.box]) this.al.addOverlay(o);
    for (const c of chunks(circle((l) => eclToEq(l)))) this.ecl.add(A.polyline(c));
    for (const c of chunks(circle((l) => galToEq(l)))) this.gal.add(A.polyline(c));

    // marcadores: um catálogo por tipo, desenhados à mão
    const ring = (color, r, fill) => (s, ctx) => {
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.2832);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.lineWidth = 1.6; ctx.strokeStyle = color; ctx.stroke();
    };
    this.cats = {
      cached: A.catalog({ name: 'buscas', shape: ring('#8fb0ff', 3.5, 'rgba(10,14,30,.8)') }),
      queue: A.catalog({ name: 'candidatos', shape: ring('#f0a050', 7.5) }),
      example: A.catalog({ name: 'exemplos', shape: ring('#ffffff', 5, '#4d7cff'), displayLabel: true, labelColumn: 'label', labelColor: '#ffffff', labelFont: '600 12px system-ui, sans-serif' }),
      picked: A.catalog({ name: 'ponto', shape: (s, ctx) => { ctx.setLineDash([3, 3]); ring('#8fb0ff', 11)(s, ctx); ctx.setLineDash([]); } }),
      here: A.catalog({ name: 'aqui', shape: (s, ctx) => {
        ctx.beginPath(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(s.x + dx * 6, s.y + dy * 6); ctx.lineTo(s.x + dx * 16, s.y + dy * 16); }
        ctx.stroke();
      } }),
    };
    for (const c of Object.values(this.cats)) this.al.addCatalog(c);

    // eventos: clique em marcador abre a região; clique no vazio escolhe um ponto
    let hit = 0;
    // norte sempre para cima: arrastar perto do polo faz o Aladin girar a vista, e o céu (e a Terra
    // desenhada sobre ele) ficaria torto. (al.setRotation(0) é ignorado pelo Aladin; o da view funciona.)
    const north = () => { if (Math.abs(this.al.getRotation()) > 1e-3) this.al.view.setRotation(0); };
    const lock = () => { north(); requestAnimationFrame(lock); };   // a cada quadro: o arrasto do Aladin não avisa no fim
    lock();
    this.al.on('objectClicked', (o) => {
      const m = o?.data?.m;
      if (!m) return;
      hit = performance.now(); this.onGo(m);
    });
    this.al.on('click', (e) => {
      if (!e || e.isDragging) return;
      setTimeout(() => {
        if (performance.now() - hit < 300) return;
        const r = el.getBoundingClientRect();
        if (Number.isFinite(e.ra)) this.onPick({ ra: (e.ra + 360) % 360, dec: e.dec }, { x: r.left + e.x, y: r.top + e.y });
      }, 0);
    });
    this.al.on('objectHovered', (o) => { if (o?.data?.m) { this._hov = o.data.m; this.onHover({ marker: o.data.m }); el.style.cursor = 'pointer'; } });
    this.al.on('objectHoveredStop', () => { this._hov = null; el.style.cursor = ''; });
    this.al.on('mouseMove', (e) => { if (!this._hov && e && Number.isFinite(e.ra)) this.onHover({ ra: (e.ra + 360) % 360, dec: e.dec }); });
    el.addEventListener('mouseleave', () => this.onHover(null));
  }

  set({ markers }) {
    if (!markers) return;
    this.markers = markers;
    for (const k of ['cached', 'queue', 'example']) {
      this.cats[k].removeAll();
      this.cats[k].addSources(markers.filter((m) => m.kind === k).map((m) => this.A.source(m.ra, m.dec, { label: m.label, m })));
    }
  }

  setCurrent(ra, dec, fov) {
    this.cats.here.removeAll(); this.box.removeAll();
    if (ra == null) return;
    this.cats.here.addSources([this.A.source(ra, dec, {})]);
    if (fov) {
      const h = fov / 120, w = h / Math.max(0.05, Math.cos(dec * D2R));
      this.box.add(this.A.polygon([[ra - w, dec - h], [ra + w, dec - h], [ra + w, dec + h], [ra - w, dec + h]]));
    }
  }

  /** Largura (px) coberta pela gaveta à direita: o céu não encolhe, só o centro da vista se desloca. */
  setInset(o = {}) { this.inset = { right: 0, top: 0, bottom: 0, ...(this.inset || {}), ...o }; }

  setLayer(name, on) {
    if (name === 'grid') this.al.setCooGrid({ enabled: on });
    if (name === 'ecl') on ? this.ecl.show() : this.ecl.hide();
    if (name === 'gal') on ? this.gal.show() : this.gal.hide();
  }

  /** Troca a imagem de fundo. O SPHEREx é um cubo HiPS de 102 quadros, um por comprimento de onda. */
  setSurvey(key, slice) {
    const sv = SURVEYS[key];
    if (!sv) return;
    if (key !== this.survey) {
      this.survey = key;
      if (sv.cube) {
        this.cube = this.A.HiPS(sv.url, { colormap: 'magma', stretch: 'asinh', minCut: 22, maxCut: 255 });
        this.al.setBaseImageLayer(this.cube);
      } else { this.cube = null; this.al.setImageSurvey(sv.url); }
    }
    if (sv.cube && slice != null) this.setSlice(slice);
  }

  /** Troca o canal do cubo. A camada só aceita a troca depois de entrar no Aladin, então espera por isso. */
  setSlice(i) {
    this.slice = i;
    const L = this.cube;
    if (!L) return;
    clearTimeout(this._sliceTimer);
    const apply = (tries) => {
      if (this.cube !== L) return;
      if (L.added) L.setSliceNumber(this.slice);
      else if (tries) this._sliceTimer = setTimeout(() => apply(tries - 1), 200);
    };
    apply(50);
  }

  clearPick() { this.cats.picked.removeAll(); }
  showPick(p) { this.clearPick(); this.cats.picked.addSources([this.A.source(p.ra, p.dec, {})]); }

  fov() { return this.al.getFov()[0]; }
  zoomBy(f) { this.al.zoomToFoV(Math.min(this.fovMax, Math.max(FOV_MIN, this.fov() / f)), 0.4); }
  reset() { this.al.zoomToFoV(Math.min(FOV_HOME, this.fovMax), 0.9); }
  /** Muda o campo máximo; se a vista estiver mais aberta, fecha até ele. */
  setFovMax(f, dur = 0.5) {
    this.fovMax = f; this.al.setFoVRange(FOV_MIN, f);
    if (this.fov() > f) dur ? this.al.zoomToFoV(f, dur) : this.al.setFoV(f);
  }
  /** Gira até (ra, dec) e ajusta o campo, em uma animação só. */
  flyTo(ra, dec, fov = 20, dur = 1.1) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) dur = 0;
    // com controles por cima, o alvo vai para o meio do espaço livre: o centro da vista anda para oeste
    // (a ascensão reta cresce para a esquerda na tela) metade da faixa da direita, e para o norte ou
    // sul metade da diferença entre as faixas de cima e de baixo
    const { right = 0, top = 0, bottom = 0 } = this.inset || {};
    const W = this.el.clientWidth || innerWidth, degPx = fov / W;
    const off = (right / 2) * degPx, offY = ((bottom - top) / 2) * degPx;
    if (off) ra = (ra - off / Math.max(0.1, Math.cos(dec * D2R)) + 360) % 360;
    if (offY) dec = Math.max(-89.9, Math.min(89.9, dec - offY));
    if (!dur) { this.al.gotoRaDec(ra, dec); this.al.setFoV(fov); return; }
    this.al.animateToRaDec(ra, dec, dur);
    this.al.zoomToFoV(fov, dur);
  }
}
