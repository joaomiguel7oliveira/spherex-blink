// A Terra em tamanho real no panorama, vista de onde o SPHEREx está: ~700 km de altura, ao lado do
// satélite. Daí a Terra não é uma bola pequena: ela ocupa uma calota de 64° de raio no céu, uma
// parede curva que esconde quase um terço do céu.
//
// A Terra é desenhada pixel a pixel na mesma projeção estereográfica do Aladin: para cada pixel o
// shader acha a direção no céu, lança um raio a partir da câmera e vê se ele bate na esfera da Terra.
// Assim ela fica colada ao céu ao arrastar, girar e dar zoom, e o horizonte cai no lugar certo.
//  - O centro da Terra fica fixo no céu, "embaixo" da vista inicial, e o eixo dela é o eixo do céu.
//  - Lá embaixo fica a Índia (ilustrativo), mas a luz é a do horário de agora: cada lugar da Terra
//    está de dia ou de noite como está de verdade neste momento.
//  - O satélite flutua ao lado da câmera, com o telescópio virado para longe da Terra.
// Ilustração: a posição do satélite na órbita é escolhida para a vista ficar boa, não é a real.
import { THREE_URL, IMG, buildSpherex } from './intro.js';

const D2R = Math.PI / 180;
const ALT_KM = 700, R_KM = 6371;
const DIST = 1 + ALT_KM / R_KM;            // distância da câmera ao centro da Terra, em raios da Terra
// Vista inicial (a mesma de HOME_VIEW em skysphere.js) e, 72° abaixo dela, o centro da Terra.
// A Terra fica "em pé": o eixo dela é paralelo ao eixo do céu, como de verdade, então o norte da Terra
// aponta sempre para o norte do céu, que é para cima na tela. Com o centro da Terra no equador do céu,
// o satélite está sobre o equador da Terra.
const HOME = { ra: 250, dec: 72 }, BELOW = 72 * D2R;
// Longitude logo abaixo do satélite: o oceano Índico, com a Índia inteira à frente até o horizonte
// (olhando para o norte, de 700 km se vê de ~8° a ~26° de latitude). Ilustrativo: a órbita real passa
// por todas as longitudes.
const UNDER_LON = 78;
const SAT_SIZE = 5 * D2R;                  // tamanho aparente do satélite (rad)
// Afastar: com o céu já no campo máximo, a roda do mouse leva a câmera para longe da Terra, até a
// distância da Lua. O satélite fica para trás na órbita (SAT_GAP: distância dele à câmera inicial).
const DIST_MAX = 1 + 384400 / R_KM, SAT_GAP = 0.05;
const toRaDec = (v) => { const l = Math.hypot(...v) || 1; return { ra: (Math.atan2(-v[2], v[0]) / D2R + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, v[1] / l))) / D2R }; };

const jdNow = () => Date.now() / 86400000 + 2440587.5;
function sunRaDec(jd) {
  const n = jd - 2451545, L = 280.46 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
  return { ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / D2R, dec: Math.asin(Math.sin(eps) * Math.sin(lam)) / D2R };
}
/** Vetor unitário da direção (ra, dec), na mesma convenção do shader. */
const vec = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.sin(dec * D2R), -Math.cos(dec * D2R) * Math.sin(ra * D2R)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const HC = vec(HOME.ra, HOME.dec);
const HN = [-Math.sin(HOME.dec * D2R) * Math.cos(HOME.ra * D2R), Math.cos(HOME.dec * D2R), Math.sin(HOME.dec * D2R) * Math.sin(HOME.ra * D2R)];   // norte, "para cima" na vista inicial
const NADIR = HC.map((c, i) => Math.cos(BELOW) * c - Math.sin(BELOW) * HN[i]);
const UP = NADIR.map((x) => -x);   // normal da Terra no ponto logo abaixo do satélite
const raOf = (v) => Math.atan2(-v[2], v[0]);
/** Céu -> Terra: só um giro em torno do eixo (latitude = declinação), com UNDER_LON logo abaixo. */
const GEO_T = UNDER_LON * D2R - raOf(UP);
const GEO = (() => {
  const t = GEO_T, c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 1, 0, s, 0, c];                 // em ordem de coluna, para THREE.Matrix3.fromArray
})();
// satélite: 22° à direita e 6° abaixo do centro da vista inicial (à direita = oeste)
const HE = [-Math.sin(HOME.ra * D2R), 0, -Math.cos(HOME.ra * D2R)];
const SAT_VEC = unit(HC.map((x, i) => x - Math.tan(22 * D2R) * HE[i] - Math.tan(6 * D2R) * HN[i]));
const sunVec = () => { const s = sunRaDec(jdNow()); return vec(s.ra, s.dec); };
/** Tempo sideral de Greenwich (graus): quanto a Terra girou em relação às estrelas. */
const gmst = (jd) => 280.46061837 + 360.98564736629 * (jd - 2451545);
/**
 * Luz da Terra e do satélite, no horário de agora. O ponto onde o Sol está a pino (latitude =
 * declinação do Sol, longitude = AR do Sol − tempo sideral) é levado para o céu pelo mesmo giro GEO
 * da Terra. Assim a hora local de cada lugar no mapa é a real (Índia de noite quando é noite lá).
 * Como a Terra está girada para deixar a Índia embaixo, esta direção não é a do Sol no céu de verdade
 * (a Lua usa a direção real, para a fase dela ficar certa).
 */
