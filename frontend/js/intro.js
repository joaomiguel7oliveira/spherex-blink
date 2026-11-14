// Tela inicial: o SPHEREx em órbita com a Terra embaixo, em 3D (three.js).
// A Terra usa as imagens Blue Marble e Black Marble da NASA (domínio público, servidas pelo pacote
// three-globe no jsDelivr). O satélite é uma ilustração aproximada, montada aqui com formas simples:
// corpo hexagonal, três escudos cônicos aninhados com o telescópio dentro, e um painel solar.
// As estrelas do fundo são as do Yale BSC (data/sky.json), nas posições reais.
export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export const IMG = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/';
const D2R = Math.PI / 180;

export const EARTH_VS = `
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const EARTH_FS = `
uniform sampler2D day; uniform sampler2D night; uniform vec3 sun;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  float d = dot(n, sun);
  vec3 dayC = texture2D(day, vUv).rgb;
  vec3 nightC = texture2D(night, vUv).rgb;
  float k = smoothstep(-0.1, 0.22, d);
  vec3 col = mix(nightC * vec3(1.0, 0.8, 0.55) * 2.2, dayC * (0.06 + 1.35 * max(d, 0.0)), k);
  vec3 v = normalize(cameraPosition - vP);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  col += vec3(0.32, 0.58, 1.0) * fr * (0.05 + 1.1 * smoothstep(-0.25, 0.6, d));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export const GLOW_VS = `
varying vec3 vN; varying vec3 vW;
void main() { vN = normalize(normalMatrix * normal); vW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const GLOW_FS = `
uniform vec3 sun; varying vec3 vN; varying vec3 vW;
void main() {
  float i = pow(clamp(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.2);
  float lit = 0.12 + 0.88 * smoothstep(-0.35, 0.5, dot(vW, sun));
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * i * lit * 1.6, 1.0);
}`;
const STAR_VS = `
attribute float size; attribute vec3 tint; varying vec3 vC;
void main() { vC = tint; gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STAR_FS = `
varying vec3 vC;
void main() { vec2 p = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(p)); gl_FragColor = vec4(vC * a, 1.0); }`;

/** Painel solar: células azul-escuras numa grade fina. */
function cellTexture(THREE) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1530'; g.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    const grd = g.createLinearGradient(x * 32, y * 32, x * 32 + 32, y * 32 + 32);
    grd.addColorStop(0, '#1a2d63'); grd.addColorStop(1, '#0e1a3d');
    g.fillStyle = grd; g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Modelo simplificado do SPHEREx. O eixo y do grupo é a direção para onde o telescópio olha. */
export function buildSpherex(THREE, envMap) {
  const sat = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({ color: 0xe8edf5, metalness: 0.82, roughness: 0.22, side: THREE.DoubleSide, envMap, envMapIntensity: 1.25 });
  const silverIn = new THREE.MeshStandardMaterial({ color: 0xc8d1df, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide, envMap, envMapIntensity: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a43a, metalness: 1, roughness: 0.38, envMap, envMapIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, metalness: 0.4, roughness: 0.6, envMap });
  const black = new THREE.MeshBasicMaterial({ color: 0x020203 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ecf2, metalness: 0.1, roughness: 0.55, envMap, envMapIntensity: 0.6 });

  // corpo (ônibus) hexagonal, com manta térmica dourada
  const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.72, 6), gold);
  bus.position.y = -0.36; sat.add(bus);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.05, 6), white);
  deck.position.y = 0.02; sat.add(deck);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.12, 6), dark);
  under.position.y = -0.78; sat.add(under);

  // três escudos cônicos aninhados, abertos para o céu
  const shields = [[1.62, 0.78, 1.55], [1.42, 0.68, 1.42], [1.22, 0.58, 1.3]];
  shields.forEach(([top, bot, h], i) => {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bot, h, 96, 1, true), i ? silverIn : silver);
    cone.position.y = 0.06 + h / 2 + i * 0.05; sat.add(cone);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(top, 0.016, 8, 128), white);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.06 + h + i * 0.05; sat.add(rim);
  });
  // escoras entre os escudos
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6), white);
    s.position.set(Math.cos(a) * 0.95, 0.75, Math.sin(a) * 0.95);
    s.lookAt(Math.cos(a) * 1.5, 1.6, Math.sin(a) * 1.5); s.rotateX(Math.PI / 2);
    sat.add(s);
  }
  // telescópio no fundo do funil
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.62, 48), dark);
  tube.position.y = 0.38; sat.add(tube);
  const ap = new THREE.Mesh(new THREE.CircleGeometry(0.27, 48), black);
  ap.rotation.x = -Math.PI / 2; ap.position.y = 0.695; sat.add(ap);

  // painel solar fixo de um lado do corpo
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), white);
  arm.rotation.z = Math.PI / 2; arm.position.set(0.85, -0.4, 0); sat.add(arm);
  const cells = new THREE.MeshStandardMaterial({ map: cellTexture(THREE), metalness: 0.45, roughness: 0.32, envMap, envMapIntensity: 0.9 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, 2.0), [cells, dark, white, white, white, white]);
  panel.position.set(1.12, -0.4, 0); panel.rotation.z = 0.32; sat.add(panel);

  // antena pequena embaixo
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), white);
  dish.rotation.x = Math.PI; dish.position.set(-0.25, -0.86, 0.15); sat.add(dish);
  return sat;
}

