// Gráfico de dispersão mínimo em SVG (sem dependências), com barras de erro e legenda.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

function ticks(lo, hi, count = 5) {
  const span = hi - lo || 1, step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const step = [1, 2, 5, 10].map((m) => m * step0).find((s) => span / s <= count) || step0 * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

// tons escuros o bastante para fundo branco
export const PALETTE = ['#7c9cff', '#f0a050', '#4fc38a', '#f06292', '#b39ddb', '#4dd0e1', '#e6c75a', '#ff7b7b', '#90a4ae', '#a5d66b'];

/**
 * points: [{x, y, err?, group?, tip?}]   groups: [{label, color}]
 * opts: {xlabel, ylabel, xfmt, title}
 */
export function scatter(container, points, groups, opts = {}) {
  container.innerHTML = '';
  if (!points.length) { container.innerHTML = '<p class="muted">Sem medidas válidas neste ponto.</p>'; return; }
  const W = 420, H = 230, m = { l: 52, r: 10, t: 10, b: 36 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  const px = (x1 - x0) * 0.04 || 1, py = (y1 - y0) * 0.08 || 1;
  x0 -= px; x1 += px; y1 += py; if (y0 < 0) y0 -= py;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img' });
  const xfmt = opts.xfmt || ((v) => String(v));
  for (const t of ticks(x0, x1, 5)) {
    svg.append(el('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: 'grid' }));
    svg.append(el('text', { x: X(t), y: H - m.b + 13, class: 'tick', 'text-anchor': 'middle' }, xfmt(t)));
  }
  for (const t of ticks(y0, y1, 4)) {
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'grid' }));
    svg.append(el('text', { x: m.l - 5, y: Y(t) + 3, class: 'tick', 'text-anchor': 'end' }, String(t)));
  }
  svg.append(el('text', { x: (m.l + W - m.r) / 2, y: H - 4, class: 'axis', 'text-anchor': 'middle' }, opts.xlabel || ''));
  svg.append(el('text', { x: 12, y: (m.t + H - m.b) / 2, class: 'axis', 'text-anchor': 'middle',
    transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})` }, opts.ylabel || ''));
  for (const p of points) {
    const color = groups[p.group || 0]?.color || PALETTE[0];
    if (p.err) svg.append(el('line', { x1: X(p.x), x2: X(p.x), y1: Y(p.y - p.err), y2: Y(p.y + p.err), stroke: color, 'stroke-opacity': 0.45 }));
    const c = el('circle', { cx: X(p.x), cy: Y(p.y), r: 2.8, fill: color });
    if (p.tip) c.append(el('title', {}, p.tip));
    svg.append(c);
  }
  container.append(svg);
  if (groups.length > 1) {
    const lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = groups.map((g) => `<span><i style="background:${g.color}"></i>${g.label}</span>`).join('');
    container.append(lg);
  }
}
