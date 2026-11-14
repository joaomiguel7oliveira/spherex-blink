// Visualizador: recebe um cubo alinhado e desenha animação, blink, diferença, soma e RGB.
import { computeEpochs, medianStack, robustSigma, tanProject, fmtDateTime, fmtDay } from './science.js';

const STOPS = {
  cinza: [[0, 0, 0, 0], [1, 255, 255, 255]],
  negativo: [[0, 255, 255, 255], [1, 0, 0, 0]],
  calor: [[0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]],
};
function makeLut(name) {
  const stops = STOPS[name] || STOPS.cinza, lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c + 1] + f * (b[c + 1] - a[c + 1]));
  }
  return lut;
}
const asinhK = 8, asinhN = Math.asinh(asinhK);
// bits que indicam saturação por objeto brilhante: OVERFLOW, SUR_ERROR, NONLINEAR, BLOOM
const SAT = (1 << 1) | (1 << 2) | (1 << 15) | (1 << 26);

export class Viewer {
  constructor(canvas, { onFrame, onPick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.onFrame = onFrame || (() => {});
    this.onPick = onPick || (() => {});
    this.s = {
      view: 'anim', frameMode: 'epochs', idx: 0, a: 0, b: 0, stretch: 0.5, cmap: 'cinza', smooth: true,
      mira: true, flagged: false, fps: 2, playing: false, zoom: 1, cx: 0, cy: 0, blinkOn: false,
    };
    this.cats = {};       // nome -> lista de fontes
    this.markers = [];    // {ra, dec, label}
    this.sel = null;      // ponto escolhido {x, y}
    this.extra = [];      // círculos extras {x, y, color}
    this.rgb = null;
    this._bindMouse();
    new ResizeObserver(() => this.render()).observe(canvas);
  }

  setData(meta, cube, keepView = false) {
    this.meta = meta; this.cube = cube; this.flags = null; this.rgb = null; this.satStacks = this.satTotal = null;
    this.n = meta.size; this.n2 = this.n * this.n;
    this.exposures = meta.frames.map((f, i) => ({ ...f, i }));
    this.epochs = computeEpochs(this.exposures);
    this.stacks = this.epochs.map((e) => medianStack(cube, this.n2, e.members));
    this.total = medianStack(cube, this.n2, this.exposures.map((f) => f.i));
    this.sigma = meta.stats.sigma;
    // ruído de cada tipo de imagem: uma pilha de 20 exposições é bem mais limpa que uma exposição
    const sg = this.stacks.map((im) => robustSigma(im).sigma).sort((a, b) => a - b);
    this.sigmaStack = sg[sg.length >> 1]; this.sigmaTotal = robustSigma(this.total).sigma;
    this.buf.width = this.buf.height = this.n;
    this.img = this.ctx.createImageData(this.n, this.n);
    const s = this.s;
    if (!keepView) {
      s.zoom = 1; this.sel = null; this.extra = [];
      // brilho inicial: campos sem estrelas fortes começam mais "abertos" para mostrar objetos fracos
      s.stretch = Math.min(0.6, Math.max(0.15, Math.log((1.5 * meta.stats.p999) / (6 * this.sigma)) / Math.log(500))) || 0.4;
    }
    s.cx = s.cy = this.n / 2;
    if (this.epochs.length < 2 && s.frameMode === 'epochs') s.frameMode = 'exposures';
    const k = this.frameCount();
    s.idx = Math.min(s.idx, k - 1);
    this._defaultAB();
    this.render();
  }

  /** A = quadro mais recente, B = mais antigo, pulando épocas com pouquíssimas exposições. */
  _defaultAB() {
    const s = this.s, k = this.frameCount();
    s.a = k - 1; s.b = 0;
    if (s.frameMode !== 'epochs') return;
    const need = Math.max(4, 0.3 * Math.max(...this.epochs.map((e) => e.members.length)));
    const good = this.epochs.filter((e) => e.members.length >= need).map((e) => e.idx);
    if (good.length >= 2) { s.a = good[good.length - 1]; s.b = good[0]; }
  }

  /** Com as flags carregadas, descobre onde o "sem dado" é saturação (estrela brilhante demais). */
  setFlags(flags) {
    this.flags = flags;
    const n2 = this.n2, n = this.n;
    const mask = (members) => {
      const m = new Uint8Array(n2);
      for (let p = 0; p < n2; p++) {
        let k = 0;
        for (const i of members) if (flags[i * n2 + p] & SAT) k++;
        m[p] = k * 2 > members.length ? 1 : 0;
      }
      // dilata 2 pixels: a interpolação espalha o "sem dado" um pouco além do pixel sinalizado
      for (let pass = 0; pass < 2; pass++) {
        const src = m.slice();
        for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
          const p = j * n + i;
          if (!src[p] && (src[p - 1] || src[p + 1] || src[p - n] || src[p + n])) m[p] = 1;
        }
      }
      return m;
    };
    this.satStacks = this.epochs.map((e) => mask(e.members));
    this.satTotal = mask(this.exposures.map((f) => f.i));
    this.render();
  }
  _satMask() {
    const s = this.s;
    if (!this.flags || s.view === 'rgb') return null;
    if (s.view === 'sum' || s.view === 'diff') return this.satTotal;
    return s.frameMode === 'epochs' ? this.satStacks[this.current()] : null;
  }

