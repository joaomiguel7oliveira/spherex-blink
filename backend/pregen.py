"""Pré-gera o cache dos alvos de teste (cubos das 6 bandas + catálogos) e escreve
data/targets.json. Com isso a demo funciona mesmo com o IRSA fora do ar.

  python -m backend.pregen            # só o que falta
  python -m backend.pregen --force    # refaz tudo
"""
from __future__ import annotations

import json
import sys
import time

from . import catalogs, config as C, pipeline

# Coordenadas da WISE 0855 dadas no enunciado do desafio (08h55m10.831s, -07d14m42.53s).
WISE0855_CHALLENGE = {"ra": 133.795129, "dec": -7.245147}

TARGETS = [
    {"id": "barnard", "query": "Barnard's star", "title": "Estrela de Barnard", "band": "D4", "fov": 6.0,
     "kind": "Estrela próxima, alto movimento próprio",
     "legend": "A segunda estrela mais próxima do Sol (6 anos-luz) é também a que mais rápido cruza o nosso céu: "
               "cerca de 10 segundos de arco por ano, para o norte. Ela satura o detector (mancha lisa no centro), mas "
               "dá para ver a mancha subir de uma época para a outra enquanto as estrelas de fundo ficam paradas."},
    {"id": "epsindb", "query": "eps Ind B", "title": "Epsilon Indi B", "band": "D2", "fov": 6.0,
     "kind": "Par de anãs marrons orbitando uma estrela",
     "legend": "Duas anãs marrons (objetos entre planeta e estrela) que orbitam a estrela Epsilon Indi A, a 12 "
               "anos-luz. O par se desloca quase 5 segundos de arco por ano junto com a estrela. No SPHEREx as duas "
               "aparecem fundidas em um único ponto."},
    {"id": "wise0855", "query": "WISE J085510.83-071442.5", "title": "WISE 0855", "band": "D6", "fov": 6.0,
     "kind": "Anã marrom rápida e muito fria",
     "legend": "A anã marrom mais fria conhecida (cerca de -20 °C), a 7 anos-luz. Só brilha no infravermelho perto de "
               "5 micrômetros, por isso use a banda D6. Ela anda 8 segundos de arco por ano para oeste: ligue a "
               "visão Diferença para ver o par claro-escuro que denuncia o movimento."},
    {"id": "rwaur", "query": "RW Aur", "title": "RW Aurigae", "band": "D6", "fov": 6.0,
     "kind": "Estrela jovem variável",
     "legend": "Um sistema jovem cujo brilho muda de forma irregular, às vezes escurecido por nuvens de poeira do "
               "próprio disco. Aqui nada se move: o que muda é o brilho, mais ainda perto de 5 micrômetros (banda D6), "
               "onde brilha a poeira quente. Clique na estrela para ver a curva de luz e o espectro em cada época."},
    {"id": "rdra", "query": "R Dra", "title": "R Draconis", "band": "D6", "fov": 6.0,
     "kind": "Estrela variável pulsante (Mira)",
     "legend": "Uma gigante vermelha que pulsa com período de cerca de 245 dias, mudando muito de brilho. É tão "
               "brilhante que satura o detector (a mancha lisa no centro), mas o halo em volta cresce e encolhe "
               "junto com ela. Clique na estrela e veja o brilho subir e descer entre as épocas."},
]


def build_manifest() -> list[dict]:
    out = []
    for t in TARGETS:
        r = catalogs.resolve_name(t["query"])
        entry = {k: t[k] for k in ("id", "title", "kind", "legend", "band", "fov")}
        entry.update(ra=round(r["ra"], 4), dec=round(r["dec"], 4), simbad=r, markers=[])
        # só vale marcar a posição antiga se o objeto andou bem mais que um pixel (6")
        moved = abs(r["ra"] - r["ra_j2000"]) > 5e-3 or abs(r["dec"] - r["dec_j2000"]) > 5e-3
        if t["id"] == "wise0855":
            entry["markers"].append({**WISE0855_CHALLENGE, "label": "posição do enunciado (≈2010)"})
        elif moved:
            entry["markers"].append({"ra": r["ra_j2000"], "dec": r["dec_j2000"], "label": "posição em 2000"})
        out.append(entry)
    return out


def main(force: bool = False):
    path = C.DATA_DIR / "targets.json"
    manifest = build_manifest()
    try:
        print(f"panorama: {len(catalogs.bright_stars()['stars'])} estrelas brilhantes", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"panorama: sem estrelas ({e})", flush=True)
    path.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d"), "targets": manifest},
                               ensure_ascii=False, indent=1), "utf-8")
    for t in manifest:
        print(f"== {t['title']}  RA={t['ra']} Dec={t['dec']}", flush=True)
        t["bands"] = {}
        for band in C.BANDS:
            key = pipeline.cube_key(t["ra"], t["dec"], t["fov"], band)
            meta = None if force else pipeline.load_meta(key)
            if meta is None:
                t0 = time.time()
                try:
                    meta = pipeline.build_cube(t["ra"], t["dec"], t["fov"], band)
                    print(f"   {band}: {meta['n']} quadros, {len(meta['epochs'])} épocas, {time.time() - t0:.0f}s",
                          flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"   {band}: FALHOU ({e})", flush=True)
                    continue
            t["bands"][band] = {"key": key, "n": meta["n"], "epochs": len(meta["epochs"])}
        for cat in ("gaia", "catwise"):
            try:
                c = catalogs.catalog(t["ra"], t["dec"], t["fov"], cat)
                print(f"   {cat}: {len(c['rows'])} fontes", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"   {cat}: FALHOU ({e})", flush=True)
        path.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d"), "targets": manifest},
                                   ensure_ascii=False, indent=1), "utf-8")
    print("ok ->", path)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # consoles do Windows
    main(force="--force" in sys.argv)
