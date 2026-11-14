"""Fila de candidatos: a máquina filtra, o humano decide.

Para uma região pequena:
  1. empilha as exposições de cada época (mediana) e subtrai uma época da outra;
  2. procura fontes positivas e negativas na diferença (photutils);
  3. junta pares claro-escuro vizinhos ("dipolos": algo mudou de lugar);
  4. descarta o que cai em cima de uma fonte conhecida do Gaia DR3 / CatWISE2020
     (posições propagadas pelo movimento próprio) e o que parece defeito;
  5. grava o que sobrou em data/candidates/<região>.json.

  python -m backend.candidates
"""
from __future__ import annotations

import json
import sys
import math
import time
import warnings

import numpy as np
from astropy.convolution import Gaussian2DKernel, convolve
from astropy.time import Time
from photutils.segmentation import detect_sources

from . import catalogs, config as C, pipeline

warnings.simplefilter("ignore")

# Regiões pequenas onde a fila roda (ids de data/targets.json). Não é o céu inteiro.
REGIONS = [
    {"target": "wise0855", "fov": 20.0, "bands": ["D6", "D5", "D2"]},
    {"target": "epsindb", "fov": 6.0, "bands": ["D2", "D6"]},
    {"target": "barnard", "fov": 6.0, "bands": ["D2", "D4"]},
    {"target": "rwaur", "fov": 6.0, "bands": ["D2"]},
]
BLOB_SIGMA = 3.5      # cada mancha precisa passar disto na diferença suavizada
THRESHOLD = 6.0       # significância final: par claro-escuro combinado, ou mancha isolada
PAIR_RADIUS = 30.0    # segundos de arco: distância máxima entre o lado claro e o escuro de um dipolo
MATCH_RADIUS = 7.0    # segundos de arco: raio para dizer "é uma fonte conhecida"
MIN_EPOCH_FRAMES = 5
RESIDUAL_FRACTION = 0.25
MAX_QUEUE = 24
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def epochs_of(mjds, gap=45.0, span=60.0):
    """Mesma regra do navegador (frontend/js/science.js: computeEpochs)."""
    blocks, cur = [], None
    for i, m in enumerate(mjds):
        if cur is None or m - mjds[i - 1] > gap:
            cur = []
            blocks.append(cur)
        cur.append(i)
    out = []
    for blk in blocks:
        t0, length = mjds[blk[0]], mjds[blk[-1]] - mjds[blk[0]]
        parts = round(length / span) if length > 1.5 * span else 1
        groups = [[] for _ in range(parts)]
        for i in blk:
            groups[min(parts - 1, int((mjds[i] - t0) / (length or 1) * parts))].append(i)
        out += [g for g in groups if g]
    return out


def month_label(mjd_min, mjd_max):
    a, b = (Time(m, format="mjd").utc.datetime for m in (mjd_min, mjd_max))
    la, lb = f"{MESES[a.month - 1]} {a.year}", f"{MESES[b.month - 1]} {b.year}"
    return la if la == lb else f"{la[:3]}–{lb}"


def _blobs(snr_map, sign, npix):
    seg = detect_sources(sign * snr_map, BLOB_SIGMA, npixels=npix)
    out = []
    if seg is None:
        return out
    for lab in seg.labels:
        ys, xs = np.nonzero(seg.data == lab)
        w = sign * snr_map[ys, xs]
        out.append({"x": float((xs * w).sum() / w.sum()), "y": float((ys * w).sum() / w.sum()),
                    "snr": float(w.max()), "peak": float(w.max()), "sign": sign, "npix": int(len(xs))})
    return out


