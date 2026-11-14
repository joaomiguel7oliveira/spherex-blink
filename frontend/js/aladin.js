// Carrega o Aladin Lite v3 (CDS) uma única vez. Versão fixa do pacote npm: o endereço
// "latest" do CDS saiu do ar e versões novas podem mudar a API.
const URL_ALADIN = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';

// Levantamentos HiPS espelhados no IRSA (NASA); a ESA tem um espelho do DSS de reserva.
export const SURVEYS = {
  dss: { url: 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', backup: 'https://skies.esac.esa.int/DSSColor', name: 'Visível (DSS)' },
  twomass: { url: 'https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color', name: 'Infravermelho (2MASS)' },
  // céu inteiro do próprio SPHEREx (DR1): 102 quadros, um por banda (1–6) e canal (1–17)
  spherex: { url: 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube', name: 'SPHEREx DR1', cube: true },
};

/**
 * Comprimento de onda de cada quadro do cubo SPHEREx, lido do arquivo `properties` do HiPS
 * (assim um lançamento novo do IRSA não exige mudar o código). Quadro i = 17·(banda−1) + (canal−1).
 * Os quadros 49 e 50 (contando do zero) são os canais do dicroico e vêm em branco.
 */
let spherexInfo = null;
export function spherexChannels() {
  spherexInfo ||= fetch(`${SURVEYS.spherex.url}/properties`).then((r) => r.text()).then((t) => {
    const m = t.match(/^data_cube_crval3_arr\s*=\s*(.+)$/m);
    const wl = m ? m[1].trim().split(/\s+/).map(Number) : [];
    const date = (t.match(/^hips_release_date\s*=\s*(\S+)/m) || [])[1] || null;
    return { date, channels: wl.map((um, i) => ({ i, um, band: Math.floor(i / 17) + 1, ch: (i % 17) + 1, blank: i === 49 || i === 50 })) };
  });
  return spherexInfo;
}

let pending = null;
export function loadAladin() {
  pending ||= import(URL_ALADIN).then(async (m) => { const A = m.default; await A.init; return A; });
  return pending;
}

/** Opções que escondem toda a interface própria do Aladin (a nossa fica por cima). */
export const BARE = {
  showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false, showGotoControl: false,
  showFrame: false, showCooLocation: false, showProjectionControl: false, showSettingsControl: false, showShareControl: false,
  showSimbadPointerControl: false, showCooGridControl: false, showStatusBar: false, showContextMenu: false, showFov: false,
  cooFrame: 'ICRSd',
};
