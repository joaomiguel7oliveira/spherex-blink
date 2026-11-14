// Ordens da Central dentro do próprio céu: cada ordem com lugar fixo aparece como um marcador na
// posição real do alvo, e a ordem ativa ganha uma mira dourada. Quando o alvo da ordem ativa está fora
// da vista, uma seta na borda da tela aponta o caminho e diz a distância em graus no céu.
// Clicar num marcador abre o cartão da ordem ali mesmo, ao lado do alvo.
import * as G from './missions.js';

const D2R = Math.PI / 180;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Separação (graus) e ângulo de posição (graus, do norte para o leste) de (ra1,dec1) até (ra2,dec2). */
function sepPA(ra1, dec1, ra2, dec2) {
  const a1 = ra1 * D2R, d1 = dec1 * D2R, a2 = ra2 * D2R, d2 = dec2 * D2R, da = a2 - a1;
  const sep = Math.acos(Math.max(-1, Math.min(1, Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(da)))) / D2R;
  const pa = Math.atan2(Math.sin(da) * Math.cos(d2), Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da));
  return { sep, pa };
}

/**
 * layer: elemento por cima do céu. sky: fachada do panorama (toScreen, flyTo, impl.al).
 * visible(): se o céu está à vista. occluded(x, y): se o ponto está atrás da Terra.
 * actions: { code(m), accept(id), go(m), report(), central() }
 */
