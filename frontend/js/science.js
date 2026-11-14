// Contas feitas no navegador: projeção do céu, épocas, empilhamento, fotometria e centroide.
const D2R = Math.PI / 180;
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Projeção gnomônica (TAN): céu -> deslocamento em segundos de arco (xi para leste, eta para norte). */
export function tanProject(ra, dec, ra0, dec0) {
  const a = (ra - ra0) * D2R, d = dec * D2R, d0 = dec0 * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  return {
    xi: (Math.cos(d) * Math.sin(a)) / cosc / D2R * 3600,
    eta: (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc / D2R * 3600,
  };
}

export function tanDeproject(xi, eta, ra0, dec0) {
  const x = xi / 3600 * D2R, y = eta / 3600 * D2R, d0 = dec0 * D2R;
  const rho = Math.hypot(x, y);
  if (rho === 0) return { ra: ra0, dec: dec0 };
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho);
  const ra = ra0 + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c)) / D2R;
  return { ra: (ra + 360) % 360, dec: dec / D2R };
}

export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000);
export const fmtMonth = (mjd) => { const d = mjdToDate(mjd); return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtDay = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);
export const fmtDateTime = (mjd) => mjdToDate(mjd).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Agrupa exposições em épocas: um intervalo maior que `gap` dias abre uma época nova.
 * Regiões revisitadas o tempo todo (perto dos polos da eclíptica) formam um bloco
 * contínuo muito longo; esses blocos são fatiados em partes iguais de ~`span` dias.
 */
export function computeEpochs(frames, gap = 45, span = 60) {
  const blocks = [];
  let cur = null;
  frames.forEach((f, i) => {
    if (!cur || f.mjd - frames[i - 1].mjd > gap) { cur = []; blocks.push(cur); }
    cur.push(i);
  });
  const epochs = [];
  for (const blk of blocks) {
    const t0 = frames[blk[0]].mjd, len = frames[blk[blk.length - 1]].mjd - t0;
    const parts = len > 1.5 * span ? Math.round(len / span) : 1;
    const groups = Array.from({ length: parts }, () => []);
    for (const i of blk) groups[Math.min(parts - 1, Math.floor(((frames[i].mjd - t0) / (len || 1)) * parts))].push(i);
    for (const members of groups) {
      if (!members.length) continue;
      const e = { idx: epochs.length, members, mjdMin: frames[members[0]].mjd, mjdMax: frames[members[members.length - 1]].mjd };
      for (const i of members) frames[i].ep = e.idx;
      epochs.push(e);
    }
  }
  for (const e of epochs) {
    e.mjd = (e.mjdMin + e.mjdMax) / 2;
    const a = fmtMonth(e.mjdMin), b = fmtMonth(e.mjdMax);
    e.label = a === b ? a : `${a.slice(0, 3)}–${b}`;
  }
  // rótulos repetidos (duas fatias no mesmo mês) ganham o dia
  const seen = {};
  for (const e of epochs) (seen[e.label] ||= []).push(e);
  for (const list of Object.values(seen)) if (list.length > 1) for (const e of list) e.label = `${fmtDay(e.mjdMin).slice(8)} ${e.label}`;
  return epochs;
}

/** Mediana pixel a pixel de um conjunto de quadros (ignora NaN). */
export function medianStack(cube, n2, members) {
  const out = new Float32Array(n2);
  const tmp = new Float32Array(members.length);
  for (let p = 0; p < n2; p++) {
    let k = 0;
    for (let m = 0; m < members.length; m++) {
      const v = cube[members[m] * n2 + p];
      if (v === v) tmp[k++] = v;
    }
    if (k === 0) { out[p] = NaN; continue; }
    const s = tmp.subarray(0, k).sort();
    out[p] = k % 2 ? s[(k - 1) / 2] : 0.5 * (s[k / 2 - 1] + s[k / 2]);
  }
  return out;
}

