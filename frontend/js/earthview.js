// Miniatura da Terra (canto da tela) e o planeta em tela cheia.
//
// A miniatura funciona como um giroscópio: ela é desenhada com a mesma orientação da sua vista no
// panorama, então quando você gira o céu ela gira junto. O ponto dourado é você (o satélite), e o cone
// mostra para onde você está olhando e quão aberto está o campo. Clicar nela faz a miniatura crescer até
// a tela cheia, com o planeta no centro, sem interface e com controles no estilo do Google Earth. Clicar
// fora do planeta (ou Esc) encolhe de volta para a miniatura.
//
// No planeta aparecem os jogadores online agora, na superfície, cada um na sua região aproximada. Quem
// está online é real (cada aba avisa o servidor a cada 30 s). A posição sai do fuso horário do navegador,
// deslocada de 120 a 300 km numa direção sorteada (api.approxLocation): mostra o país ou a região, nunca
// onde a pessoa está. Não há GPS nem consulta de IP.
//
// A Terra é a mesma do panorama: mesma orientação (GEO) e a mesma luz do horário de agora (dia e noite
// reais em cada lugar, com as luzes das cidades no lado da noite).
import { THREE_URL, IMG, EARTH_VS, EARTH_FS } from './intro.js';
import { GEO } from './globe.js';
import * as api from './api.js';
import * as G from './missions.js';

// Jogadores simulados: para a rede não parecer vazia numa demonstração. São sempre rotulados como
// simulados, não entram em ranking nenhum e somem com ?sim=0 no endereço. Os nomes, níveis e
// missões são inventados; a missão de cada um muda a cada poucos minutos.
const SIM_ON = new URLSearchParams(location.search).get('sim') !== '0';
// regiões dos simulados (inventadas, com o mesmo arredondamento dos jogadores reais)
const SIM_AT = [
  { loc: [-3.1, -60.0], region: 'Manaus' }, { loc: [-8.1, -34.9], region: 'Recife' }, { loc: [-15.8, -47.9], region: 'Brasília' },
  { loc: [-30.0, -51.2], region: 'Porto Alegre' }, { loc: [38.7, -9.1], region: 'Lisboa' }, { loc: [-12.9, -38.5], region: 'Salvador' },
  { loc: [-19.9, -43.9], region: 'Belo Horizonte' }, { loc: [-3.7, -38.5], region: 'Fortaleza' },
];
const SIM = [
  ['Vega-7', 4, '#4dd0e1'], ['Lince', 2, '#f06292'], ['Aurora-2', 6, '#ffd166'], ['Tucano', 3, '#4fc38a'],
  ['Kepler-Mirim', 1, '#ffffff'], ['Boto', 5, '#b48cff'], ['Cerrado-1', 2, '#f0a050'], ['Jandaia', 3, '#7c9cff'],
].map(([name, level, color], i) => ({ id: `sim-${i}-${name}`, nickname: name, level, color, sim: true, ...SIM_AT[i] }));
const SIM_MISSIONS = ['Missão 2: A estrela que corre', 'Missão 3: Quem pisca', 'Missão 4: Par escondido', 'Missão 6: A anã mais fria, parte 2',
  'Missão 7: Poeira no disco', 'Missão 8: Patrulha', 'Missão 10: Campo novo', null];
function simPlayers() {
  if (!SIM_ON) return [];
  const slot = Math.floor(Date.now() / 240000);
  return SIM.map((p, i) => ({ ...p, mission: SIM_MISSIONS[(slot * 3 + i * 5) % SIM_MISSIONS.length] }));
}

const R_KM = 6371, PERIOD = 98.6 * 60, INC = 97.8;   // período (s) e inclinação de uma órbita como a do SPHEREx

/** Latitude e longitude -> ponto na esfera da Terra, no referencial da própria Terra (o mesmo da textura). */
function latLonLocal(lat, lon, r = 1) {
  const phi = ((lon + 180) / 360) * 2 * Math.PI, th = ((90 - lat) / 180) * Math.PI;
  return [-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r];
}