  frameCount() { return this.s.frameMode === 'epochs' ? this.epochs.length : this.exposures.length; }
  frameImage(i) {
    return this.s.frameMode === 'epochs' ? this.stacks[i] : this.cube.subarray(i * this.n2, (i + 1) * this.n2);
  }
  frameInfo(i) {
    if (this.s.frameMode === 'epochs') {
      const e = this.epochs[i];
      return { kind: 'epoch', label: e.label, sub: `mediana de ${e.members.length} exposições`, epoch: e,
        short: e.label, mjd: e.mjd, range: `${fmtDay(e.mjdMin)} a ${fmtDay(e.mjdMax)}` };
    }
    const f = this.exposures[i];
    return { kind: 'exposure', label: fmtDateTime(f.mjd), sub: `${f.wl.toFixed(3).replace('.', ',')} µm`, frame: f,
      short: fmtDay(f.mjd), mjd: f.mjd };
  }
  /** Índice do quadro exibido agora (em blink alterna entre A e B). */
  current() {
    const s = this.s;
    if (s.view === 'blink') return s.blinkOn ? s.a : s.b;
    return s.idx;
  }

  set(patch) {
    const s = this.s, modeChanged = patch.frameMode && patch.frameMode !== s.frameMode;
    Object.assign(s, patch);
    if (!this.cube) { if (!s.playing) clearInterval(this.timer); return; }
    if (modeChanged) { s.idx = 0; this._defaultAB(); }
    const k = this.frameCount();
    s.idx = ((s.idx % k) + k) % k;
    s.a = Math.min(s.a, k - 1); s.b = Math.min(s.b, k - 1);
    if ('playing' in patch || 'fps' in patch || 'view' in patch || modeChanged) this._timer();
    this.render();
  }

  _timer() {
    clearInterval(this.timer);
    const s = this.s;
    if (!s.playing || !(s.view === 'anim' || s.view === 'blink')) return;
    this.timer = setInterval(() => {
      if (s.view === 'blink') s.blinkOn = !s.blinkOn; else s.idx = (s.idx + 1) % this.frameCount();
      this.render();
    }, 1000 / s.fps);
  }
  step(d) { this.set({ playing: false, idx: this.s.idx + d }); }

