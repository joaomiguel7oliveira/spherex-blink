// Panorama do céu inteiro em tela cheia (projeção de Hammer, coordenadas equatoriais).
// Zoom com a roda, arraste para mover, clique para escolher um ponto. Serve para se situar:
// onde ficam os exemplos, as regiões já baixadas, os candidatos e o campo que você está vendo.
import { fmtRA, fmtDec } from './science.js';

const D2R = Math.PI / 180, S2 = Math.SQRT2;
const EPS = 23.4393 * D2R;                                     // obliquidade da eclíptica
const GAL = { ra: 192.85948, dec: 27.12825, l: 122.93192 };    // polo norte galáctico (J2000)
const ZMIN = 1, ZMAX = 80;

/** Hammer centrada em AR = 180°, com a ascensão reta crescendo para a esquerda (como no céu). */
function hammer(ra, dec) {
  const lam = (ra - 180) * D2R, phi = dec * D2R;
  const d = Math.sqrt(1 + Math.cos(phi) * Math.cos(lam / 2));
  return [-(2 * S2 * Math.cos(phi) * Math.sin(lam / 2)) / d, (S2 * Math.sin(phi)) / d];
}
function hammerInv(x, y) {
  const q = 1 - (x / 4) ** 2 - (y / 2) ** 2;
  if (q < 0.5) return null;                                    // fora da elipse
  const z = Math.sqrt(q);
  const lam = 2 * Math.atan2(z * -x, 2 * (2 * z * z - 1)), phi = Math.asin(Math.max(-1, Math.min(1, z * y)));
  return { ra: (lam / D2R + 180 + 360) % 360, dec: phi / D2R };
}
export const eclToEq = (lon, lat = 0) => {
  const l = lon * D2R, b = lat * D2R;
  const dec = Math.asin(Math.sin(b) * Math.cos(EPS) + Math.cos(b) * Math.sin(EPS) * Math.sin(l));
  const ra = Math.atan2(Math.sin(l) * Math.cos(EPS) - Math.tan(b) * Math.sin(EPS), Math.cos(l));
  return [(ra / D2R + 360) % 360, dec / D2R];
};
export const galToEq = (lon, lat = 0) => {
  const t = (GAL.l - lon) * D2R, dg = GAL.dec * D2R, b = lat * D2R;
  const dec = Math.asin(Math.sin(dg) * Math.sin(b) + Math.cos(dg) * Math.cos(b) * Math.cos(t));
  const ra = GAL.ra + Math.atan2(Math.cos(b) * Math.sin(t), Math.cos(dg) * Math.sin(b) - Math.sin(dg) * Math.cos(b) * Math.cos(t)) / D2R;
  return [(ra + 720) % 360, dec / D2R];
};
/** Equatorial → galáctica (l, b), para a leitura de posição. */
export function eqToGal(ra, dec) {
  const a = ra * D2R, d = dec * D2R, ag = GAL.ra * D2R, dg = GAL.dec * D2R;
  const b = Math.asin(Math.sin(d) * Math.sin(dg) + Math.cos(d) * Math.cos(dg) * Math.cos(a - ag));
  const l = GAL.l - Math.atan2(Math.cos(d) * Math.sin(a - ag), Math.sin(d) * Math.cos(dg) - Math.cos(d) * Math.sin(dg) * Math.cos(a - ag)) / D2R;
  return { l: (l + 720) % 360, b: b / D2R };
}
const seq = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