export function startSkyOrders({ layer, sky, visible, occluded, actions }) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let groups = [];          // [{key, place, missions: [...]}]
  let card = null;          // {key} do cartão aberto
  const arrow = document.createElement('button');
  arrow.className = 'so-arrow'; arrow.hidden = true; arrow.type = 'button';
  layer.append(arrow);
  const cardEl = document.createElement('div');
  cardEl.className = 'so-card'; cardEl.hidden = true; cardEl.setAttribute('role', 'dialog'); cardEl.setAttribute('aria-label', 'Ordem da Central');
  layer.append(cardEl);

  function statusOf(ms, active) {
    if (ms.some((m) => m.id === active)) return 'active';
    if (ms.some((m) => m.status !== 'done' && !m.locked)) return 'open';
    if (ms.every((m) => m.status === 'done')) return 'done';
    return 'locked';
  }

  /** Refaz os marcadores quando o estado do jogador muda. */
  function rebuild() {
    const s = G.get();
    layer.querySelectorAll('.so-mark').forEach((e) => e.remove());
    groups = [];
    if (!s) return;
    const by = new Map();
    for (const m of s.missions) {
      const p = G.placeOf(m); if (!p) continue;
      const key = `${p.ra.toFixed(3)},${p.dec.toFixed(3)}`;
      if (!by.has(key)) by.set(key, { key, place: p, missions: [] });
      by.get(key).missions.push(m);
    }
    groups = [...by.values()];
    for (const g of groups) {
      const st = statusOf(g.missions, s.active);
      const ms = g.missions, open = ms.filter((m) => m.status !== 'done' && !m.locked);
      const shown = ms.find((m) => m.id === s.active) || open[0] || ms[0];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `so-mark ${st}`;
      el.dataset.key = g.key;
      el.setAttribute('aria-label', `Ordem ${actions.code(shown)}: ${shown.title}${st === 'done' ? ' (cumprida)' : st === 'locked' ? ' (sem autorização)' : ''}`);
      el.innerHTML = `${st === 'active' ? '<span class="so-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}
        <span class="so-tag"><b class="mono">${st === 'done' ? '✓' : st === 'locked' ? '🔒' : '◆'} ${actions.code(shown)}</b><span class="so-title">${esc(shown.title)}${ms.length > 1 ? ` <small>+${ms.length - 1}</small>` : ''}</span>
        ${st === 'open' || st === 'active' ? `<small class="so-xp">+${shown.reward.xp} XP</small>` : ''}</span>`;
      el.onclick = (e) => { e.stopPropagation(); openCard(g.key); };
      layer.append(el);
    }
    if (card) renderCard();
  }

  function openCard(key) { card = { key }; renderCard(); cardEl.hidden = false; cardEl.querySelector('button')?.focus({ preventScroll: true }); }
  function closeCard() { card = null; cardEl.hidden = true; }
  function renderCard() {
    const g = groups.find((x) => x.key === card?.key), s = G.get();
    if (!g || !s) return closeCard();
    cardEl.innerHTML = `<p class="label">${esc(g.place.label)}</p>` + g.missions.map((m) => {
      const active = m.id === s.active, done = m.status === 'done';
      const btn = done ? '<span class="tag ok">cumprida</span>'
        : m.locked ? `<span class="muted small">🔒 ${esc(m.locked)}</span>`
        : active ? `<button class="primary" data-so="go" data-id="${m.id}">${g.place.queue ? 'Abrir a Fila' : 'Continuar'}</button>`
        : `<button class="primary" data-so="accept" data-id="${m.id}">Iniciar</button>`;
      return `<div class="so-order ${active ? 'active' : ''}"><div><span class="tag mono">${actions.code(m)}</span> <b>${esc(m.title)}</b></div>
        <p class="small muted">${esc(m.brief)}</p><p class="mono small so-rew">${m.band ? `${m.band} · ` : ''}+${m.reward.xp} XP</p>
        <div class="row">${btn}</div></div>`;
    }).join('') + '<button class="ghost so-x" data-so="close" aria-label="Fechar">✕</button>';
  }
  cardEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-so]'); if (!b) return;
    const m = G.get().missions.find((x) => x.id === b.dataset.id);
    if (b.dataset.so === 'close') return closeCard();
    if (b.dataset.so === 'accept') { closeCard(); await actions.accept(b.dataset.id); }
    if (b.dataset.so === 'go') { closeCard(); actions.go(m); }
    if (b.dataset.so === 'report') { closeCard(); actions.report(); }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) { e.stopPropagation(); closeCard(); } }, true);
  document.addEventListener('pointerdown', (e) => { if (card && !cardEl.contains(e.target) && !e.target.closest('.so-mark')) closeCard(); });
  arrow.onclick = () => {
    const p = G.placeOf(G.activeMission()); if (!p) return;
    sky.flyTo(p.ra, p.dec, Math.min(sky.fov() || 60, 60), still ? 0 : 1.2);
  };

  // ---------------------------------------------------------------- quadro a quadro: só posições
  function frame() {
    requestAnimationFrame(frame);
    const on = visible();
    layer.hidden = !on;
    if (!on) return;
    const W = innerWidth, H = innerHeight, M = 24;
    for (const g of groups) {
      const el = layer.querySelector(`.so-mark[data-key="${g.key}"]`); if (!el) continue;
      const p = sky.toScreen(g.place.ra, g.place.dec);
      const inside = p && p[0] > -M && p[0] < W + M && p[1] > -M && p[1] < H + M && !occluded(p[0], p[1]);
      el.hidden = !inside;
      if (inside) el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
      if (card?.key === g.key) {
        cardEl.hidden = !inside;
        if (inside) {
          const w = cardEl.offsetWidth || 300, h = cardEl.offsetHeight || 200;
          cardEl.style.left = `${Math.max(12, Math.min(W - w - 12, p[0] + 22))}px`;
          cardEl.style.top = `${Math.max(70, Math.min(H - h - 12, p[1] - 30))}px`;
        }
      }
    }
    // seta para o alvo da ordem ativa quando ele está fora da vista
    const am = G.activeMission(), ap = G.placeOf(am), al = sky.impl?.al;
    let showArrow = false;
    if (ap && al) {
      const p = sky.toScreen(ap.ra, ap.dec);
      const inView = p && p[0] > 40 && p[0] < W - 40 && p[1] > 70 && p[1] < H - 60;
      if (!inView) {
        const [ra0, dec0] = al.getRaDec(), { sep, pa } = sepPA(ra0, dec0, ap.ra, ap.dec);
        // na tela o norte fica para cima e o leste para a esquerda (céu visto de dentro)
        const dx = -Math.sin(pa), dy = -Math.cos(pa);
        // a seta corre pela borda de um retângulo que desvia da faixa da ordem (no topo) e dos controles de baixo
        const bar = document.querySelector('#mission-bar'), br = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
        const top = br && br.top < H / 2 ? br.bottom + 34 : 90, bottom = br && br.top >= H / 2 ? br.top - 40 : H - 90;
        const left = 60, right = W - 60, cx = W / 2, cy = (top + bottom) / 2;
        const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
        const ty = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
        const t = Math.min(tx, ty);
        arrow.style.transform = `translate(${(cx + dx * t).toFixed(1)}px, ${(cy + dy * t).toFixed(1)}px)`;
        arrow.innerHTML = `<span class="so-chev" style="transform:rotate(${Math.atan2(dy, dx)}rad)" aria-hidden="true">➤</span><span class="so-alabel"><b class="mono">${esc(actions.code(am))}</b> ${Math.round(sep)}°</span>`;
        arrow.setAttribute('aria-label', `Girar até o alvo da ordem ${actions.code(am)}, a ${Math.round(sep)} graus daqui`);
        showArrow = true;
      }
    }
    arrow.hidden = !showArrow;
  }
  G.onChange(rebuild);
  rebuild();
  frame();
  return { rebuild };
}