  // ---------------------------------------------------------------- coordenadas
  /** pixel do cubo (x para oeste, y para norte) -> pixel do canvas */
  toScreen(x, y) {
    const { zoom, cx, cy } = this.s, W = this.canvas.width, k = (zoom * W) / this.n;
    return [(x + 0.5 - (cx - this.n / (2 * zoom))) * k, (this.n - 1 - y + 0.5 - (cy - this.n / (2 * zoom))) * k];
  }
  toPixel(X, Y) {
    const { zoom, cx, cy } = this.s, W = this.canvas.width, k = (zoom * W) / this.n;
    return [X / k + cx - this.n / (2 * zoom) - 0.5, this.n - 1 - (Y / k + cy - this.n / (2 * zoom) - 0.5)];
  }
  skyToPixel(ra, dec) {
    const { xi, eta } = tanProject(ra, dec, this.meta.ra, this.meta.dec), c = (this.n - 1) / 2, sc = this.meta.pixscale;
    return [c - xi / sc, c + eta / sc];
  }
  pixelToOffset(x, y) { const c = (this.n - 1) / 2, sc = this.meta.pixscale; return { xi: -(x - c) * sc, eta: (y - c) * sc }; }

  // ---------------------------------------------------------------- desenho
  _limits() {
    // o controle de brilho vai de 6σ (realça objetos fracos) a ~3000σ (estrelas brilhantes)
    const s = this.s, sg = s.view === 'sum' ? this.sigmaTotal : s.frameMode === 'epochs' ? this.sigmaStack : this.sigma;
    return { lo: -1.5 * sg, hi: sg * 6 * Math.pow(500, s.stretch) };
  }

