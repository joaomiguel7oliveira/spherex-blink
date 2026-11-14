"""Monta um "cubo": recortes de todas as exposições de um detector, reprojetados
para a MESMA grade (norte para cima, centrada no alvo), com fundo removido.

Saída em data/cache/<chave>/:
  meta.json   metadados por quadro (data, comprimento de onda, flags, URL de origem)
  cube.f32    float32 little-endian, [n, N, N], em MJy/sr, fundo ~0, NaN = sem dado
  flags.i32   int32 little-endian, [n, N, N], plano FLAGS reprojetado (vizinho mais próximo)
"""
from __future__ import annotations

import json
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.stats import sigma_clipped_stats
from astropy.time import Time
from astropy.wcs import WCS
import astropy.units as u
from reproject import reproject_interp

from . import config as C
from . import spherex as S


def cube_key(ra: float, dec: float, fov: float, band: str) -> str:
    return f"r{ra:.4f}_d{dec:+.4f}_f{fov:.1f}_{band}"


def target_grid(ra: float, dec: float, fov: float):
    """Grade comum: projeção TAN, norte para cima, leste à esquerda."""
    scale = max(C.MIN_PIXSCALE, fov * 60 / C.MAX_GRID)
    n = int(round(fov * 60 / scale))
    n += (n + 1) % 2  # lado ímpar: existe um pixel central
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    w.wcs.cdelt = [-scale / 3600, scale / 3600]
    return w, n, scale


def _process(row, coord, half, probe, tw, n):
    ex = S.fetch_exposure(row, coord, half, probe)
    if ex is None:
        return None
    sci = ex["img"] - ex["zodi"]          # remove o modelo de luz zodiacal
    bad = (ex["flags"] & C.BAD_MASK) != 0
    sci[bad] = np.nan
    out, fp = reproject_interp((sci, ex["wcs"]), tw, shape_out=(n, n), order="bilinear")
    cov = float((fp > 0).mean())
    if cov < 0.6:
        return None
    fl, _ = reproject_interp((ex["flags"].astype(np.float64), ex["wcs"]), tw, shape_out=(n, n),
                             order="nearest-neighbor")
    fl = np.nan_to_num(fl, nan=0.0).astype(np.int32)
    if np.isfinite(out).sum() < 0.3 * n * n:
        return None
    _, med, std = sigma_clipped_stats(out[np.isfinite(out)], sigma=3.0, maxiters=5)
    out = (out - med).astype(np.float32)
    c = n // 2
    r = max(1, int(round(C.NATIVE_PIXSCALE * 1.5 / (tw.wcs.cdelt[1] * 3600))))
    center_flags = int(np.bitwise_or.reduce(fl[c - r:c + r + 1, c - r:c + r + 1].ravel()))
    wl = ex["wl"]
    return {
        "data": out, "flags": fl,
        "meta": {
            "mjd": round(ex["mjd"], 6),
            "date": Time(ex["mjd"], format="mjd").utc.isot[:19],
            "wl": round(float(wl[0]), 5), "bw": round(ex["bw"], 5),
            # gradiente do comprimento de onda dentro do recorte (um por pixel da grade)
            "dwl": [round(float(wl[1] - wl[0]) / 10, 7), round(float(wl[2] - wl[0]) / 10, 7)],
            "obsid": row["obsid"], "url": row["url"], "collection": row["collection"],
            "bg": round(float(med), 5), "noise": round(float(std), 5), "cov": round(cov, 3),
            "psf_fwhm": round(ex["psf_fwhm"], 2),
            "flags_center": S.flag_names(center_flags),
            "via": ex["via"],
        },
    }


