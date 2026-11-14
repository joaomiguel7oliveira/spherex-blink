"""Resolução de nomes (Sesame/SIMBAD) e catálogos de objetos conhecidos (Gaia DR3, CatWISE2020).

As posições dos catálogos são levadas até a época dos dados do SPHEREx usando o
movimento próprio. Sem isso, uma estrela rápida apareceria longe do círculo que a marca.
"""
from __future__ import annotations

import json
import math
import re

import numpy as np
import requests

from . import config as C

REF_EPOCH = 2026.0   # época para a qual as posições são propagadas
HIGH_PM_MAS = 150.0  # acima disso tratamos como objeto de alto movimento próprio
VIZIER_SERVERS = ["vizier.cds.unistra.fr", "vizier.cfa.harvard.edu", "vizier.idia.ac.za"]


def propagate(ra, dec, pmra_mas, pmde_mas, from_epoch, to_epoch=REF_EPOCH):
    dt = to_epoch - from_epoch
    dec2 = dec + pmde_mas * dt / 3.6e6
    ra2 = ra + pmra_mas * dt / 3.6e6 / math.cos(math.radians(dec))
    return ra2 % 360, dec2


def resolve_name(name: str) -> dict:
    """Consulta o Sesame (CDS). As coordenadas do SIMBAD estão na época J2000."""
    r = requests.get(C.SESAME_URL + requests.utils.quote(name), timeout=40,
                     headers={"User-Agent": "spherex-blink-prototype/0.1"})
    r.raise_for_status()
    xml = r.text

    def tag(t):
        m = re.search(rf"<{t}>([^<]+)</{t}>", xml)
        return m.group(1).strip() if m else None

    if tag("jradeg") is None:
        raise LookupError(f"Objeto não encontrado: {name}")
    ra, dec = float(tag("jradeg")), float(tag("jdedeg"))
    pmra, pmde = float(tag("pmRA") or 0), float(tag("pmDE") or 0)
    out = {
        "query": name, "name": tag("oname") or name, "otype": tag("otype"),
        "ra_j2000": ra, "dec_j2000": dec, "pmra": pmra, "pmde": pmde,
        "ra": ra, "dec": dec, "epoch": 2000.0, "source": "SIMBAD via Sesame (CDS)",
    }
    if math.hypot(pmra, pmde) > 20:
        out["ra"], out["dec"] = propagate(ra, dec, pmra, pmde, 2000.0)
        out["epoch"] = REF_EPOCH
    out["ra"], out["dec"] = round(out["ra"], 6), round(out["dec"], 6)
    return out


_VIZIER = {
    "gaia": {"table": "I/355/gaiadr3", "epoch": 2016.0, "pm_factor": 1.0,
             "cols": ["RA_ICRS", "DE_ICRS", "Source", "Gmag", "pmRA", "pmDE", "Plx"],
             "query_cols": ["RA_ICRS", "DE_ICRS", "Source", "Gmag", "pmRA", "pmDE", "Plx"],
             "mag": "Gmag", "id": "Source", "filters": {"Gmag": "<20"}},
    "catwise": {"table": "II/365/catwise", "epoch": 2015.4, "pm_factor": 1000.0,  # arcsec/ano -> mas/ano
                "cols": ["RA_ICRS", "DE_ICRS", "Name", "W1mproPM", "W2mproPM", "pmRA", "pmDE", "e_pmRA", "e_pmDE", "MJD"],
                "query_cols": ["**"],  # nos espelhos, o CatWISE só responde pedindo todas as colunas
                "mag": "W2mproPM", "id": "Name", "filters": {}},
}