  _paint() {
    const s = this.s, n = this.n, px = this.img.data;
    if (s.view === 'rgb' && this.rgb) return this._paintRGB();
    let src, diff = false;
    if (s.view === 'diff') {
      const A = this.frameImage(s.a), B = this.frameImage(s.b);
      src = this._tmp || (this._tmp = new Float32Array(this.n2));
      if (src.length !== this.n2) src = this._tmp = new Float32Array(this.n2);
      for (let p = 0; p < this.n2; p++) src[p] = A[p] - B[p];
      diff = true;
    } else if (s.view === 'sum') src = this.total;
    else src = this.frameImage(this.current());

    const lut = makeLut(s.cmap);
    const { lo, hi } = this._limits();
    const dScale = diff ? robustSigma(src).sigma * 3 * Math.pow(20, s.stretch) : 0;
    const fl = s.flagged && this.flags && s.frameMode === 'exposures' && (s.view === 'anim' || s.view === 'blink')
      ? this.flags.subarray(this.current() * this.n2, (this.current() + 1) * this.n2) : null;
    const badMask = this.meta.bad_bits.reduce((m, b) => m | (1 << b), 0);
    const sat = this._satMask();
    const expFlags = !sat && this.flags && s.frameMode === 'exposures' && (s.view === 'anim' || s.view === 'blink')
      ? this.flags.subarray(this.current() * this.n2, (this.current() + 1) * this.n2) : null;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = j * n + i, o = ((n - 1 - j) * n + i) * 4, v = src[p];
        if (v !== v) {
          // sem dado: creme liso se for saturação (objeto brilhante demais), vinho escuro nos outros casos
          if ((sat && sat[p]) || (expFlags && ((expFlags[p] | expFlags[p - 1] | expFlags[p + 1] | expFlags[p - n] | expFlags[p + n] | expFlags[p - 2] | expFlags[p + 2] | expFlags[p - 2 * n] | expFlags[p + 2 * n]) & SAT))) { px[o] = 255; px[o + 1] = 238; px[o + 2] = 200; }
          else { px[o] = 46; px[o + 1] = 22; px[o + 2] = 40; }
          px[o + 3] = 255;
        }
        else if (diff) {
          // divergente: azul = ficou mais fraco / saiu daqui, laranja = ficou mais forte / chegou aqui
          const t = Math.max(-1, Math.min(1, v / dScale)), m = Math.abs(t);
          if (t >= 0) { px[o] = 20 + 235 * m; px[o + 1] = 22 + 150 * m; px[o + 2] = 30 + 10 * m; }
          else { px[o] = 20 + 20 * m; px[o + 1] = 22 + 140 * m; px[o + 2] = 30 + 225 * m; }
          px[o + 3] = 255;
        } else {
          let t = (v - lo) / (hi - lo);
          t = t <= 0 ? 0 : t >= 1 ? 1 : Math.asinh(t * asinhK) / asinhN;
          const q = (t * 255) | 0;
          px[o] = lut[q * 3]; px[o + 1] = lut[q * 3 + 1]; px[o + 2] = lut[q * 3 + 2]; px[o + 3] = 255;
        }
        if (fl && (fl[p] & badMask)) { px[o] = 230; px[o + 1] = 50; px[o + 2] = 70; }
      }
    }
  }

  _paintRGB() {
    const n = this.n, px = this.img.data, boost = 6 * Math.pow(500, this.s.stretch);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = j * n + i, o = ((n - 1 - j) * n + i) * 4;
      for (let c = 0; c < 3; c++) {
        const ch = this.rgb[c], v = ch.img[p];
        let t = v === v ? (v + 1.5 * ch.sigma) / (ch.sigma * boost) : 0;
        t = t <= 0 ? 0 : t >= 1 ? 1 : Math.asinh(t * asinhK) / asinhN;
        px[o + c] = (t * 255) | 0;
      }
      px[o + 3] = 255;
    }
  }

  render() {
    if (!this.cube) return;
    const cv = this.canvas, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const size = Math.round(cv.clientWidth * dpr);
    if (!size) return;
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    this._paint();
    this.buf.getContext('2d').putImageData(this.img, 0, 0);
    const s = this.s, n = this.n, vis = n / s.zoom;
    s.cx = Math.min(n - vis / 2, Math.max(vis / 2, s.cx));
    s.cy = Math.min(n - vis / 2, Math.max(vis / 2, s.cy));
    ctx.imageSmoothingEnabled = s.smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.buf, s.cx - vis / 2, s.cy - vis / 2, vis, vis, 0, 0, size, size);
    this._overlay(dpr, size);
    this.onFrame(this);
  }

  _ring(x, y, r, color, dpr, dash) {
    const ctx = this.ctx, [X, Y] = this.toScreen(x, y);
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = color;
    ctx.arc(X, Y, r * dpr, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    return [X, Y];
  }

  _overlay(dpr, size) {
    const ctx = this.ctx, s = this.s, n = this.n, c = (n - 1) / 2;
    ctx.font = `${12 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
    const pxPerArcsec = (s.zoom * size) / (n * this.meta.pixscale);
    // catálogos
    for (const [name, rows] of Object.entries(this.cats)) {
      const color = name === 'gaia' ? '#4dd0e1' : '#f06292';
      for (const r of rows) {
        const [x, y] = this.skyToPixel(r.ra, r.dec);
        if (x < 0 || y < 0 || x > n - 1 || y > n - 1) continue;
        const fast = r.pm > 150 && (r.pm_sig == null || r.pm_sig > 5);
        const [X, Y] = this._ring(x, y, fast ? 9 : 5, color, dpr, fast ? null : [3 * dpr, 2 * dpr]);
        if (fast) { ctx.fillStyle = color; ctx.fillText(`${(r.pm / 1000).toFixed(1)}″/ano`, X + 12 * dpr, Y); }
      }
    }
    // marcadores fixos (posição antiga de catálogo etc.)
    for (const m of this.markers) {
      const [x, y] = this.skyToPixel(m.ra, m.dec);
      if (x < 0 || y < 0 || x > n - 1 || y > n - 1) continue;
      const [X, Y] = this.toScreen(x, y), a = 6 * dpr;
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
      ctx.moveTo(X - a, Y - a); ctx.lineTo(X + a, Y + a); ctx.moveTo(X - a, Y + a); ctx.lineTo(X + a, Y - a); ctx.stroke();
      ctx.fillStyle = '#ffd54f'; ctx.fillText(m.label, X + 10 * dpr, Y);
    }
    if (s.mira) {  // mira fixa no centro: referência para perceber o deslocamento
      const [X, Y] = this.toScreen(c, c), r = Math.max(10 * dpr, 9 * pxPerArcsec), g = r * 0.45;
      ctx.strokeStyle = 'rgba(120,255,160,.85)'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(X + dx * g, Y + dy * g); ctx.lineTo(X + dx * (r + g), Y + dy * (r + g));
      }
      ctx.stroke();
    }
    for (const e of this.extra) this._ring(e.x, e.y, e.r || 11, e.color || '#ffd54f', dpr);
    if (this.sel) this._ring(this.sel.x, this.sel.y, Math.max(8, 12.3 * pxPerArcsec / dpr), '#ff9100', dpr);
    // barra de escala e bússola
    const fovArcsec = (n * this.meta.pixscale) / s.zoom;
    const bar = [600, 300, 120, 60, 30, 10].find((b) => b < fovArcsec / 3) || 5;
    const L = bar * pxPerArcsec, x0 = 14 * dpr, y0 = size - 16 * dpr;
    ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + L, y0); ctx.stroke();
    ctx.fillText(bar >= 60 ? `${bar / 60}′` : `${bar}″`, x0 + L + 6 * dpr, y0);
    const bx = size - 22 * dpr, by = size - 18 * dpr, bl = 26 * dpr;
    ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx, by - bl); ctx.moveTo(bx, by); ctx.lineTo(bx - bl, by); ctx.stroke();
    ctx.fillText('N', bx - 4 * dpr, by - bl - 8 * dpr); ctx.fillText('L', bx - bl - 12 * dpr, by);
    // rótulo do quadro, gravado na imagem (útil em capturas de tela)
    let label;
    if (s.view === 'diff') label = `${this.frameInfo(s.a).short}  −  ${this.frameInfo(s.b).short}`;
    else if (s.view === 'sum') label = `soma de ${this.exposures.length} exposições`;
    else if (s.view === 'rgb') label = 'cor falsa';
    else { const f = this.frameInfo(this.current()); label = `${f.label} · ${f.sub}`; }
    ctx.font = `600 ${13 * dpr}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(8,10,20,.72)'; ctx.fillRect(8 * dpr, 8 * dpr, tw + 14 * dpr, 24 * dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(label, 15 * dpr, 20.5 * dpr);
  }

  // ---------------------------------------------------------------- mouse
  _bindMouse() {
    const cv = this.canvas;
    let drag = null;
    // offsetX/Y vêm no sistema do próprio canvas, já descontando rotação e escala aplicadas por CSS
    const pos = (e) => [e.offsetX * (cv.width / cv.clientWidth), e.offsetY * (cv.height / cv.clientHeight)];
    cv.addEventListener('wheel', (e) => {
      if (!this.cube) return;
      e.preventDefault();
      if (this.onWheel?.(e)) return;            // quem embute a imagem pode tratar a roda (ex.: zoom do céu)
      const [X, Y] = pos(e), s = this.s, before = this.toPixel(X, Y);
      s.zoom = Math.min(12, Math.max(1, s.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const after = this.toPixel(X, Y);
      s.cx += before[0] - after[0]; s.cy -= before[1] - after[1];
      this.render();
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => { drag = { p: pos(e), cx: this.s.cx, cy: this.s.cy, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !this.cube) return;
      const [X, Y] = pos(e), k = (this.s.zoom * cv.width) / this.n, dx = X - drag.p[0], dy = Y - drag.p[1];
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved && this.s.zoom > 1) { this.s.cx = drag.cx - dx / k; this.s.cy = drag.cy - dy / k; this.render(); }
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved && this.cube) {
        const [x, y] = this.toPixel(...pos(e));
        if (x >= 0 && y >= 0 && x <= this.n - 1 && y <= this.n - 1) this.onPick(x, y);
      }
      drag = null;
    });
    cv.addEventListener('dblclick', () => { this.s.zoom = 1; this.render(); });
  }
}