/** Número de 0 a 1 tirado de um texto (sempre o mesmo para o mesmo texto). */
function hash01(s, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
/** Posição (raios da Terra, referencial do céu) de um jogador agora, numa órbita inventada a partir do id. */
function orbitPos(id, t) {
  const node = hash01(id, 1) * 2 * Math.PI, ph = hash01(id, 2) * 2 * Math.PI, r = 1 + (650 + 150 * hash01(id, 3)) / R_KM;
  const u = ph + (2 * Math.PI * t) / PERIOD, i = (INC * Math.PI) / 180;
  // no plano da órbita: (cos u, sin u); inclina pela inclinação e gira pelo nó, com o eixo do céu em y
  const x = Math.cos(u), y = Math.sin(u) * Math.sin(i), z = Math.sin(u) * Math.cos(i);
  return [r * (x * Math.cos(node) + z * Math.sin(node)), r * y, r * (-x * Math.sin(node) + z * Math.cos(node))];
}

const ATM_VS = `varying vec3 vN; varying vec3 vW;
void main() { vN = normalize(normalMatrix * normal); vW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATM_FS = `uniform vec3 sun; varying vec3 vN; varying vec3 vW;
void main() {
  float i = pow(clamp(0.75 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
  float lit = 0.15 + 0.85 * smoothstep(-0.35, 0.5, dot(vW, sun));
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * i * lit * 1.5, 1.0);
}`;

/** Monta a cena: Terra, atmosfera, você, o cone da vista e os jogadores. */
function buildScene(THREE, day, night) {
  const scene = new THREE.Scene();
  const geo = new THREE.Matrix3().fromArray(GEO).transpose();          // Terra -> céu
  const sunU = { value: new THREE.Vector3(1, 0, 0) };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.ShaderMaterial({
    uniforms: { day: { value: day }, night: { value: night }, sun: sunU }, vertexShader: EARTH_VS, fragmentShader: EARTH_FS,
  }));
  earth.quaternion.setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(geo));
  const atmU = { sun: sunU };
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.06, 48, 32), new THREE.ShaderMaterial({
    uniforms: atmU, vertexShader: ATM_VS, fragmentShader: ATM_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  scene.add(earth, atm);

  const me = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc95c }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.25, depthWrite: false }));
  me.add(halo);
  // cone da vista: ponta no satélite, abre na direção para onde você olha
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  cone.geometry.translate(0, -0.5, 0); cone.geometry.rotateX(-Math.PI / 2);   // ponta na origem, abrindo para +z
  scene.add(me, cone);
  // feixe da ordem ativa: do satélite na direção do alvo no céu
  // cilindro fino de comprimento 1, da origem para +z (escala e rotação a cada quadro)
  const beamGeo = new THREE.CylinderGeometry(0.007, 0.007, 1, 8, 1, true); beamGeo.translate(0, 0.5, 0); beamGeo.rotateX(Math.PI / 2);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.85, depthWrite: false }));
  const glowGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8, 1, true); glowGeo.translate(0, 0.5, 0); glowGeo.rotateX(Math.PI / 2);
  beam.add(new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffc95c, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending })));
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0xffc95c }));
  beam.visible = tip.visible = false;
  scene.add(beam, tip);

  // jogadores na superfície: ficam dentro da Terra (giram com ela e somem atrás dela pelo depth)
  const players = new THREE.Group(); earth.add(players);
  const dotGeo = new THREE.SphereGeometry(0.016, 12, 8);
  const ringGeo = new THREE.RingGeometry(0.026, 0.034, 28);
  // você também, na sua região aproximada (anel dourado)
  const home = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffc95c, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
  home.add(new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffc95c })));
  home.visible = false; earth.add(home);

  return {
    scene, earth, cone, me, players, tip, home,
    /** Atualiza luz, você, cone e jogadores. `others`: [{id, loc}] sem você; `myLoc`: [lat, lon] ou null. */
    update(snap, others, dotScale = 1, cam = null, aim = null, myLoc = null) {
      // perto, cada marcador encolhe com a distância até a câmera, para ficar do mesmo tamanho na tela
      const sz = (o) => (cam ? Math.max(0.02, Math.min(1, o.position.distanceTo(cam) / 3.2)) : dotScale);
      sunU.value.set(...snap.sun);
      // você: na posição da câmera do panorama (de longe, encostado na borda da cena)
      const L = Math.hypot(...snap.cam), k = L > 2.6 ? 2.6 / L : 1;
      me.position.set(snap.cam[0] * k, snap.cam[1] * k, snap.cam[2] * k);
      const half = Math.min(40, snap.fov / 2) * Math.PI / 180, len = 0.45;
      cone.position.copy(me.position);
      cone.scale.set(Math.tan(half) * len, Math.tan(half) * len, len);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...snap.C));
      // jogadores: um ponto na região aproximada de cada um, com um halo que pulsa devagar
      while (players.children.length > others.length) players.remove(players.children.at(-1));
      while (players.children.length < others.length) {
        const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x7ce8b5 }));
        d.add(new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x7ce8b5, transparent: true, opacity: 0.22, depthWrite: false })));
        players.add(d);
      }
      const t = Date.now() / 1000, pulse = 2.2 + 0.6 * Math.sin(t * 2.2);
      const wp = new THREE.Vector3();
      others.forEach((p, i) => {
        const d = players.children[i], c = p.color || '#7ce8b5';
        if (d.userData.c !== c) { d.material.color.set(c); d.children[0].material.color.set(c); d.userData.c = c; }
        d.children[0].material.opacity = p.sim ? 0.14 : 0.3;   // simulados com brilho mais fraco
        // sem região (cliente antigo): fica numa órbita inventada, como antes
        d.position.set(...(p.loc ? latLonLocal(p.loc[0], p.loc[1], 1.004) : orbitPos(p.id, t)));
        d.children[0].scale.setScalar(pulse);
        d.getWorldPosition(wp); const k = cam ? Math.max(0.05, Math.min(1, wp.distanceTo(cam) / 3.2)) : dotScale;
        d.scale.setScalar(k);
      });
      home.visible = !!myLoc;
      if (myLoc) {
        home.position.set(...latLonLocal(myLoc[0], myLoc[1], 1.005));
        home.lookAt(home.position.clone().multiplyScalar(2));   // anel deitado na superfície
        home.getWorldPosition(wp); home.scale.setScalar(cam ? Math.max(0.05, Math.min(1, wp.distanceTo(cam) / 3.2)) : dotScale);
      }
      me.scale.setScalar(sz(me));
      beam.visible = tip.visible = !!aim;
      if (aim) {
        const len = 0.9, d = new THREE.Vector3(...aim).normalize();
        beam.position.copy(me.position); beam.scale.set(1, 1, len);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
        tip.position.copy(me.position).addScaledVector(d, len); tip.scale.setScalar(sz(tip));
        tip.rotation.y = performance.now() / 900;
      }
    },
  };
}

/**
 * Liga a miniatura em `mini` (botão) e o planeta em tela cheia em `full`. `snapshot()` vem do globe.js e
 * devolve null fora do céu 360° da aba Céu (aí a miniatura some).
 */
export async function startEarthView({ mini, full, snapshot, skyLink = null, autoOpen = null, game = null }) {
  const THREE = await import(THREE_URL);
  const load = (f) => new Promise((res, rej) => new THREE.TextureLoader().load(IMG + f, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, rej));
  const [day, night] = await Promise.all([load('earth-blue-marble.jpg'), load('earth-night.jpg')]);

  // ---------------------------------------------------------------- quem está online
  let online = [];
  const me = api.sessionId();
  const others = () => online.filter((p) => p.id !== me).concat(simPlayers());
  let myLoc = null, locReady = false;
  api.approxLocation().then((l) => { myLoc = l?.loc || null; }).finally(() => { locReady = true; });
  const countEl = mini.querySelector('[data-online]'), simEl = mini.querySelector('[data-sim]');
  async function refresh() {
    if (document.hidden) return;
    online = await api.ping();
    countEl.textContent = String(online.length);
    if (simEl) simEl.textContent = SIM_ON ? ` · ${SIM.length} simulados` : '';
  }
  refresh();
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);

  // ---------------------------------------------------------------- miniatura (giroscópio)
  const mr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  mr.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); mr.setClearColor(0x000000, 0);
  mr.toneMapping = THREE.ACESFilmicToneMapping;
  mini.querySelector('.mini-canvas').appendChild(mr.domElement);
  const mScene = buildScene(THREE, day, night);
  const mCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  // ---------------------------------------------------------------- planeta em tela cheia
  const host = full;
  const br = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  br.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); br.setClearColor(0x000000, 0);
  br.toneMapping = THREE.ACESFilmicToneMapping;
  host.prepend(br.domElement);
  const bScene = buildScene(THREE, day, night);
  const FOV = 35;
  const bCam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const nav = earthNav(THREE, host, bCam, null, () => close());
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastSnap = null, closing = 0, autoDone = false;

  /** Tamanho do planeta na tela (fração da altura) e a distância da câmera que dá esse tamanho. */
  function fit() {
    const w = innerWidth, h = innerHeight, frac = 0.74 * Math.min(1, w / h);
    const a = Math.atan(frac * Math.tan((FOV / 2) * Math.PI / 180));
    return { frac, range: 1 / Math.sin(a) - 1, px: frac * h };
  }
  /** Onde a miniatura está: o recorte circular e o planeta começam (e terminam) ali. */
  function fromMini() {
    const r = mini.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    full.style.setProperty('--cx', `${cx}px`); full.style.setProperty('--cy', `${cy}px`);
    full.style.setProperty('--r0', `${r.width / 2}px`);
    full.style.setProperty('--dx', `${cx - innerWidth / 2}px`); full.style.setProperty('--dy', `${cy - innerHeight / 2}px`);
    full.style.setProperty('--s', String((r.width * 0.62) / fit().px));
  }
  // ---------------------------------------------------------------- panorama junto com o globo
  // Enquanto o planeta está aberto, o céu de fundo gira junto: o centro do panorama segue a direção para
  // onde a câmera do globo olha (o céu que está de fato atrás da Terra). Ao sair, a vista anterior volta.
  let savedView = null, lastAim = null;
  function linkSky() {
    if (!skyLink || !savedView) return;
    const f = new THREE.Vector3(); bCam.getWorldDirection(f);
    const dec = Math.asin(Math.max(-1, Math.min(1, f.y))) * 180 / Math.PI;
    const ra = ((Math.atan2(-f.z, f.x) * 180 / Math.PI) + 360) % 360;
    if (lastAim && Math.abs(lastAim[0] - ra) < 0.02 && Math.abs(lastAim[1] - dec) < 0.02) return;
    lastAim = [ra, dec];
    skyLink.set(ra, dec);
  }

  function open() {
    const s = snapshot(); if (!s) return;
    clearTimeout(closing);
    if (skyLink && !savedView) { savedView = skyLink.get(); lastAim = null; }
    lastSnap = s;
    fromMini();
    full.hidden = false;
    // o planeta inteiro no centro, norte para cima, virado para a sua região (ou para o satélite)
    // com uma missão ativa, olha um pouco de lado para o feixe até o alvo aparecer inteiro
    const o = new THREE.Vector3(...s.cam).normalize(), aim = aimNow();
    if (myLoc && !aim) {
      bScene.earth.updateMatrixWorld();
      o.set(...latLonLocal(myLoc[0], myLoc[1])).applyQuaternion(bScene.earth.quaternion).normalize();
    }
    if (aim) {
      // eixo da câmera perpendicular ao feixe: ele aparece com o comprimento inteiro
      const a = new THREE.Vector3(...aim).normalize(), side = o.clone().addScaledVector(a, -o.dot(a));
      if (side.lengthSq() > 1e-3) o.copy(side.normalize());
    }
    nav.reset(o, fit().range);
    sizeTo(br, bCam, host);
    full.getBoundingClientRect();                 // aplica o estado inicial antes de animar
    full.classList.add('open');
    renderCard();
    full.focus({ preventScroll: true });
    refresh();
  }
  function close() {
    if (full.hidden || !full.classList.contains('open')) return;
    tip.hidden = true;
    fromMini();
    full.classList.remove('open');
    if (skyLink && savedView) { skyLink.restore(...savedView); savedView = null; }
    closing = setTimeout(() => { full.hidden = true; mini.focus({ preventScroll: true }); }, still ? 0 : 600);
  }
  mini.addEventListener('click', open);

  // ---------------------------------------------------------------- cartão "próxima missão"
  // Ajuda a começar: mostra a missão em andamento (ou a próxima) com um botão para jogar, e o atalho
  // para a partida rápida. Clicar no cartão não conta como "clique fora do planeta".
  const card = document.createElement('aside');
  card.className = 'ef-next'; card.hidden = true; card.setAttribute('aria-label', 'Próxima missão');
  full.append(card);
  for (const t of ['pointerdown', 'pointerup', 'click', 'wheel']) card.addEventListener(t, (e) => e.stopPropagation());
  function renderCard() {
    const s = G.get();
    if (!game || !s) { card.hidden = true; return; }
    const act = G.activeMission(), nx = act || s.missions.find((m) => m.status !== 'done' && !m.locked);
    const done = s.missions.filter((m) => m.status === 'done').length, n = nx ? s.missions.indexOf(nx) + 1 : 0;
    card.innerHTML = nx ? `
      <p class="label">${act ? 'Em andamento' : done ? 'Próxima missão' : 'Comece por aqui'} · ${done}/${s.missions.length}</p>
      <h3>Missão ${n} · ${esc(nx.title)}</h3>
      <p class="small">${esc(nx.brief)}</p>
      <div class="ef-next-bar"><i style="width:${(100 * done) / s.missions.length}%"></i></div>
      <div class="row"><button class="primary" data-n="play">${act ? 'Continuar' : 'Jogar'} ▸</button>
        <button class="ghost" data-n="hunt" title="5 rodadas rápidas: ache o que se move">⚡ Caça rápida</button></div>`
      : `<p class="label">Campanha completa</p><h3>Todas as missões feitas</h3>
      <div class="row"><button class="primary" data-n="hunt">⚡ Caça ao movimento</button><button class="ghost" data-n="all">Ver missões</button></div>`;
    card.dataset.id = nx?.id || '';
    card.hidden = false;
  }
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const id = card.dataset.id, a = b.dataset.n;
    close();
    if (a === 'play') (G.activeMission() ? game.go(G.activeMission()) : game.accept(id));
    if (a === 'hunt') game.hunt();
    if (a === 'all') game.all();
  });
  G.onChange(() => { if (!full.hidden) renderCard(); });
  const tip = document.createElement('div'); tip.className = 'ef-tip'; tip.hidden = true; full.append(tip);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  full.addEventListener('pointermove', (e) => {
    if (e.buttons) { tip.hidden = true; return; }
    const list = others(), r = full.getBoundingClientRect(), v = new THREE.Vector3();
    let best = null, bd = 16;
    const test = (obj, p) => {
      v.setFromMatrixPosition(obj.matrixWorld).project(bCam);
      if (v.z > 1) return;
      const x = (v.x + 1) / 2 * r.width, y = (1 - v.y) / 2 * r.height, d = Math.hypot(x - e.clientX + r.left, y - e.clientY + r.top);
      if (d < bd) { bd = d; best = { p, x, y }; }
    };
    bScene.players.children.forEach((d, i) => list[i] && test(d, list[i]));
    if (bScene.home.visible) test(bScene.home, { me: true });
    test(bScene.me, { me: true, sat: true });
    tip.hidden = !best;
    if (!best) return;
    const p = best.p, mine = online.find((o) => o.id === me) || {};
    const where = (r) => (r ? `<small>região de ${esc(r)} (aproximada)</small>` : '');
    tip.innerHTML = p.me
      ? `<b>${p.sat ? 'Seu satélite' : 'Você'}</b>${mine.level ? ` · nível ${mine.level}` : ''}${p.sat ? '' : where(mine.region)}<small>${esc(mine.mission || 'sem missão ativa')}</small>`
      : `<b>${esc(p.nickname || p.satname || 'Visitante')}</b>${p.level ? ` · nível ${p.level}` : ''}${p.sim ? ' · <i>simulado</i>' : ''}${where(p.region)}<small>${esc(p.mission || 'sem missão ativa')}</small>`;
    tip.style.left = `${best.x}px`; tip.style.top = `${best.y}px`;
  });
  full.addEventListener('pointerleave', () => { tip.hidden = true; });
  full.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  addEventListener('resize', () => { if (!full.hidden) nav.fitRange?.(fit().range); });

  /** Vetor (referencial do céu) do alvo da ordem ativa, ou null. */
  function aimNow() {
    const p = G.placeOf(G.activeMission());
    if (!p) return null;
    const a = p.ra * Math.PI / 180, d = p.dec * Math.PI / 180;
    return [Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a)];
  }
  const aimTag = document.createElement('div'); aimTag.className = 'ef-aim'; aimTag.hidden = true; full.append(aimTag);

  // ---------------------------------------------------------------- quadro a quadro
  const sizeTo = (r, cam, el) => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return false;
    const c = r.domElement;
    if (c.width !== Math.round(w * r.getPixelRatio()) || c.height !== Math.round(h * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    return true;
  };
  function frame() {
    requestAnimationFrame(frame);
    const s = snapshot();
    mini.hidden = !s;
    if (s && !document.hidden) {
      // giroscópio: a câmera da miniatura tem a mesma orientação da sua vista, um pouco por cima
      const C = new THREE.Vector3(...s.C), up = new THREE.Vector3(...s.N);
      const at = C.clone().multiplyScalar(0.5);
      mCam.up.copy(up);
      mCam.position.copy(at).addScaledVector(C, -6.2).addScaledVector(up, 1.6);
      mCam.lookAt(at);
      if (sizeTo(mr, mCam, mr.domElement.parentElement)) { mScene.update(s, others(), 1.3, null, aimNow(), myLoc); mr.render(mScene.scene, mCam); }
      // por padrão o planeta abre centralizado na primeira vez que o céu fica à vista
      if (!autoDone && locReady && autoOpen?.()) { autoDone = true; open(); }
    }
    if (!full.hidden) {
      if (s) lastSnap = s;
      nav.step();
      if (full.classList.contains('open')) linkSky();
      const aim = aimNow();
      if (lastSnap && sizeTo(br, bCam, host)) { bScene.update(lastSnap, others(), 1, bCam.position, aim, myLoc); br.render(bScene.scene, bCam); }
      // rótulo da ordem na ponta do feixe
      const am = G.activeMission();
      // o rótulo some quando a ponta do feixe fica atrás da Terra
      const tipW = new THREE.Vector3().setFromMatrixPosition(bScene.tip.matrixWorld);
      const ray = new THREE.Ray(bCam.position.clone(), tipW.clone().sub(bCam.position).normalize());
      const hitE = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
      const behind = hitE && hitE.distanceTo(bCam.position) < tipW.distanceTo(bCam.position);
      // a linha de visada do satélite até o alvo cruza a Terra? (aí o alvo está "atrás da Terra" agora)
      const meW = new THREE.Vector3().setFromMatrixPosition(bScene.me.matrixWorld);
      const blocked = aim && new THREE.Ray(meW, new THREE.Vector3(...aim).normalize()).intersectsSphere(new THREE.Sphere(new THREE.Vector3(), 1));
      aimTag.hidden = !aim;
      if (aim) {
        const v = (behind || blocked ? meW : tipW).clone().project(bCam);
        aimTag.classList.toggle('blocked', !!blocked);
        aimTag.dataset.suffix = blocked ? ' · alvo atrás da Terra' : '';
        aimTag.style.left = `${((v.x + 1) / 2) * full.clientWidth}px`; aimTag.style.top = `${((1 - v.y) / 2) * full.clientHeight}px`;
        const n = `Missão ${G.get().missions.indexOf(am) + 1}`;
        const full2 = blocked ? `${n} · alvo atrás da Terra` : `${n} · ${am.title}`;
        aimTag.classList.toggle('flip', ((v.x + 1) / 2) > 0.62);
        if (aimTag.textContent !== full2) aimTag.textContent = full2;
      }
    }
  }
  frame();
}

/**
 * Controles no estilo do Google Earth para o globo grande. A câmera olha para um ponto da superfície
 * (alvo) de uma distância (range), com rumo (heading) e inclinação (tilt), com o norte para cima.
 *  - arrastar: o ponto que você pegou fica embaixo do cursor (a Terra "vem junto"); solto, ela desliza
 *  - roda / pinça: aproxima ou afasta na direção do cursor, mais devagar perto do chão
 *  - botão direito, Ctrl ou Shift arrastando: para os lados gira o rumo, para cima e para baixo inclina
 *  - duplo clique: aproxima ali; botão N: volta para o norte em cima e a vista de cima
 *  - clique (sem arrastar) fora do planeta: chama `onOutside`
 */
function earthNav(THREE, el, cam, northBtn, onOutside) {
  const V = (...a) => new THREE.Vector3(...a);
  const MIN = 0.012, MAX = 8;                     // de ~75 km até 8 raios da Terra acima do chão
  let T = V(0, 0, 1), range = 3.2, heading = 0, tilt = 0;
  let grab = null, turn = null, spin = null;      // spin: rotação que continua depois de soltar
  let down = null;                                // onde o botão desceu, para saber se foi um clique
  const pts = new Map();
  const ray = new THREE.Raycaster(), ball = new THREE.Sphere(V(0, 0, 0), 1);

  function place() {
    const up = T.clone().normalize();
    let north = V(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-8) north = V(0, 0, -1).addScaledVector(up, -up.z);
    north.normalize();
    const east = V().crossVectors(north, up);
    const fwd = north.clone().multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading));
    const dir = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, -Math.sin(tilt));
    cam.position.copy(up).addScaledVector(dir, range);
    cam.up.copy(fwd).multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt));
    cam.lookAt(up);
    cam.near = Math.max(0.002, range * 0.2); cam.far = range + 4; cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  /** Ponto da Terra embaixo do pixel (x, y), ou null se o pixel cai no espaço. */
  function hit(x, y) {
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
    const p = ray.ray.intersectSphere(ball, V());
    return p ? p.normalize() : null;
  }
  /** Gira o alvo para o ponto p1 ir para onde estava p0. */
  function carry(p1, p0) {
    const q = new THREE.Quaternion().setFromUnitVectors(p1, p0);
    T.applyQuaternion(q).normalize();
    return q;
  }
  // longe da Terra não dá para inclinar muito (a câmera iria para o outro lado do globo)
  const maxTilt = () => (range > 1.5 ? 0.25 : range > 0.4 ? 0.8 : 1.35);
  function zoom(f, x, y) {
    const p0 = x === undefined ? null : hit(x, y);
    range = Math.max(MIN, Math.min(MAX, range * f));
    tilt = Math.min(tilt, maxTilt());
    place();
    const p1 = p0 && hit(x, y);
    if (p0 && p1) { carry(p1, p0); place(); }
  }

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== el && e.target.tagName !== 'CANVAS') return;
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    spin = null;
    down = pts.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (pts.size === 2) { grab = null; const [a, b] = [...pts.values()]; turn = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]) }; return; }
    if (e.button === 2 || e.ctrlKey || e.shiftKey) { turn = { x: e.clientX, y: e.clientY, h: heading, t: tilt }; return; }
    const p = hit(e.clientX, e.clientY);
    grab = p ? { p, t: performance.now(), v: null } : null;
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (turn?.pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      zoom(turn.pinch / d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); turn.pinch = d; return;
    }
    if (turn) {
      heading = turn.h + (e.clientX - turn.x) * 0.006;
      tilt = Math.max(0, Math.min(maxTilt(), turn.t - (e.clientY - turn.y) * 0.006));
      place(); return;
    }
    if (!grab) return;
    const p1 = hit(e.clientX, e.clientY);
    if (!p1) return;
    const q = carry(p1, grab.p); place();
    const now = performance.now(), dt = Math.max(1, now - grab.t), s = Math.hypot(q.x, q.y, q.z);
    if (s > 1e-7) grab.v = { axis: V(q.x / s, q.y / s, q.z / s), w: (2 * Math.atan2(s, q.w)) / dt };
    grab.t = now;
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (down && e.type === 'pointerup' && !pts.size && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && !hit(e.clientX, e.clientY)) {
      down = null; grab = null; turn = null; onOutside?.(); return;
    }
    down = null;
    if (grab?.v && performance.now() - grab.t < 80) spin = { axis: grab.v.axis, w: Math.min(0.08, grab.v.w * 16) };
    grab = null; if (pts.size < 2) turn = null;
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => { e.preventDefault(); spin = null; zoom(Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))), e.clientX, e.clientY); }, { passive: false });
  el.addEventListener('dblclick', (e) => { if (e.target === el || e.target.tagName === 'CANVAS') zoom(0.45, e.clientX, e.clientY); });
  northBtn?.addEventListener('click', () => { heading = 0; tilt = 0; spin = null; place(); });

  return {
    reset(target, r) { T = target.clone().normalize(); range = r; heading = 0; tilt = 0; spin = null; place(); },
    /** Na mudança de tamanho da janela: só reajusta se a pessoa ainda não aproximou. */
    fitRange(r) { if (range > 1) { range = r; place(); } },
    range: () => range,
    /** A cada quadro: a Terra continua deslizando um pouco depois de soltar. */
    step() {
      if (spin && spin.w > 1e-5) { T.applyAxisAngle(spin.axis, spin.w).normalize(); spin.w *= 0.9; place(); } else spin = null;
      if (northBtn) northBtn.style.transform = `rotate(${-heading}rad)`;
    },
  };
}
