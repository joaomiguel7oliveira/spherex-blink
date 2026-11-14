"""Ingestão de dados novos, sem mexer no frontend.

Reconsulta o índice do IRSA (SIA) para cada região que já está no cache. Se o número
de exposições mudou (novo lançamento de dados ou nova passagem do telescópio), refaz o
cubo. No fim, regenera a fila de candidatos. Pode rodar em um agendador (cron).

  python -m backend.refresh            # só refaz o que mudou
  python -m backend.refresh --all      # refaz todos os cubos

Para incluir uma nova coleção (por exemplo um DR2), acrescente o nome dela em
SIA_COLLECTIONS no arquivo backend/config.py e rode este script.
"""
from __future__ import annotations

import json
import sys

from . import candidates, config as C, pipeline, spherex


def main(force: bool = False):
    metas = [json.loads(p.read_text("utf-8")) for p in sorted(C.CACHE_DIR.glob("*/meta.json"))]
    print(f"{len(metas)} cubos no cache; coleções: {C.SIA_COLLECTIONS}")
    seen_index, rebuilt = set(), 0
    for m in metas:
        pos = (m["ra"], m["dec"])
        try:
            rows = spherex.list_exposures(*pos, refresh=pos not in seen_index)
        except spherex.DataUnavailable as e:
            print(f"  {m['key']}: IRSA indisponível ({e}); mantendo o cubo atual")
            continue
        seen_index.add(pos)
        n_now = sum(1 for r in rows if r["band"] == m["band"])
        if force or n_now != m.get("n_listed"):
            print(f"  {m['key']}: {m.get('n_listed')} -> {n_now} exposições, refazendo…", flush=True)
            try:
                pipeline.build_cube(m["ra"], m["dec"], m["fov"], m["band"])
                rebuilt += 1
            except Exception as e:  # noqa: BLE001
                print(f"     falhou: {e}")
    print(f"{rebuilt} cubos refeitos")
    if rebuilt and (C.DATA_DIR / "targets.json").exists():
        candidates.main()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main(force="--all" in sys.argv)
