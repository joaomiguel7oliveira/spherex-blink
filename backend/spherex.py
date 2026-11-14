"""Acesso aos dados do SPHEREx.

* Índice de exposições: serviço SIA2 do IRSA (uma linha por imagem espectral nível 2).
* Pixels: espelho público do IRSA na AWS, lido por faixas de bytes (só o pedaço
  necessário de cada arquivo de 65 MB). Se falhar, usa o serviço de recortes do
  IRSA (`?center=RA,DEC&size=...` no fim da URL da imagem).
"""
from __future__ import annotations

import csv
import io
import json
import time
import warnings

import numpy as np
import requests
from astropy import log as astropy_log
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning
import astropy.units as u

from . import config as C

astropy_log.setLevel("ERROR")
warnings.simplefilter("ignore", FITSFixedWarning)
warnings.filterwarnings("ignore", message=".*SIP.*")

UA = {"User-Agent": "spherex-blink-prototype/0.1"}


class DataUnavailable(RuntimeError):
    pass


# --------------------------------------------------------------------------- índice
def _index_path(ra: float, dec: float):
    return C.INDEX_DIR / f"r{ra:.3f}_d{dec:+.3f}.json"


def _sia_query(collection: str, ra: float, dec: float, tries: int = 8) -> list[dict]:
    params = {"COLLECTION": collection, "POS": f"circle {ra} {dec} 0.0003", "RESPONSEFORMAT": "CSV"}
    last = "sem resposta"
    for i in range(tries):
        try:
            r = requests.get(C.SIA_URL, params=params, headers=UA, timeout=120)
            if r.status_code == 200 and r.text.startswith("s_ra"):
                return list(csv.DictReader(io.StringIO(r.text)))
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # rede instável: tenta de novo
            last = type(e).__name__
        time.sleep(1.5 + i)
    raise DataUnavailable(f"SIA do IRSA indisponível para {collection} ({last})")


def list_exposures(ra: float, dec: float, refresh: bool = False) -> list[dict]:
    """Todas as exposições (todas as bandas) cujo campo contém o ponto, por data."""
    path = _index_path(ra, dec)
    cached = None
    if path.exists():
        cached = json.loads(path.read_text("utf-8"))
        fresh = time.time() - cached["fetched"] < C.INDEX_TTL_HOURS * 3600
        if fresh and not refresh:
            return cached["rows"]
    seen: dict[tuple, dict] = {}
    try:
        for coll in C.SIA_COLLECTIONS:
            for r in _sia_query(coll, ra, dec):
                band = r["energy_bandpassname"].replace("SPHEREx-", "")
                key = (r["obs_id"], band)
                if key in seen:  # mesma exposição em coleção de menor prioridade
                    continue
                seen[key] = {
                    "obsid": r["obs_id"], "band": band, "mjd": float(r["t_min"]),
                    "url": r["access_url"], "collection": r["obs_collection"],
                    "release": r.get("obs_release_date", ""),
                }
    except DataUnavailable:
        if cached:  # índice antigo é melhor que nenhum
            return cached["rows"]
        raise
    rows = sorted(seen.values(), key=lambda r: r["mjd"])
    path.write_text(json.dumps({"fetched": time.time(), "ra": ra, "dec": dec, "rows": rows}), "utf-8")
    return rows


# --------------------------------------------------------------------------- pixels
def _extract(hdul, coord: SkyCoord, half: int, probe: SkyCoord):
    hdr = hdul["IMAGE"].header
    w = WCS(hdr)
    x, y = (float(v) for v in w.world_to_pixel(coord))
    ny, nx = hdr["NAXIS2"], hdr["NAXIS1"]
    xi, yi = int(round(x)), int(round(y))
    x0, x1 = max(0, xi - half), min(nx, xi + half + 1)
    y0, y1 = max(0, yi - half), min(ny, yi + half + 1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    sl = (slice(y0, y1), slice(x0, x1))
    img = np.asarray(hdul["IMAGE"].section[sl], dtype=np.float32)
    flags = np.asarray(hdul["FLAGS"].section[sl]).astype(np.int32)
    zodi = np.asarray(hdul["ZODI"].section[sl], dtype=np.float32)
    # WCS espectral (tabela WCS-WAVE): comprimento de onda de cada pixel do detector.
    sw = WCS(hdr, fobj=hdul, key="W")
    sw.sip = None
    px, py = w.world_to_pixel(probe)
    wl, bw = sw.pixel_to_world(px, py)
    return {
        "img": img, "flags": flags, "zodi": zodi, "wcs": w[sl],
        "wl": np.asarray(wl.to_value(u.um), dtype=float),
        "bw": float(np.atleast_1d(bw.to_value(u.um))[0]),
        "mjd": float(hdr.get("MJD-AVG") or hdr.get("MJD-OBS")),
        "psf_fwhm": float(hdr.get("PSF_FWHM") or 0),
    }


def fetch_exposure(row: dict, coord: SkyCoord, half: int, probe: SkyCoord):
    """Lê o pedaço de uma exposição em torno de `coord`. Retorna None se não cobrir."""
    url = row["url"]
    err = None
    if url.startswith(C.IRSA_DATA_PREFIX):
        s3 = C.S3_DATA_PREFIX + url[len(C.IRSA_DATA_PREFIX):]
        for attempt in range(2):
            try:
                with fits.open(s3, use_fsspec=True, lazy_load_hdus=True,
                               fsspec_kwargs={"block_size": 1 << 19, "cache_type": "blockcache"}) as h:
                    out = _extract(h, coord, half, probe)
                if out is not None:
                    out["via"] = "aws"
                return out
            except Exception as e:  # noqa: BLE001 - qualquer falha de rede cai no plano B
                err = e
                time.sleep(1 + attempt)
    size_deg = (2 * half + 1) * C.NATIVE_PIXSCALE / 3600
    for attempt in range(3):
        try:
            r = requests.get(url, params={"center": f"{coord.ra.deg},{coord.dec.deg}d", "size": f"{size_deg:.5f}"},
                             headers=UA, timeout=180)
            if r.status_code == 200:
                with fits.open(io.BytesIO(r.content)) as h:
                    out = _extract(h, coord, half, probe)
                if out is not None:
                    out["via"] = "irsa"
                return out
            err = RuntimeError(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(2 + 2 * attempt)
    raise DataUnavailable(f"falha ao ler {row['obsid']} {row['band']}: {err}")


def flag_names(value: int) -> list[str]:
    return [name for bit, name in C.FLAG_BITS.items() if value & (1 << bit)]