export function robustSigma(img) {
  const step = Math.max(1, Math.floor(img.length / 20000));
  const v = [];
  for (let i = 0; i < img.length; i += step) if (img[i] === img[i]) v.push(img[i]);
  if (v.length < 10) return { med: 0, sigma: 1e-3 };
  v.sort((a, b) => a - b);
  const med = v[v.length >> 1];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return { med, sigma: 1.4826 * dev[dev.length >> 1] || 1e-3 };
}

/**
 * Fotometria de abertura: soma dentro de rAp menos o fundo medido no anel [rIn, rOut].
 * Devolve a soma em unidades da imagem × pixel, o erro e a fração de pixels sem dado.
 */
export function aperture(img, n, x, y, rAp, rIn, rOut) {
  const x0 = Math.max(0, Math.floor(x - rOut)), x1 = Math.min(n - 1, Math.ceil(x + rOut));
  const y0 = Math.max(0, Math.floor(y - rOut)), y1 = Math.min(n - 1, Math.ceil(y + rOut));
  const ring = [];
  let sum = 0, nAp = 0, nNan = 0, nTot = 0;
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const r = Math.hypot(i - x, j - y), v = img[j * n + i];
      if (r <= rAp) { nTot++; if (v === v) { sum += v; nAp++; } else nNan++; }
      else if (r >= rIn && r <= rOut && v === v) ring.push(v);
    }
  }
  if (nTot === 0 || ring.length < 8) return null;
  ring.sort((a, b) => a - b);
  const bg = ring[ring.length >> 1];
  const dev = ring.map((v) => Math.abs(v - bg)).sort((a, b) => a - b);
  const sig = 1.4826 * dev[dev.length >> 1];
  return { sum: sum - bg * nAp, err: sig * Math.sqrt(nAp), nanFrac: nNan / nTot, bg };
}

/**
 * Fotometria "das asas": brilho médio em um anel afastado do centro. Serve para estrelas
 * saturadas, cujo miolo não tem dado. O anel recebe uma fração fixa da luz da estrela,
 * então o valor é proporcional ao brilho (medida relativa, não o fluxo total).
 */
export function ringPhot(img, n, x, y, r1, r2, b1, b2) {
  const x0 = Math.max(0, Math.floor(x - b2)), x1 = Math.min(n - 1, Math.ceil(x + b2));
  const y0 = Math.max(0, Math.floor(y - b2)), y1 = Math.min(n - 1, Math.ceil(y + b2));
  const bgv = [];
  let sum = 0, k = 0, tot = 0;
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const r = Math.hypot(i - x, j - y), v = img[j * n + i];
    if (r >= r1 && r <= r2) { tot++; if (v === v) { sum += v; k++; } }
    else if (r >= b1 && r <= b2 && v === v) bgv.push(v);
  }
  const expected = Math.PI * (r2 * r2 - r1 * r1);
  if (k < 0.6 * expected || bgv.length < 30 || k < 0.7 * tot) return null;
  bgv.sort((a, b) => a - b);
  const bg = bgv[bgv.length >> 1];
  const sig = 1.4826 * bgv.map((v) => Math.abs(v - bg)).sort((a, b) => a - b)[bgv.length >> 1];
  return { sum: (sum / k - bg) * expected, err: (sig / Math.sqrt(k)) * expected };
}