def build_cube(ra: float, dec: float, fov: float, band: str, progress=None, refresh_index=False) -> dict:
    key = cube_key(ra, dec, fov, band)
    rows = [r for r in S.list_exposures(ra, dec, refresh=refresh_index) if r["band"] == band]
    if not rows:
        raise S.DataUnavailable("Nenhuma imagem do SPHEREx cobre esta posição nesta banda (ainda).")
    tw, n, scale = target_grid(ra, dec, fov)
    coord = SkyCoord(ra * u.deg, dec * u.deg)
    c = (n - 1) / 2
    probe = tw.pixel_to_world([c, c + 10, c], [c, c, c + 10])
    half = int(np.ceil(fov * 60 / 2 * 1.4143 / C.NATIVE_PIXSCALE)) + 4

    results, failed, done = [], 0, 0
    if progress:
        progress(0, len(rows))
    with ThreadPoolExecutor(max_workers=C.FETCH_WORKERS) as pool:
        futs = [pool.submit(_process, r, coord, half, probe, tw, n) for r in rows]
        for f in as_completed(futs):
            done += 1
            try:
                res = f.result()
                if res is not None:
                    results.append(res)
            except S.DataUnavailable:
                failed += 1
            if progress:
                progress(done, len(rows))
    if not results:
        raise S.DataUnavailable("Não foi possível baixar nenhuma exposição desta região.")
    results.sort(key=lambda r: r["meta"]["mjd"])

    # Épocas: passagens do levantamento separadas por um intervalo longo.
    epochs, last = [], None
    for r in results:
        m = r["meta"]["mjd"]
        if last is None or m - last > C.EPOCH_GAP_DAYS:
            epochs.append({"idx": len(epochs), "mjd_min": m, "mjd_max": m, "n": 0})
        e = epochs[-1]
        e["mjd_max"], e["n"] = m, e["n"] + 1
        r["meta"]["epoch"] = e["idx"]
        last = m
    for e in epochs:
        e["mjd_mid"] = round((e["mjd_min"] + e["mjd_max"]) / 2, 3)
        e["date_min"] = Time(e["mjd_min"], format="mjd").utc.isot[:10]
        e["date_max"] = Time(e["mjd_max"], format="mjd").utc.isot[:10]

    cube = np.stack([r["data"] for r in results]).astype("<f4")
    flags = np.stack([r["flags"] for r in results]).astype("<i4")
    finite = cube[np.isfinite(cube)]
    sample = finite[:: max(1, finite.size // 400_000)]
    med = float(np.median(sample))
    sigma = float(1.4826 * np.median(np.abs(sample - med))) or 1e-3
    meta = {
        "key": key, "ra": ra, "dec": dec, "fov": fov, "band": band,
        "n": len(results), "size": n, "pixscale": round(scale, 4),
        "band_range_um": C.BAND_RANGE_UM[band],
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "n_listed": len(rows), "n_failed": failed,
        "stats": {"sigma": round(sigma, 5), "p999": round(float(np.percentile(sample, 99.9)), 4),
                  "max": round(float(sample.max()), 3)},
        "flag_bits": {str(k): v for k, v in C.FLAG_BITS.items()}, "bad_bits": C.BAD_BITS,
        "epochs": epochs, "frames": [r["meta"] for r in results],
        "source": {"index": C.SIA_URL, "collections": C.SIA_COLLECTIONS, "unit": "MJy/sr"},
    }
    final = C.CACHE_DIR / key
    tmp = C.CACHE_DIR / (key + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    cube.tofile(tmp / "cube.f32")
    flags.tofile(tmp / "flags.i32")
    (tmp / "meta.json").write_text(json.dumps(meta), "utf-8")
    shutil.rmtree(final, ignore_errors=True)
    tmp.rename(final)
    return meta


def load_meta(key: str):
    p = C.CACHE_DIR / key / "meta.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else None


def load_cube(key: str):
    meta = load_meta(key)
    n, s = meta["n"], meta["size"]
    cube = np.fromfile(C.CACHE_DIR / key / "cube.f32", dtype="<f4").reshape(n, s, s)
    return meta, cube


# --------------------------------------------------------------------------- tarefas
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def job_status(key: str) -> dict | None:
    return _jobs.get(key)


def ensure_cube(ra: float, dec: float, fov: float, band: str) -> dict:
    """Devolve o estado do cubo; dispara a construção em segundo plano se preciso."""
    key = cube_key(ra, dec, fov, band)
    if load_meta(key):
        return {"status": "ready", "key": key}
    with _lock:
        job = _jobs.get(key)
        if job and job["status"] == "building":
            return {"key": key, **job}
        if job and job["status"] == "error" and time.time() - job["t"] < 20:
            return {"key": key, **job}
        job = _jobs[key] = {"status": "building", "done": 0, "total": 0, "t": time.time()}

    def run():
        try:
            build_cube(ra, dec, fov, band, progress=lambda d, t: job.update(done=d, total=t))
            job.update(status="ready")
        except Exception as e:  # noqa: BLE001
            job.update(status="error", error=str(e), t=time.time())

    threading.Thread(target=run, daemon=True).start()
    return {"key": key, **job}