export class SkyMap {
  constructor(canvas, { onGo, onPick, onHover, onView } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.onGo = onGo || (() => {}); this.onPick = onPick || (() => {}); this.onHover = onHover || (() => {}); this.onView = onView || (() => {});
    this.stars = []; this.markers = []; this.current = null; this.hover = null; this.picked = null;
    this.v = { x: 0, y: 0, z: 1 };            // centro da vista em unidades de Hammer e zoom
    this.inset = { left: 0, right: 0 };       // faixas da tela cobertas por painéis
    this.layers = { grid: true, ecl: true, gal: true, stars: true };
    this._raf = 0; this._anim = null;
    new ResizeObserver(() => this.draw()).observe(canvas);

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: this.v.x, vy: this.v.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const [X, Y] = this._pos(e);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          const s = this._scale() / (window.devicePixelRatio || 1);
          this._stop(); this.v.x = drag.vx - dx / s; this.v.y = drag.vy + dy / s; this._clamp();
          canvas.style.cursor = 'grabbing'; this.request(); this.onView(this.v);
          return;
        }
      }
      const m = this._near(X, Y);
      this.hover = m;
      canvas.style.cursor = m ? 'pointer' : 'crosshair';
      this.onHover(m ? { marker: m } : this.toSky(X, Y));
      this.request();
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = drag; drag = null;
      if (!d || d.moved) { canvas.style.cursor = 'crosshair'; return; }
      const [X, Y] = this._pos(e), m = this._near(X, Y);
      if (m) return this.onGo(m);
      const sky = this.toSky(X, Y);
      this.picked = sky; this.request();
      this.onPick(sky, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointerleave', () => { if (!drag) { this.hover = null; this.onHover(null); this.request(); } });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [X, Y] = this._pos(e);
      this.zoomAt(X, Y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => { const [X, Y] = this._pos(e); this.zoomAt(X, Y, 2.5, true); });
  }

  /** markers: [{ra, dec, label, kind: 'example' | 'cached' | 'queue', ...}] */
  set({ stars, markers }) { if (stars) this.stars = stars; if (markers) this.markers = markers; this.request(); }
  setCurrent(ra, dec, fov) { this.current = ra == null ? null : { ra, dec, fov }; this.request(); }
  setInset(inset) { Object.assign(this.inset, inset); this.request(); }
  setLayer(name, on) { this.layers[name] = on; this.request(); }
  clearPick() { this.picked = null; this.request(); }

  // ---------------------------------------------------------------- geometria
  _dpr() { return window.devicePixelRatio || 1; }
  _pos(e) { const r = this.cv.getBoundingClientRect(), k = this.cv.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; }
  _base() {
    const W = this.cv.width, H = this.cv.height, d = this._dpr();
    const l = this.inset.left * d, r = this.inset.right * d, top = 64 * d, bot = 40 * d;
    // a escala vem da tela inteira (não muda quando a gaveta abre); só o centro se desloca
    const w = Math.max(80, W - l - r), h = Math.max(80, H - top - bot);
    return { cx: l + w / 2, cy: top + h / 2, k: Math.min((W - 80 * d) / (4 * S2), (h - 20 * d) / (2 * S2)) };
  }
  _scale() { return this._base().k * this.v.z; }
  toScreen(ra, dec) { const g = this._base(), s = g.k * this.v.z, [x, y] = hammer(ra, dec); return [g.cx + (x - this.v.x) * s, g.cy - (y - this.v.y) * s]; }
  _toProj(X, Y) { const g = this._base(), s = g.k * this.v.z; return [(X - g.cx) / s + this.v.x, (g.cy - Y) / s + this.v.y]; }
  toSky(X, Y) { const [x, y] = this._toProj(X, Y); return hammerInv(x, y); }
  _clamp() {
    this.v.z = Math.min(ZMAX, Math.max(ZMIN, this.v.z));
    const lx = 2 * S2 * (1 - 1 / this.v.z), ly = S2 * (1 - 1 / this.v.z);
    this.v.x = Math.max(-lx - 0.3, Math.min(lx + 0.3, this.v.x));
    this.v.y = Math.max(-ly - 0.2, Math.min(ly + 0.2, this.v.y));
    if (this.v.z <= 1.001) { this.v.x = 0; this.v.y = 0; }
  }
  zoomAt(X, Y, f, animate = false) {
    const [px, py] = this._toProj(X, Y);
    const z = Math.min(ZMAX, Math.max(ZMIN, this.v.z * f)), r = this.v.z / z;
    const target = { x: px - (px - this.v.x) * r, y: py - (py - this.v.y) * r, z };
    if (animate) this._animate(target); else { this._stop(); Object.assign(this.v, target); this._clamp(); this.request(); this.onView(this.v); }
  }
  zoomBy(f) { const g = this._base(); this.zoomAt(g.cx, g.cy, f, true); }
  reset() { this._animate({ x: 0, y: 0, z: 1 }); }
  /** Voa até (ra, dec) com o zoom pedido, deixando o ponto no centro da área livre. */
  flyTo(ra, dec, z = 6) { const [x, y] = hammer(ra, dec); this._animate({ x, y, z }); }

  _stop() { if (this._anim) cancelAnimationFrame(this._anim.id); this._anim = null; }
  _animate(to) {
    this._stop();
    const from = { ...this.v }, t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    const lz0 = Math.log(from.z), lz1 = Math.log(to.z);
    const step = (t) => {
      const u = dur ? Math.min(1, (t - t0) / dur) : 1, e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      this.v.z = Math.exp(lz0 + (lz1 - lz0) * e); this.v.x = from.x + (to.x - from.x) * e; this.v.y = from.y + (to.y - from.y) * e;
      this._clamp(); this.draw(); this.onView(this.v);
      if (u < 1) this._anim.id = requestAnimationFrame(step); else this._anim = null;
    };
    this._anim = { id: requestAnimationFrame(step) };
  }

  _near(X, Y) {
    const lim = 10 * this._dpr();
    let best = null, bd = lim;
    for (const m of this.markers) { const [x, y] = this.toScreen(m.ra, m.dec), d = Math.hypot(x - X, y - Y); if (d < bd) { bd = d; best = m; } }
    return best;
  }

  _line(points, style, dash) {
    const ctx = this.ctx, d = this._dpr();
    ctx.beginPath(); ctx.strokeStyle = style; ctx.setLineDash(dash ? dash.map((v) => v * d) : []);
    let prev = null;
    for (const [ra, dec] of points) {
      const h = hammer(ra, dec), p = this.toScreen(ra, dec);
      if (!prev || Math.abs(h[0] - prev[0]) > 1.5) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);   // quebra na borda do mapa
      prev = h;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  request() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }

  draw() {
    const cv = this.cv, ctx = this.ctx, dpr = this._dpr();
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const css = getComputedStyle(this.cv), col = (n, d) => css.getPropertyValue(n).trim() || d;
    const ink = col('--text', '#111'), line = col('--sky-grid', '#e6e8ee'), muted = col('--muted', '#888'), accent = col('--accent', '#2d5bff');
    const z = this.v.z, g = this._base(), s = g.k * z;
    const n = Math.min(1440, Math.round(240 * Math.sqrt(z)));         // mais pontos nas curvas com zoom
    ctx.clearRect(0, 0, W, H);

    // elipse do céu, recortando tudo o que vem depois
    const [ex, ey] = [g.cx - this.v.x * s, g.cy + this.v.y * s];
    ctx.save();
    ctx.beginPath(); ctx.ellipse(ex, ey, 2 * S2 * s, S2 * s, 0, 0, 6.2832);
    ctx.fillStyle = col('--sky', '#fff'); ctx.shadowColor = 'rgba(20,23,31,.08)'; ctx.shadowBlur = 40 * dpr; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = dpr; ctx.strokeStyle = col('--line', '#ddd'); ctx.stroke();
    ctx.clip();

    // Via Láctea: faixa suave de ±10° em torno do plano galáctico
    if (this.layers.gal) {
      for (const [w, a] of [[22, 0.035], [11, 0.045], [4, 0.05]]) {
        ctx.lineWidth = w * D2R * s * 1.15; ctx.lineCap = 'round';
        this._line(seq(0, 360, n).map((l) => galToEq(l)), `rgba(110,125,165,${a})`);
      }
    }
    // grade: passo adaptado ao zoom
    if (this.layers.grid) {
      const raStep = z < 3 ? 30 : z < 8 ? 15 : z < 25 ? 5 : 1, decStep = z < 3 ? 30 : z < 8 ? 15 : z < 25 ? 5 : 1;
      ctx.lineWidth = 0.8 * dpr;
      for (let ra = 0; ra < 360; ra += raStep) this._line(seq(-90, 90, n / 2).map((d) => [ra === 0 ? 0.001 : ra, d]), line);
      for (let dec = -90 + decStep; dec < 90; dec += decStep) this._line(seq(0.001, 359.999, n).map((r) => [r, dec]), line);
      ctx.lineWidth = 1.1 * dpr; this._line(seq(0.001, 359.999, n).map((r) => [r, 0]), col('--sky-eq', '#d5d9e2'));
    }
    if (this.layers.ecl) { ctx.lineWidth = dpr; this._line(seq(0, 360, n).map((l) => eclToEq(l)), '#c2962b', [5, 4]); }

    // estrelas: tamanho pelo brilho, crescendo devagar com o zoom
    if (this.layers.stars) {
      const grow = 1 + Math.log2(z) * 0.22;
      ctx.fillStyle = ink;
      for (const [ra, dec, v] of this.stars) {
        const [x, y] = this.toScreen(ra, dec);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        const r = Math.max(0.5, (6.2 - v) * 0.36) * dpr * grow;
        ctx.globalAlpha = Math.min(0.9, 0.28 + (6 - v) * 0.13);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // rótulos da grade, discretos
    ctx.font = `${10 * dpr}px ui-monospace, "SF Mono", Consolas, monospace`; ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const hStep = z < 3 ? 2 : z < 8 ? 1 : null;
    if (hStep) for (let h = 0; h < 24; h += hStep) { const [x, y] = this.toScreen(h * 15 || 0.01, 0); if (x > 0 && x < W) ctx.fillText(`${h}h`, x, y + 9 * dpr); }
    if (z < 8) for (const d of [-60, -30, 30, 60]) { const [x, y] = this.toScreen(this.v.z > 1.5 ? (hammerInv(this.v.x, 0)?.ra ?? 180) : 180, d); ctx.fillText(`${d > 0 ? '+' : '−'}${Math.abs(d)}°`, x, y - 7 * dpr); }
    if (this.layers.ecl && z < 4) { const [x, y] = this.toScreen(...eclToEq(250)); ctx.fillStyle = '#b3862a'; ctx.fillText('eclíptica', x, y - 10 * dpr); }
    if (this.layers.gal && z < 4) { const [x, y] = this.toScreen(...galToEq(60)); ctx.fillStyle = '#7d89a8'; ctx.fillText('Via Láctea', x, y - 16 * dpr); }

    // marcadores
    const order = { cached: 0, queue: 1, example: 2 };
    ctx.lineWidth = 1.5 * dpr;
    for (const m of [...this.markers].sort((a, b) => order[a.kind] - order[b.kind])) {
      const [x, y] = this.toScreen(m.ra, m.dec), hot = m === this.hover;
      if (m.kind === 'example') {
        ctx.fillStyle = accent; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, (hot ? 6 : 4.5) * dpr, 0, 6.2832); ctx.fill(); ctx.stroke();
        if (z >= 2.5 || hot) { ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.fillText(m.label, x + 9 * dpr, y); }
      } else if (m.kind === 'queue') { ctx.strokeStyle = '#d9822b'; ctx.beginPath(); ctx.arc(x, y, (hot ? 9 : 7.5) * dpr, 0, 6.2832); ctx.stroke(); }
      else { ctx.strokeStyle = accent; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, (hot ? 4.5 : 3.2) * dpr, 0, 6.2832); ctx.fill(); ctx.stroke(); }
    }
    // ponto escolhido no clique
    if (this.picked) {
      const [x, y] = this.toScreen(this.picked.ra, this.picked.dec);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.arc(x, y, 10 * dpr, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    }
    // posição atual: mira e, com zoom suficiente, o quadrado do campo
    if (this.current) {
      const c = this.current, [x, y] = this.toScreen(c.ra, c.dec);
      const half = c.fov ? (c.fov / 120) : 0;
      const [x2] = this.toScreen((c.ra - half / Math.max(0.05, Math.cos(c.dec * D2R)) + 360) % 360, c.dec), [, y2] = this.toScreen(c.ra, Math.min(89.9, c.dec + half));
      const box = Math.max(Math.abs(x2 - x), Math.abs(y2 - y));
      ctx.strokeStyle = ink; ctx.lineWidth = 1.6 * dpr; ctx.beginPath();
      if (box > 5 * dpr) ctx.rect(x - box, y - box, 2 * box, 2 * box);
      const a = 13 * dpr + box, b = 5 * dpr + box;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * b, y + dy * b); ctx.lineTo(x + dx * a, y + dy * a); }
      ctx.stroke();
    }
    if (this.hover) {
      const [x, y] = this.toScreen(this.hover.ra, this.hover.dec), t = this.hover.label;
      ctx.font = `600 ${11.5 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
      const w = ctx.measureText(t).width + 14 * dpr, left = Math.min(W - w - 2, Math.max(2, x - w / 2)), top = y > 34 * dpr ? y - 32 * dpr : y + 14 * dpr;
      ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(left, top, w, 21 * dpr, 6 * dpr); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(t, left + 7 * dpr, top + 11 * dpr);
    }
  }
}

export const skyLabel = (p) => `${fmtRA(p.ra)} ${fmtDec(p.dec)}`;