function sunLight(jd = jdNow()) {
  const s = sunRaDec(jd);
  return vec(s.ra - gmst(jd) - GEO_T / D2R, s.dec);
}
// Lua: posição de agora pela fórmula de baixa precisão do Astronomical Almanac (~0,3°), distância em
// raios da Terra a partir do centro dela. A fase sai sozinha: ela é iluminada pelo Sol de verdade.
const MOON_R = 1737.4 / R_KM;
function moonNow(jd = jdNow()) {
  const T = (jd - 2451545) / 36525, sn = (a) => Math.sin(a * D2R), cs = (a) => Math.cos(a * D2R);
  const L = 218.32 + 481267.881 * T + 6.29 * sn(135.0 + 477198.87 * T) - 1.27 * sn(259.3 - 413335.36 * T) + 0.66 * sn(235.7 + 890534.22 * T)
    + 0.21 * sn(269.9 + 954397.74 * T) - 0.19 * sn(357.5 + 35999.05 * T) - 0.11 * sn(186.5 + 966404.03 * T);
  const B = 5.13 * sn(93.3 + 483202.03 * T) + 0.28 * sn(228.2 + 960400.87 * T) - 0.28 * sn(318.3 + 6003.18 * T) - 0.17 * sn(217.6 - 407332.2 * T);
  const P = 0.9508 + 0.0518 * cs(135.0 + 477198.87 * T) + 0.0095 * cs(259.3 - 413335.38 * T) + 0.0078 * cs(235.7 + 890534.23 * T) + 0.0028 * cs(269.9 + 954397.7 * T);
  const x = cs(B) * cs(L), y = cs(B) * sn(L), z = sn(B), e = 23.439 * D2R;   // eclíptica -> equador
  const ye = y * Math.cos(e) - z * Math.sin(e), ze = y * Math.sin(e) + z * Math.cos(e);
  const ra = Math.atan2(ye, x) / D2R, dec = Math.asin(ze) / D2R, dist = 1 / sn(P);
  return { ra: (ra + 360) % 360, dec, dist, pos: vec(ra, dec).map((c) => c * dist) };
}
// mapa da Lua: mosaico LROC WAC (NASA/GSFC/Arizona State), pelo WMS do USGS Astrogeology
const MOON_MAP = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=LROC_WAC&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg&STYLES=';

// Detalhe: a textura global tem ~10 km por pixel; de 700 km isso borra. Por cima dela vai um recorte
// de ~2 km por pixel da região que aparece de perto (Índia e arredores), montado com blocos do NASA
// GIBS (Blue Marble Next Generation, nível 5: blocos de 512 px e 9°). Se não carregar, fica só a global.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/2004-08-01/500m/';
const HI = { level: 5, row0: 6, rows: 6, col0: 24, cols: 8, deg: 9 };   // lon 36° a 108°, lat −18° a 36°
const HI_BOX = [-180 + HI.col0 * HI.deg, -180 + (HI.col0 + HI.cols) * HI.deg, 90 - (HI.row0 + HI.rows) * HI.deg, 90 - HI.row0 * HI.deg];   // lon mín, lon máx, lat mín, lat máx
async function loadDetail(THREE, renderer) {
  const cv = document.createElement('canvas'); cv.width = HI.cols * 512; cv.height = HI.rows * 512;
  const g = cv.getContext('2d');
  const tile = (r, c) => new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { g.drawImage(im, (c - HI.col0) * 512, (r - HI.row0) * 512); res(); };
    im.onerror = rej; im.src = `${GIBS}${HI.level}/${r}/${c}.jpeg`;
  });
  const jobs = [];
  for (let r = HI.row0; r < HI.row0 + HI.rows; r++) for (let c = HI.col0; c < HI.col0 + HI.cols; c++) jobs.push(tile(r, c));
  await Promise.all(jobs);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}

