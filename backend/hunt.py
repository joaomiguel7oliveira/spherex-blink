"""Caça ao movimento: partida rápida de rodadas com as imagens reais do SPHEREx.

Cada rodada pisca as épocas de um recorte de um alvo de exemplo, com enquadramento, rotação e
espelhamento sorteados (o objeto nunca fica no mesmo lugar). O jogador clica no objeto que se
moveu ou mudou de brilho e ganha até 5000 pontos, menos quanto mais longe do objeto clicou.
As imagens saem daqui por um id opaco e a posição certa só volta depois do palpite.
"""
from __future__ import annotations

import io
import json
import math
import random
import secrets
import time
import warnings

import numpy as np

from . import config as C, pipeline

ROUNDS = 5
PTS = 5000
CROP = 64               # lado do recorte mostrado, em pixels da grade (3,075″ cada)
HALF_ARCSEC = 12.0      # errar por 12″ (4 pixels) vale metade dos pontos (objetos pontuais)
HINT_COST = 0.25
_games: dict[str, dict] = {}

KIND = {
    "barnard": "move", "epsindb": "move", "wise0855": "move", "rwaur": "blink", "rdra": "blink",
}
ASK = {"move": "Uma coisa aqui se move entre as épocas. Clique nela.",
       "blink": "Uma coisa aqui muda de brilho entre as épocas. Clique nela."}


def _targets() -> list[dict]:
    t = json.loads((C.DATA_DIR / "targets.json").read_text("utf-8"))["targets"]
    return [x for x in t if x["id"] in KIND and (C.CACHE_DIR / pipeline_key(x)).exists()]


def pipeline_key(t: dict, band: str | None = None) -> str:
    ra, dec, b = t["ra"], t["dec"], band or t["band"]
    return f"r{ra:.4f}_d{'+' if dec >= 0 else ''}{dec:.4f}_f{t['fov']:.1f}_{b}"


def _epoch_images(key: str) -> tuple[list[np.ndarray], list[str], float]:
    """Mediana de cada época e o passo em pixels (″/px)."""
    meta, cube = pipeline.load_cube(key)
    frames = meta["frames"]
    out, dates = [], []
    valid = None
    for ep in meta["epochs"]:
        idx = [i for i, f in enumerate(frames) if f.get("epoch") == ep["idx"]]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            im = np.nanmedian(cube[idx], axis=0)
        # pixel sem dado no miolo de uma estrela brilhante é saturação: pinta de branco, não de preto
        # (buraco que não encosta na borda da imagem = miolo saturado; buraco na borda = fora da cobertura)
        from scipy.ndimage import label
        hole = ~np.isfinite(im)
        lab, nlab = label(hole)
        edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        bright = np.isin(lab, [k for k in range(1, nlab + 1) if k not in edge])
        im = np.where(hole & bright, meta["stats"]["p999"], np.nan_to_num(im, nan=0.0))
        ok = ~hole | bright
        valid = ok if valid is None else valid & ok
        out.append(im)
        dates.append(ep["date_min"][:7])
    return out, dates, meta["pixscale"], meta["stats"], valid


def _blob_radius(img: np.ndarray, stats: dict) -> float:
    """Raio (px) da mancha do objeto no centro: estrelas saturadas são grandes, e clicar nelas vale."""
    from scipy.ndimage import label
    n = img.shape[0]
    c = n // 2
    lab, _ = label(img > max(0.3 * stats["p999"], 8 * stats["sigma"]))
    k = lab[c - 1:c + 2, c - 1:c + 2].max()
    if not k:
        return 0.0
    return float(np.sqrt((lab == k).sum() / np.pi))