/** Centroide ponderado pelo fluxo em uma janela; itera para seguir o objeto. */
export function centroid(img, n, x, y, half = 4, iters = 3) {
  let cx = x, cy = y, snr = 0;
  for (let it = 0; it < iters; it++) {
    const xi = Math.round(cx), yi = Math.round(cy);
    if (xi - half - 2 < 0 || yi - half - 2 < 0 || xi + half + 2 >= n || yi + half + 2 >= n) return null;
    // miolo sem dado (saturação): o centroide ficaria torto, quem chama usa holeCentroid
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = img[(yi + j) * n + xi + i]; if (v !== v) return null; }
    const border = [];
    for (let j = -half - 2; j <= half + 2; j++) for (let i = -half - 2; i <= half + 2; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) > half) { const v = img[(yi + j) * n + xi + i]; if (v === v) border.push(v); }
    }
    if (border.length < 8) return null;
    border.sort((a, b) => a - b);
    const bg = border[border.length >> 1];
    const sig = 1.4826 * border.map((v) => Math.abs(v - bg)).sort((a, b) => a - b)[border.length >> 1] || 1e-6;
    let sw = 0, sx = 0, sy = 0, peak = 0;
    for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) {
      const v = img[(yi + j) * n + xi + i];
      if (v !== v) continue;
      const w = v - bg - 1.5 * sig;       // só o que está acima do ruído puxa o centroide
      if (w <= 0) continue;
      sw += w; sx += w * (xi + i); sy += w * (yi + j);
      if (v - bg > peak) peak = v - bg;
    }
    if (sw <= 0) return null;
    cx = sx / sw; cy = sy / sw; snr = peak / sig;
  }
  return { x: cx, y: cy, snr };
}

/**
 * Estrelas muito brilhantes saturam e viram uma mancha sem dado. Aqui a posição é o
 * centro geométrico dessa mancha (região conectada de NaN em volta do ponto).
 */
export function holeCentroid(img, n, x, y, maxArea = 4000) {
  let start = -1;
  const xi = Math.round(x), yi = Math.round(y);
  for (let r = 0; r <= 3 && start < 0; r++) for (let j = -r; j <= r && start < 0; j++) for (let i = -r; i <= r; i++) {
    const X = xi + i, Y = yi + j;
    if (X >= 0 && Y >= 0 && X < n && Y < n && img[Y * n + X] !== img[Y * n + X]) { start = Y * n + X; break; }
  }
  if (start < 0) return null;
  const seen = new Uint8Array(n * n), stack = [start];
  seen[start] = 1;
  let sx = 0, sy = 0, area = 0;
  while (stack.length) {
    const p = stack.pop(), px = p % n, py = (p - px) / n;
    sx += px; sy += py; area++;
    if (area > maxArea) return null;   // buraco grande demais: borda da imagem, não estrela
    if (px === 0 || py === 0 || px === n - 1 || py === n - 1) return null;
    for (const q of [p - 1, p + 1, p - n, p + n]) if (!seen[q] && img[q] !== img[q]) { seen[q] = 1; stack.push(q); }
  }
  return area >= 6 ? { x: sx / area, y: sy / area, area } : null;
}

export const fmtRA = (ra) => {
  const h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${s.toFixed(2).padStart(5, '0')}s`;
};
export const fmtDec = (dec) => {
  const a = Math.abs(dec), dd = Math.floor(a), m = (a - dd) * 60, mm = Math.floor(m), s = (m - mm) * 60;
  return `${dec < 0 ? '−' : '+'}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`;
};

/** Aceita "133.76 -7.24", "08h55m10.8s -07d14m42s", "08 55 10.8 -07 14 42", "08:55:10.8 -07:14:42". */
export function parseCoords(text) {
  const t = text.trim().replace(/[−–]/g, '-').replace(/,/g, ' ');
  const sex = /^(\d{1,2})[h:\s]\s*(\d{1,2})[m:′'\s]\s*(\d{1,2}(?:\.\d+)?)\s*s?\s+([+-]?\d{1,2})[d°:\s]\s*(\d{1,2})[m:′'\s]\s*(\d{1,2}(?:\.\d+)?)\s*[s″"]?$/i.exec(t);
  if (sex) {
    const ra = (+sex[1] + +sex[2] / 60 + +sex[3] / 3600) * 15;
    const sign = sex[4].trim().startsWith('-') ? -1 : 1;
    const dec = sign * (Math.abs(+sex[4]) + +sex[5] / 60 + +sex[6] / 3600);
    return ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
  }
  const deg = /^([+-]?\d+(?:\.\d+)?)\s*°?\s+([+-]?\d+(?:\.\d+)?)\s*°?$/.exec(t);
  if (deg) {
    const ra = +deg[1], dec = +deg[2];
    return ra >= 0 && ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
  }
  return null;
}