const EARTH_VS = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const EARTH_FS = `
precision highp float;
uniform sampler2D day; uniform sampler2D night; uniform sampler2D hi; uniform vec4 hiBox; uniform float hiOn;
uniform sampler2D moonMap; uniform vec3 moon; uniform vec3 sunR; uniform float moonR; uniform float moonOn;
uniform vec3 C; uniform vec3 E; uniform vec3 N; uniform vec3 D; uniform vec3 sun;
uniform vec2 ctr; uniform vec2 res; uniform float k; uniform float roll; uniform float dpr; uniform float dist; uniform mat3 geo; uniform float alpha;
const float PI = 3.141592653589793;
void main() {
  // pixel -> direção no céu (projeção estereográfica inversa, igual à do Aladin)
  vec2 p = vec2(gl_FragCoord.x / dpr, res.y - gl_FragCoord.y / dpr) - ctr;
  vec2 nS = vec2(sin(roll), -cos(roll)), eS = vec2(-cos(roll), -sin(roll));
  float u = dot(p, eS), v = dot(p, nS), r = length(vec2(u, v)) / k, th = 2.0 * atan(0.5 * r);
  vec3 t = r > 1e-6 ? normalize(u * E + v * N) : E;
  vec3 d = cos(th) * C + sin(th) * t;
  // raio da câmera contra a esfera da Terra (raio 1, centro em D * dist)
  vec3 P = D * dist;
  float b = dot(d, P), pp = dot(P, P), disc = b * b - (pp - 1.0);
  float m = sqrt(max(pp - b * b, 0.0));           // menor distância do raio ao centro
  vec3 atm = vec3(0.32, 0.58, 1.0);
  vec4 col = vec4(0.0);
  // Lua: mesma ideia (raio contra esfera), com a borda suavizada pelo tamanho do pixel
  vec3 Q = P + moon;
  float bm = dot(d, Q), mm = sqrt(max(dot(Q, Q) - bm * bm, 0.0)), aa = max(fwidth(mm), 1e-7);
  float cov = moonOn * step(0.0, bm) * smoothstep(moonR + aa, moonR - aa, mm);
  float tE = (b > 0.0 && disc > 0.0) ? b - sqrt(disc) : 1e9;
  if (cov > 0.0 && (bm < tE || alpha < 0.5)) {
    vec3 X = d * (bm - sqrt(max(moonR * moonR - mm * mm, 0.0))), nm = normalize(X - Q);
    vec3 e = normalize(-moon), up = normalize(vec3(0.0, 1.0, 0.0) - e.y * e), east = cross(-e, up);
    float mlon = atan(dot(nm, east), dot(nm, e)), mlat = asin(clamp(dot(nm, up), -1.0, 1.0));
    vec3 alb = texture2D(moonMap, vec2(mlon / (2.0 * PI) + 0.5, mlat / PI + 0.5)).rgb;
    vec3 c = alb * (0.015 + 2.2 * max(dot(nm, sunR), 0.0));
    gl_FragColor = vec4(c, cov);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  if (b > 0.0 && disc > 0.0) {
    vec3 X = d * (b - sqrt(disc)), n = normalize(X - P);
    vec3 g = geo * n;                                // céu -> coordenadas na Terra
    float lat = asin(clamp(g.y, -1.0, 1.0)), lon = atan(-g.z, g.x);
    vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), (lat + 0.5 * PI) / PI);
    float s = dot(n, sun), kd = smoothstep(-0.1, 0.22, s);
    vec3 dayC = texture2D(day, uv).rgb, nightC = texture2D(night, uv).rgb;
    // recorte detalhado por cima, com a borda esfumada
    vec2 hu = vec2((lon - hiBox.x) / (hiBox.y - hiBox.x), (lat - hiBox.z) / (hiBox.w - hiBox.z));
    float he = min(min(hu.x, 1.0 - hu.x), min(hu.y, 1.0 - hu.y));
    vec3 hiC = texture2D(hi, clamp(hu, 0.0, 1.0)).rgb;
    dayC = mix(dayC, hiC, hiOn * smoothstep(0.0, 0.05, he));
    vec3 c = mix(nightC * vec3(1.0, 0.8, 0.55) * 2.2, dayC * (0.06 + 1.7 * max(s, 0.0)), kd);
    // água: um pouco de luz do céu e o reflexo do Sol (o oceano do Blue Marble é quase preto)
    float wet = smoothstep(1.6, 3.0, dayC.b / (dayC.r + 0.001));   // cores lineares: o mar é bem mais azul que vermelho
    float glint = pow(max(dot(reflect(-sun, n), -d), 0.0), 90.0);
    c += wet * kd * (vec3(0.02, 0.06, 0.14) * max(s, 0.0) + vec3(1.0, 0.92, 0.8) * glint * 0.35);
    // de 700 km quase tudo é visto de lado: a névoa azul só engrossa perto do horizonte
    float fr = pow(1.0 - max(dot(n, -d), 0.0), 6.0);
    c = mix(c, atm * (0.08 + 0.9 * smoothstep(-0.25, 0.6, s)), 0.6 * fr);
    col = vec4(c, 1.0);
  } else if (b > 0.0) {
    // atmosfera: um véu azul fino logo acima do horizonte, aceso só do lado do dia
    float h = m - 1.0, lit = smoothstep(-0.35, 0.45, dot(normalize(d * b - P), sun));
    float g = exp(-h / 0.012) * (0.1 + 0.9 * lit);
    col = vec4(atm * 1.4, g);
  }
  gl_FragColor = vec4(col.rgb, col.a * alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Fundo para os reflexos do satélite: espaço escuro em cima, o azul da Terra embaixo. */
function envTexture(THREE) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#020308'); grd.addColorStop(0.48, '#070b18'); grd.addColorStop(0.52, '#6d9be8'); grd.addColorStop(0.7, '#2c58a8'); grd.addColorStop(1, '#0d1f45');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Liga a Terra e o satélite dentro de `host` (camada transparente por cima do céu, sem cliques).
 * `getView()` devolve { C, E, N, roll, k, cx, cy, fov, atMax, toScreen(ra, dec) } ou null quando nada deve aparecer.
 * `wheelEl` recebe a roda do mouse antes do céu, para afastar e aproximar a câmera da Terra.
 */
export async function startGlobe(host, getView, wheelEl) {
  const THREE = await import(THREE_URL);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);

  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const load = (f) => new Promise((res, rej) => loader.load(IMG + f, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; res(t);   // sem mipmaps: não marca a emenda em 180°
  }, undefined, rej));
  const [day, night] = await Promise.all([load('earth-blue-marble.jpg'), load('earth-night.jpg')]);

  const scene = new THREE.Scene(), earthScene = new THREE.Scene();   // duas passadas: a Terra primeiro, o satélite por cima
  renderer.autoClear = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000); camera.position.z = 5000;

  // Terra: um retângulo que cobre a tela; o shader decide pixel a pixel
  const U = {
    day: { value: day }, night: { value: night }, C: { value: new THREE.Vector3() }, E: { value: new THREE.Vector3() }, N: { value: new THREE.Vector3() },
    D: { value: new THREE.Vector3(...NADIR) }, sun: { value: new THREE.Vector3() }, ctr: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2() },
    k: { value: 1 }, roll: { value: 0 }, dpr: { value: dpr }, dist: { value: DIST }, geo: { value: new THREE.Matrix3().fromArray(GEO) }, alpha: { value: 1 },
    hi: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, hiOn: { value: 0 },
    hiBox: { value: new THREE.Vector4(...HI_BOX.map((x) => x * D2R)) },
    moonMap: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, moon: { value: new THREE.Vector3() }, sunR: { value: new THREE.Vector3() },
    moonR: { value: MOON_R }, moonOn: { value: 0 },
  };
  loader.load(MOON_MAP, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); U.moonMap.value = t; U.moonOn.value = 1; },
    undefined, (e) => console.warn('Mapa da Lua indisponível:', e));
  loadDetail(THREE, renderer).then((t) => { U.hi.value = t; U.hiOn.value = 1; }).catch((e) => console.warn('Detalhe da Terra (GIBS) indisponível:', e));
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: U, vertexShader: EARTH_VS, fragmentShader: EARTH_FS, transparent: true, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false; earthScene.add(quad);

  // satélite: orientado no referencial do céu, então gira junto quando você olha em volta
  const env = envTexture(THREE);
  const sat = buildSpherex(THREE, env);
  const roll = new THREE.Group(), flip = new THREE.Group(), cel = new THREE.Group(), satG = new THREE.Group();
  flip.rotation.y = Math.PI;            // de dentro do céu: o centro da vista fica atrás da tela, o leste à esquerda
  cel.rotation.order = 'ZXY';
  scene.add(roll); roll.add(flip); flip.add(cel); cel.add(satG); satG.add(sat);
  const key = new THREE.DirectionalLight(0xfff4e6, 3.2); scene.add(key);
  scene.add(new THREE.HemisphereLight(0x0a0f1e, 0x3a6ad0, 0.9), new THREE.AmbientLight(0x404858, 0.3));

  let W = 0, H = 0;
  const resize = () => {
    W = host.clientWidth || innerWidth; H = host.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    Object.assign(camera, { left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2 }); camera.updateProjectionMatrix();
    U.res.value.set(W, H);
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(host);

  // posição do centro da Terra em relação à câmera (raios da Terra): `pos` anda suave até `goal`.
  // Na órbita, ela fica logo abaixo (NADIR) a 1,11 raio; `dist` é o tamanho de `pos`.
  const P0 = NADIR.map((x) => x * DIST), ZEN = new THREE.Vector3(...UP);   // ZEN: telescópio para o zênite
  let pos = [...P0], goal = [...P0], dist = DIST;
  /**
   * Afasta (n > 0) ou aproxima (n < 0) em passos, andando ao longo de `d` (o raio sob o cursor; sem ele,
   * em linha reta a partir do centro da Terra). A altura cresce ou encolhe em proporção. Devolve true se tratou.
   */
  function pull(n, d = null) {
    const v = getView();
    if (!v) return false;
    if (!d && n > 0 && !v.atMax) return false;                 // pelos botões: primeiro o céu abre até o campo máximo
    const L = Math.hypot(...goal);
    if (n < 0 && L <= DIST + 1e-4) return false;               // já na órbita: a roda volta a dar zoom no céu
    const dir = d || unit(goal), h = L - 1;
    const s = n > 0 ? h * (Math.pow(1.35, n) - 1) : -h * (1 - Math.pow(1.35, n));
    let g = goal.map((x, i) => x + s * dir[i]);                // Terra relativa à câmera: recuar a câmera = Terra mais longe
    const Lg = Math.hypot(...g);
    if (Lg < DIST) g = g.map((x) => (x / Lg) * DIST);          // não desce abaixo de 700 km
    if (Lg > DIST_MAX) g = g.map((x) => (x / Lg) * DIST_MAX);
    goal = g;
    return true;
  }
  // roda do mouse: sobre a Terra, a câmera recua ou avança na linha do ponto sob o cursor;
  // sobre o céu, é o zoom normal do panorama
  wheelEl?.addEventListener('wheel', (e) => {
    const d = e.deltaY && rayHit(e.clientX, e.clientY);
    if (d && pull(Math.sign(e.deltaY) * Math.min(3, Math.max(1, Math.abs(e.deltaY) / 100)), d)) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, passive: false });

  let raf = 0, last = null, lastView = null;
  const t0 = performance.now(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  function frame() {
    raf = requestAnimationFrame(frame);
    const v = getView();
    const a = v ? Math.max(0, Math.min(1, (v.fov - 22) / 13)) : 0;   // a Terra some ao aproximar (abaixo de ~22°); a Lua fica
    host.style.opacity = v ? '1' : '0';
    lastView = v;
    if (!v) { renderer.clear(); return; }
    U.alpha.value = a;
    const real = sunVec(), mo = moonNow();
    U.sunR.value.set(...real); U.moon.value.set(...mo.pos);
    pos = pos.map((x, i) => x + (goal[i] - x) * (still ? 1 : 0.14));
    dist = Math.hypot(...pos);
    U.dist.value = dist; U.D.value.set(...pos.map((x) => x / dist));
    const sun = sunLight();
    U.C.value.set(...v.C); U.E.value.set(...v.E); U.N.value.set(...v.N);
    U.ctr.value.set(v.cx, v.cy); U.k.value = v.k; U.roll.value = v.roll;
    U.sun.value.set(...sun);
    // telescópio para o zênite, longe da Terra
    satG.quaternion.setFromUnitVectors(Y, ZEN);

    // referencial do céu na tela (mesmo do Aladin): centro para dentro, norte para cima, leste à esquerda
    roll.rotation.z = -v.roll;
    cel.rotation.set(v.decC * D2R, -Math.PI / 2 - v.raC * D2R, 0);
    key.position.copy(U.sun.value).applyQuaternion(cel.getWorldQuaternion(q)).multiplyScalar(10);
    // satélite: posição e tamanho seguem o céu; balança devagar sobre o próprio eixo
    // o satélite fica na órbita; quando a câmera sai de lá, ele fica para trás
    const rel = SAT_VEC.map((x, i) => SAT_GAP * x + pos[i] - P0[i]), rl = Math.hypot(...rel);
    const ang = SAT_SIZE * SAT_GAP / rl, sd = toRaDec(rel);
    const at = v.toScreen(sd.ra, sd.dec);
    const px = v.k * 4 * Math.tan(ang / 4);                     // tamanho em px na escala estereográfica
    satG.visible = !!at && px > 3 && a > 0.3;
    last = { at, px, sd, dist };
    if (satG.visible) {
      sat.scale.setScalar(px / 3.2);
      const wp = new THREE.Vector3(at[0] - W / 2, H / 2 - at[1], 0);
      cel.updateMatrixWorld(true);
      satG.position.copy(cel.worldToLocal(wp));
      sat.rotation.y = still ? 0.6 : 0.6 + Math.sin((performance.now() - t0) / 6000) * 0.5;
    }
    renderer.clear(); renderer.render(earthScene, camera); renderer.clearDepth(); renderer.render(scene, camera);
  }
  frame();

  /** Direção no céu do ponto (px da tela) se ele cai sobre a Terra; senão null. */
  function rayHit(x, y) {
    const v = getView();
    if (!v || v.fov < 28) return null;
    const dx = x - v.cx, dy = y - v.cy;
    const nS = [Math.sin(v.roll), -Math.cos(v.roll)], eS = [-Math.cos(v.roll), -Math.sin(v.roll)];
    const u = dx * eS[0] + dy * eS[1], w = dx * nS[0] + dy * nS[1], r = Math.hypot(u, w) / v.k, th = 2 * Math.atan(r / 2);
    const tl = Math.hypot(u, w) || 1, t = [0, 1, 2].map((i) => (u * v.E[i] + w * v.N[i]) / tl);
    const d = [0, 1, 2].map((i) => Math.cos(th) * v.C[i] + Math.sin(th) * t[i]);
    const b = dot(d, pos);
    return b > 0 && b * b - (dist * dist - 1) > 0 ? d : null;
  }
  /** Diz se o ponto (px da tela) cai sobre a Terra, para o clique não escolher o céu escondido atrás dela. */
  const hits = (x, y) => !!rayHit(x, y);

  return {
    hits, pull,
    /** Volta para a órbita, ao lado do satélite. */
    home() { goal = [...P0]; },
    /** Altura atual da câmera, em km. */
    altitudeKm: () => (dist - 1) * R_KM,
    /** Onde a Lua está agora, vista daqui (com a paralaxe de estar fora do centro da Terra). */
    moonSky() { const m = moonNow().pos; return toRaDec(pos.map((x, i) => x + m[i])); },
    /** Estado de agora para a miniatura da Terra: câmera e satélite em relação ao centro da Terra, e a vista. */
    snapshot(v = lastView) {
      if (!v) return null;
      return { cam: pos.map((x) => -x), sat: SAT_VEC.map((x, i) => SAT_GAP * x - P0[i]), C: v.C, N: v.N, E: v.E, roll: v.roll, fov: v.fov, sun: [...sunLight()] };
    },
    /** Para depuração: último quadro do satélite. */
    state: () => last,
    stop() {
      cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose(); }); });
      day.dispose(); night.dispose(); U.hi.value.dispose(); U.moonMap.value.dispose(); env.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
export { vec, moonNow, GEO };