def detect_band(ra, dec, fov, band):
    key = pipeline.cube_key(ra, dec, fov, band)
    if pipeline.load_meta(key) is None:
        print(f"   montando cubo {band}…", flush=True)
        pipeline.build_cube(ra, dec, fov, band)
    meta, cube = pipeline.load_cube(key)
    n, scale = meta["size"], meta["pixscale"]
    mjds = [f["mjd"] for f in meta["frames"]]
    eps = [e for e in epochs_of(mjds) if len(e) >= MIN_EPOCH_FRAMES]
    if len(eps) < 2:
        return []
    stacks = [np.nanmedian(cube[e], axis=0) for e in eps]
    labels = [month_label(mjds[e[0]], mjds[e[-1]]) for e in eps]
    mids = [float((mjds[e[0]] + mjds[e[-1]]) / 2) for e in eps]
    total = np.nanmedian(cube, axis=0)
    kernel = Gaussian2DKernel(max(0.7, 4.0 / scale))   # ~ largura da PSF
    tot_s = convolve(total, kernel, boundary="extend", nan_treatment="interpolate")
    npix = max(3, int(round((9.0 / scale) ** 2 * 0.6)))
    found = []
    pairs = [(len(eps) - 1, 0)] + [(k + 1, k) for k in range(len(eps) - 1) if (k + 1, k) != (len(eps) - 1, 0)]
    for a, b in pairs:
        diff = stacks[a] - stacks[b]
        nanmap = ~np.isfinite(diff)
        sm = convolve(diff, kernel, boundary="extend", nan_treatment="interpolate", preserve_nan=False)
        sm[nanmap] = 0.0
        ok = sm[~nanmap]
        sigma = 1.4826 * np.median(np.abs(ok - np.median(ok))) or 1e-6
        snr = sm / sigma
        blobs = _blobs(snr, +1, npix) + _blobs(snr, -1, npix)
        used = set()
        pos = [k for k, bl in enumerate(blobs) if bl["sign"] > 0]
        neg = [k for k, bl in enumerate(blobs) if bl["sign"] < 0]
        items = []
        for i in pos:   # dipolos: par claro-escuro vizinho com intensidades parecidas
            best = None
            for j in neg:
                if j in used:
                    continue
                d = math.hypot(blobs[i]["x"] - blobs[j]["x"], blobs[i]["y"] - blobs[j]["y"]) * scale
                ratio = blobs[i]["snr"] / blobs[j]["snr"]
                if d <= PAIR_RADIUS and 0.33 < ratio < 3 and (best is None or d < best[1]):
                    best = (j, d)
            if best:
                used.update((i, best[0]))
                items.append({**blobs[i], "type": "dipolo", "sep": best[1],
                              "snr": math.hypot(blobs[i]["snr"], blobs[best[0]]["snr"])})
        for k, bl in enumerate(blobs):
            if k not in used:
                items.append({**bl, "type": "apareceu" if bl["sign"] > 0 else "sumiu", "sep": None})
        for it in items:
            xi, yi = int(round(it["x"])), int(round(it["y"]))
            r = max(3, int(round(18 / scale)))
            edge = xi < r + 2 or yi < r + 2 or xi >= n - r - 2 or yi >= n - r - 2
            box = nanmap[max(0, yi - r):yi + r + 1, max(0, xi - r):xi + r + 1]
            # resíduo de estrela brilhante: a mudança é pequena perto do brilho total do lugar.
            # Um objeto que anda meia PSF já muda ~40% do próprio brilho; resíduos ficam abaixo de 25%.
            base = float(np.nanmax(tot_s[max(0, yi - 2):yi + 3, max(0, xi - 2):xi + 3])) if not edge else 0.0
            change = it["peak"] * sigma
            residual = base > 0 and change < RESIDUAL_FRACTION * base
            if it["snr"] < THRESHOLD or (it["type"] != "dipolo" and it["snr"] < THRESHOLD + 1):
                continue   # ruído: nem conta como mudança detectada
            reject = "borda" if edge or box.mean() > 0.15 else "residuo" if residual else None
            sky = pipeline.target_grid(ra, dec, fov)[0].pixel_to_world(it["x"], it["y"])
            found.append({"ra": float(sky.ra.deg), "dec": float(sky.dec.deg), "band": band, "type": it["type"],
                          "reject": reject,
                          "snr": round(it["snr"], 1), "sep": None if it["sep"] is None else round(it["sep"], 1),
                          "epoch_a": labels[a], "epoch_b": labels[b], "mjd_a": mids[a], "mjd_b": mids[b]})
    return found