/** Estrelas reais do BSC mais um véu de estrelas fracas aleatórias. */
async function buildStars(THREE) {
  let real = [];
  try { real = (await (await fetch('data/sky.json')).json()).stars || []; } catch { /* segue só com as fracas */ }
  const pos = [], size = [], tint = [], R = 800, dpr = Math.min(devicePixelRatio || 1, 2);
  const push = (ra, dec, mag, t) => {
    const c = Math.cos(dec * D2R);
    pos.push(R * c * Math.cos(ra * D2R), R * Math.sin(dec * D2R), -R * c * Math.sin(ra * D2R));
    size.push(Math.max(1.2, (6.4 - mag) * 1.15) * dpr);
    const b = Math.min(1, 0.25 + (6.5 - mag) / 6);
    tint.push(b * t[0], b * t[1], b * t[2]);
  };
  const tints = [[0.8, 0.88, 1], [1, 1, 1], [1, 0.92, 0.8], [1, 0.82, 0.68]];
  real.forEach(([ra, dec, mag], i) => push(ra, dec, mag, tints[i % 4]));
  for (let i = 0; i < 2500; i++) push(Math.random() * 360, Math.asin(Math.random() * 2 - 1) / D2R, 5.6 + Math.random() * 1.2, tints[i % 4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
  return new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
}

/** Monta a cena em `el` e devolve { stop } para liberar a GPU quando a tela sair. */
export async function startIntro(el) {
  const THREE = await import(THREE_URL);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010207);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
  const sun = new THREE.Vector3(-1, 0.2, -0.2).normalize();

  // Terra
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const load = (f) => new Promise((res, rej) => loader.load(IMG + f, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
  const [day, night] = await Promise.all([load('earth-blue-marble.jpg'), load('earth-night.jpg')]);
  const R = 14;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), new THREE.ShaderMaterial({ uniforms: { day: { value: day }, night: { value: night }, sun: { value: sun } }, vertexShader: EARTH_VS, fragmentShader: EARTH_FS }));
  earth.rotation.set(1.05, -1.2, 0.25);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 64), new THREE.ShaderMaterial({ uniforms: { sun: { value: sun } }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  const planet = new THREE.Group(); planet.add(earth, glow); scene.add(planet);
  scene.add(await buildStars(THREE));

  // luz do Sol, brilho azul da Terra vindo de baixo
  const key = new THREE.DirectionalLight(0xfff4e6, 3.2); key.position.copy(sun).multiplyScalar(50); scene.add(key);
  scene.add(new THREE.HemisphereLight(0x0a0f1e, 0x3a6ad0, 0.9));
  scene.add(new THREE.AmbientLight(0x404858, 0.25));

  // reflexos: um cubo de ambiente com a Terra e as estrelas, feito uma vez
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.1, 2000, cubeRT);
  const sat = buildSpherex(THREE, cubeRT.texture);
  const rig = new THREE.Group(); rig.add(sat); scene.add(rig);

  let wide = true;
  const layout = () => {
    const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    wide = w / h > 0.9;
    // tela larga: satélite à direita, texto à esquerda; tela estreita: satélite em cima
    if (wide) { planet.position.set(5, -18.5, -6); rig.position.set(4.6, 1.15, 4); camera.fov = 32; }
    else { planet.position.set(1.5, -24, -9); rig.position.set(0.2, 3.1, 2); camera.fov = 44; }
    camera.updateProjectionMatrix();
    rig.visible = false; cubeCam.position.copy(rig.position); cubeCam.update(renderer, scene); rig.visible = true;
  };
  layout();
  const ro = new ResizeObserver(() => { layout(); if (still) draw(0); });
  ro.observe(el);

  // a câmera acompanha o ponteiro de leve
  let px = 0, py = 0;
  const onMove = (e) => { px = (e.clientX / innerWidth) * 2 - 1; py = (e.clientY / innerHeight) * 2 - 1; };
  addEventListener('pointermove', onMove);

  const look = new THREE.Vector3(0, 0, 0);
  let raf = 0, t0 = performance.now(), cx = 0, cy = 0;
  function draw(t) {
    const s = t / 1000;
    cx += (px * 1.4 - cx) * 0.04; cy += (-py * 0.8 - cy) * 0.04;
    camera.position.set(cx, 0.6 + cy, 24); camera.lookAt(look);
    // o telescópio aponta para longe da Terra, inclinado para a câmera; gira devagar sobre o próprio eixo
    rig.rotation.set(0.42 + Math.sin(s * 0.3) * 0.04, 0, wide ? -0.28 : -0.1);
    sat.rotation.y = -0.75 + Math.sin(s * 0.12) * 0.55;   // balança devagar e mantém o painel à vista
    rig.position.y += (wide ? 1.15 : 3.1) + Math.sin(s * 0.6) * 0.06 - rig.position.y;
    earth.rotation.y = (earth.userData.y0 ??= earth.rotation.y) + s * 0.006;
    renderer.render(scene, camera);
  }
  if (still) draw(0);
  else { const loop = (t) => { draw(t - t0); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
  el.classList.add('ready');

  return {
    stop() {
      cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('pointermove', onMove);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose(); }); });
      day.dispose(); night.dispose(); cubeRT.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