def catalog(ra: float, dec: float, fov: float, cat: str) -> dict:
    """Fontes conhecidas na região, já propagadas para REF_EPOCH. Resultado em cache."""
    if cat not in _VIZIER:
        raise KeyError(cat)
    path = C.CATALOG_DIR / f"{cat}_r{ra:.4f}_d{dec:+.4f}_f{fov:.1f}.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    from astroquery.vizier import Vizier
    from astropy.coordinates import SkyCoord
    import astropy.units as u

    spec = _VIZIER[cat]
    radius = fov / 2 * 1.45  # círculo que cobre o quadrado, com folga para objetos rápidos
    res, err = None, None
    for server in VIZIER_SERVERS:  # o CDS tem espelhos; se um cair ou vier vazio, tenta o próximo
        try:
            v = Vizier(columns=spec["query_cols"], column_filters=spec["filters"], row_limit=8000,
                       vizier_server=server, timeout=60)
            got = v.query_region(SkyCoord(ra * u.deg, dec * u.deg), radius=radius * u.arcmin,
                                 catalog=spec["table"], cache=False)
            if len(got) and len(got[0]):
                res = got
                break
            res = res or got
        except Exception as e:  # noqa: BLE001
            err = e
    if res is None:
        raise RuntimeError(f"nenhum espelho do VizieR respondeu ({err})")
    rows = []
    if len(res):
        t = res[0]

        def num(row, col):
            val = row[col] if col in t.colnames else None
            return None if val is None or np.ma.is_masked(val) or not np.isfinite(float(val)) else float(val)

        for row in t:
            pmra = (num(row, "pmRA") or 0.0) * spec["pm_factor"]
            pmde = (num(row, "pmDE") or 0.0) * spec["pm_factor"]
            sig = None
            if cat == "catwise":  # PMs do CatWISE são ruidosos: guardamos a significância
                e = math.hypot(num(row, "e_pmRA") or 9, num(row, "e_pmDE") or 9) * 1000
                sig = round(math.hypot(pmra, pmde) / e, 1) if e else None
            mjd = num(row, "MJD")  # o CatWISE informa a época média de cada fonte
            epoch = 2000.0 + (mjd - 51544.5) / 365.25 if mjd else spec["epoch"]
            r2, d2 = propagate(float(row["RA_ICRS"]), float(row["DE_ICRS"]), pmra, pmde, epoch)
            mag = num(row, spec["mag"])
            rows.append({"ra": round(r2, 6), "dec": round(d2, 6), "id": str(row[spec["id"]]),
                         "mag": None if mag is None else round(mag, 2),
                         "pm": round(math.hypot(pmra, pmde), 1), "pm_sig": sig})
    out = {"cat": cat, "table": spec["table"], "source": "VizieR (CDS)", "epoch": REF_EPOCH,
           "ra": ra, "dec": dec, "fov": fov, "rows": rows}
    path.write_text(json.dumps(out), "utf-8")
    return out


def bright_stars(vmax: float = 5.5) -> dict:
    """Estrelas visíveis a olho nu (Yale Bright Star Catalogue, V/50), para o panorama do céu."""
    path = C.DATA_DIR / "sky.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    from astroquery.vizier import Vizier

    res, err = None, None
    for server in VIZIER_SERVERS:
        try:
            v = Vizier(columns=["_RAJ2000", "_DEJ2000", "Vmag", "Name"], row_limit=12000, vizier_server=server,
                       timeout=60)
            got = v.query_constraints(catalog="V/50/catalog", Vmag=f"<{vmax}", cache=False)
            if len(got) and len(got[0]):
                res = got[0]
                break
        except Exception as e:  # noqa: BLE001
            err = e
    if res is None:
        raise RuntimeError(f"nenhum espelho do VizieR respondeu ({err})")
    stars = [[round(float(r["_RAJ2000"]), 3), round(float(r["_DEJ2000"]), 3), round(float(r["Vmag"]), 2)]
             for r in res if not np.ma.is_masked(r["_RAJ2000"])]
    out = {"source": "Yale Bright Star Catalogue (V/50) via VizieR", "vmax": vmax, "stars": stars}
    path.write_text(json.dumps(out), "utf-8")
    return out