def sep_arcsec(ra1, dec1, ra2, dec2):
    return math.hypot((ra1 - ra2) * math.cos(math.radians(dec1)), dec1 - dec2) * 3600


def run_region(region, manifest):
    tgt = next(t for t in manifest if t["id"] == region["target"])
    ra, dec, fov = tgt["ra"], tgt["dec"], region["fov"]
    print(f"== {tgt['title']}  RA={ra} Dec={dec} campo={fov}'", flush=True)
    found = []
    for band in region["bands"]:
        f = detect_band(ra, dec, fov, band)
        print(f"   {band}: {len(f)} mudanças acima do limiar", flush=True)
        found += f
    known = []
    for cat, mag_limit in (("gaia", 20.0), ("catwise", 16.0)):
        try:
            rows = catalogs.catalog(ra, dec, fov, cat)["rows"]
            known += [r for r in rows if r["mag"] is not None and r["mag"] < mag_limit]
        except Exception as e:  # noqa: BLE001
            print(f"   {cat}: indisponível ({e}); seguindo sem ele", flush=True)
    found.sort(key=lambda c: (c["reject"] is not None, c["type"] != "dipolo", -c["snr"]))
    stats = {"detected": 0, "artifacts": 0, "known_static": 0}
    queue, unique = [], []
    for c in found:
        if any(sep_arcsec(c["ra"], c["dec"], q["ra"], q["dec"]) < 15 for q in unique):
            continue   # a mesma mudança vista em outra banda ou outro par de épocas
        unique.append(c)
        stats["detected"] += 1
        # controle: objeto rápido já conhecido (movimento próprio do SIMBAD acima do limite)
        ctrl = next((t for t in manifest if sep_arcsec(c["ra"], c["dec"], t["ra"], t["dec"]) < 15
                     and math.hypot(t["simbad"]["pmra"], t["simbad"]["pmde"]) > catalogs.HIGH_PM_MAS), None)
        match = next((k for k in known if sep_arcsec(c["ra"], c["dec"], k["ra"], k["dec"]) < MATCH_RADIUS), None)
        if c["reject"] == "borda":
            stats["artifacts"] += 1
        elif ctrl and c["type"] == "dipolo":
            c.update(control=True, match=f"{ctrl['title']}, objeto conhecido de alto movimento próprio (SIMBAD)")
            queue.append(c)
        elif match:
            stats["known_static"] += 1   # estrela ou galáxia de catálogo: variação de brilho ou resíduo
        elif c["reject"] == "residuo":
            stats["artifacts"] += 1
        else:
            c.update(control=False, match=None)
            queue.append(c)
    for c in queue:
        c.pop("reject")
        c.update(id=f"SPX{c['ra']:.3f}{c['dec']:+.3f}", region=tgt["title"], rra=ra, rdec=dec, rfov=fov)
    return queue, stats


def main():
    manifest = json.loads((C.DATA_DIR / "targets.json").read_text("utf-8"))["targets"]
    queue, total = [], {"detected": 0, "artifacts": 0, "known_static": 0}
    for region in REGIONS:
        q, st = run_region(region, manifest)
        print(f"   -> {st['detected']} mudanças: {st['known_static']} de catálogo, {st['artifacts']} defeitos/resíduos, "
              f"{len(q)} para a fila", flush=True)
        queue += q
        for k in total:
            total[k] += st[k]
    # intercala controles e desconhecidos, começando pelos sinais mais fortes
    queue.sort(key=lambda c: -min(c["snr"], 60) - (5 if c["control"] else 0))
    queue = queue[:MAX_QUEUE]
    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "regions": [r["target"] for r in REGIONS],
        "pipeline": {**total, "controls": sum(c["control"] for c in queue), "threshold": THRESHOLD,
                     "ref_epoch": catalogs.REF_EPOCH},
        "candidates": queue,
    }
    path = C.CANDIDATE_DIR / "queue.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
    print(f"ok -> {path}: {len(queue)} candidatos")
    for c in queue:
        print(f"   {c['id']} {c['region'][:18]:18s} {c['band']} {c['type']:9s} {c['snr']:7.1f}σ {'CONTROLE' if c['control'] else ''}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # consoles do Windows
    main()
