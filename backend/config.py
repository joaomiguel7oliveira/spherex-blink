"""Configuração central. Para incorporar um novo lançamento de dados do SPHEREx,
basta acrescentar a coleção em SIA_COLLECTIONS e rodar `python -m backend.refresh`."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"          # cubos prontos (servidos como arquivos estáticos)
INDEX_DIR = DATA_DIR / "index"          # respostas do SIA (lista de exposições)
CATALOG_DIR = DATA_DIR / "catalogs"     # Gaia / CatWISE por região
CANDIDATE_DIR = DATA_DIR / "candidates" # fila de candidatos
VOTES_DB = DATA_DIR / "votes.sqlite"
FRONTEND_DIR = ROOT / "frontend"

# --- Fontes de dados (ver README para as referências) -----------------------
SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
# Ordem = prioridade quando a mesma exposição existe em mais de uma coleção.
SIA_COLLECTIONS = ["spherex_dr1", "spherex_qr3"]
IRSA_DATA_PREFIX = "https://irsa.ipac.caltech.edu/ibe/data/spherex/"
S3_DATA_PREFIX = "https://nasa-irsa-spherex.s3.amazonaws.com/"
SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?"

BANDS = ["D1", "D2", "D3", "D4", "D5", "D6"]
# Faixa aproximada de cada detector em micrômetros (valores em_min/em_max do SIA).
BAND_RANGE_UM = {
    "D1": (0.74, 1.12), "D2": (1.10, 1.65), "D3": (1.63, 2.43),
    "D4": (2.40, 3.84), "D5": (3.81, 4.43), "D6": (4.41, 5.01),
}

NATIVE_PIXSCALE = 6.15          # segundos de arco por pixel do detector
MIN_PIXSCALE = 3.075            # amostragem da grade comum (metade do pixel nativo)
MAX_GRID = 201                  # lado máximo da grade comum, em pixels
FOV_MIN, FOV_MAX, FOV_DEFAULT = 2.0, 30.0, 6.0   # minutos de arco
EPOCH_GAP_DAYS = 45             # intervalo que separa duas "épocas" (passagens do levantamento)
FETCH_WORKERS = 10
INDEX_TTL_HOURS = 24

# Bits do plano FLAGS (tutorial "SPHEREx intro" do IRSA).
FLAG_BITS = {
    0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 6: "NONFUNC", 7: "DICHROIC",
    9: "MISSING_DATA", 10: "HOT", 11: "COLD", 12: "FULLSAMPLE", 14: "PHANMISS",
    15: "NONLINEAR", 17: "PERSIST", 19: "OUTLIER", 20: "CROSSTALK", 21: "SOURCE",
    22: "GHOST", 23: "GHOST_FPA", 24: "GHOST_EXT", 25: "STREAK", 26: "BLOOM",
    27: "SNOWBALL", 28: "HALO",
}
# Pixels com estes bits são descartados (viram NaN) antes da reprojeção.
BAD_BITS = [0, 1, 2, 6, 7, 9, 10, 11, 15]
BAD_MASK = sum(1 << b for b in BAD_BITS)

for _d in (CACHE_DIR, INDEX_DIR, CATALOG_DIR, CANDIDATE_DIR):
    _d.mkdir(parents=True, exist_ok=True)