def _round(t: dict) -> dict:
    imgs, dates, pix, stats, valid = _epoch_images(pipeline_key(t))
    n = imgs[0].shape[0]
    half = max(HALF_ARCSEC, 0.8 * _blob_radius(imgs[0], stats) * pix)
    c = (n - 1) / 2
    m = 10                                                     # margem: o objeto nunca encosta na borda
    # sorteia entre os enquadramentos com dado em quase toda a área (sem faixas pretas fora da cobertura)
    rng = range(max(0, int(c) - CROP + m), min(n - CROP, int(c) - m) + 1)
    cand = [(valid[oy:oy + CROP, ox:ox + CROP].mean(), ox, oy) for ox in rng for oy in rng]
    best = max(f for f, _, _ in cand)
    good = [(ox, oy) for f, ox, oy in cand if f >= min(0.97, best - 0.01)]
    ox, oy = random.choice(good)
    x, y = c - ox, c - oy                                      # posição do objeto no recorte (coluna, linha)
    crops = [im[oy:oy + CROP, ox:ox + CROP] for im in imgs]
    rot, flip = random.randint(0, 3), random.random() < 0.5
    S = CROP - 1
    for _ in range(rot):                                       # np.rot90 gira no sentido anti-horário
        crops = [np.rot90(a) for a in crops]
        x, y = y, S - x
    if flip:
        crops = [a[:, ::-1] for a in crops]
        x = S - x
    return {"id": t["id"], "title": t["title"], "kind": KIND[t["id"]], "crops": crops, "dates": dates,
            "x": float(x), "y": float(y), "pix": pix, "half": half, "stats": stats, "legend": t.get("legend", "")}


def new_game(sid: str) -> dict:
    ts = _targets()
    random.shuffle(ts)
    picks = (ts * 2)[:ROUNDS] if len(ts) < ROUNDS else ts[:ROUNDS]
    gid = secrets.token_hex(8)
    rounds = [_round(t) for t in picks]
    _games[gid] = {"sid": sid, "rounds": rounds, "guesses": {}, "hints": {}, "t": time.time()}
    for k in [k for k, g in _games.items() if time.time() - g["t"] > 3 * 3600]:
        del _games[k]
    return {"game": gid, "max": PTS * len(rounds), "size": CROP,
            "rounds": [{"ask": ASK[r["kind"]], "kind": r["kind"], "dates": r["dates"], "frames": len(r["crops"])} for r in rounds]}


def png(gid: str, rnd: int, ep: int) -> bytes:
    from PIL import Image
    r = _games[gid]["rounds"][rnd]
    s = max(r["stats"]["sigma"], 1e-6)
    if ep == len(r["crops"]):
        # vista Diferença: última época menos a primeira (claro = chegou, escuro = saiu; cinza = parado)
        d = r["crops"][-1] - r["crops"][0]
        lim = max(np.percentile(np.abs(d), 99.5), 4 * s)
        a = ((np.clip(d / lim, -1, 1) + 1) * 127.5).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(np.ascontiguousarray(a), "L").save(buf, "PNG")
        return buf.getvalue()
    top = np.arcsinh(max(r["stats"]["p999"], 10 * s) / (2 * s))
    a = np.arcsinh(np.clip(r["crops"][ep], 0, None) / (2 * s)) / top
    a = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(a), "L").save(buf, "PNG")
    return buf.getvalue()


def hint(gid: str, rnd: int) -> dict:
    """Pista: em qual quarto da imagem está o objeto (custa 25% da rodada)."""
    g = _games[gid]
    r = g["rounds"][rnd]
    g["hints"][rnd] = 1
    h = CROP / 2
    return {"x0": 0 if r["x"] < h else h, "y0": 0 if r["y"] < h else h, "w": h}


def guess(gid: str, rnd: int, x: float, y: float) -> dict:
    g = _games[gid]
    if rnd in g["guesses"]:
        return g["guesses"][rnd]
    r = g["rounds"][rnd]
    d = math.hypot(x - r["x"], y - r["y"]) * r["pix"]          # em segundos de arco
    pts = round(PTS * math.exp(-0.693 * (d / r["half"]) ** 2) * (1 - HINT_COST) ** g["hints"].get(rnd, 0))
    res = {"x": r["x"], "y": r["y"], "dist": round(d, 1), "points": pts, "title": r["title"], "legend": r["legend"],
           "total": sum(v["points"] for v in g["guesses"].values()) + pts, "done": len(g["guesses"]) + 1 >= len(g["rounds"])}
    g["guesses"][rnd] = res
    return res
