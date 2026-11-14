"""Modo missões: regras do jogo (conferência dos relatórios, níveis, insígnias, loja).

Tudo o que é inventado (satélites, peças, Central de Comando) é ilustrativo. As medições vêm
do navegador do jogador, com as mesmas ferramentas do modo Céu, e nunca são alteradas aqui.
Sem login: o jogador é um id aleatório do navegador (`sid`) mais o apelido.
"""
from __future__ import annotations

import json
import math
import time

from . import config as C

MISSIONS_FILE = C.DATA_DIR / "missions.json"
_cache: dict = {"mtime": None, "data": None}


def data() -> dict:
    """missions.json, relido quando o arquivo muda (dá para editar sem reiniciar o servidor)."""
    mtime = MISSIONS_FILE.stat().st_mtime
    if _cache["mtime"] != mtime:
        _cache.update(mtime=mtime, data=json.loads(MISSIONS_FILE.read_text("utf-8")))
    return _cache["data"]


def mission(mid: str) -> dict | None:
    return next((m for m in data()["missions"] if m["id"] == mid), None)


def public_missions() -> list[dict]:
    """Missões sem o campo `check`: o cliente nunca vê a resposta."""
    return [{k: v for k, v in m.items() if k not in ("check", "ref", "explain")} for m in data()["missions"]]


def level(xp: int) -> int:
    return int(math.sqrt(max(0, xp) / 100)) + 1


def default_sat() -> dict:
    return {"name": "", "shield": "#c9ccd4", "emblem": None, "trail": "#ffd166", "panel": False, "gold": False,
            "owned": []}


# ------------------------------------------------------------------ desbloqueio
def act_done(act: int, done: set[str]) -> bool:
    return all(m["id"] in done for m in data()["missions"] if m["act"] == act)


def badges(done: set[str], extra: set[str]) -> list[str]:
    out = [f"act{a['act']}" for a in data()["acts"] if act_done(a["act"], done)]
    return out + sorted(extra)


def locked_reason(m: dict, done: set[str], lvl: int) -> str | None:
    """Motivo do bloqueio, ou None se a missão está liberada."""
    for req in m.get("requires", []):
        if req not in done:
            r = mission(req)
            return f"Faça antes: {r['title'] if r else req}"
    act = m["act"]
    if act > 1 and not act_done(act - 1, done) and lvl < 2 + act:
        return f"Termine o ato {act - 1} ou chegue ao nível {2 + act}"
    return None


# ------------------------------------------------------------------ conferência
def _in_range(v, lo, hi):
    return v is not None and lo <= v <= hi


def _angle_in(pa, lo, hi):
    """Ângulo dentro de [lo, hi] dando a volta em 360 (ex.: 340 a 20 = norte ± 20°)."""
    if pa is None:
        return False
    pa, lo, hi = pa % 360, lo % 360, hi % 360
    return lo <= pa <= hi if lo <= hi else pa >= lo or pa <= hi


def _br(v: float, d: int = 1) -> str:
    """Número com vírgula decimal (os textos vão para a tela em português)."""
    return f"{v:.{d}f}".replace(".", ",")


def check_report(m: dict, answer: dict, ctx: dict) -> dict:
    """Confere um relatório. ctx traz o que o servidor sabe por conta própria (votos, marcações).

    Devolve {ok, score, detail}. score é 0–100; participação também é ok (sem certo/errado).
    """
    chk, kind = m.get("check", {}), m["kind"]
    num = lambda k: (float(answer[k]) if isinstance(answer.get(k), (int, float)) else None)  # noqa: E731
    if m.get("target") and answer.get("target") != m["target"]:
        return {"ok": False, "score": 0, "detail": "Este relatório é de outro alvo. Abra o alvo da missão e meça de novo."}

    if kind == "measure_motion":
        pm, pa = num("pm"), num("pa")
        lo, hi = chk["pm_arcsec_yr"]
        ok_pm, ok_pa = _in_range(pm, lo, hi), _angle_in(pa, *chk["pa_deg"])
        if ok_pm and ok_pa:
            return {"ok": True, "score": 100, "detail": f"Medida aceita: {_br(pm)}″/ano a {pa:.0f}°."}
        why = []
        if not ok_pm:
            why.append(f"velocidade {_br(pm)}″/ano fora da faixa esperada ({_br(lo)} a {_br(hi)})" if pm is not None
                       else "faltou a velocidade")
        if not ok_pa:
            why.append(f"direção {pa:.0f}° fora da faixa ({chk['pa_deg'][0]}° a {chk['pa_deg'][1]}°)" if pa is not None
                       else "faltou a direção")
        return {"ok": False, "score": 0, "detail": "Fora da faixa: " + "; ".join(why) + "."}

    if kind == "measure_variability":
        v, band = num("var_pct"), answer.get("band")
        if chk.get("band") and band != chk["band"]:
            return {"ok": False, "score": 0, "detail": f"Meça na banda {chk['band']} (você mediu na {band or '?'})."}
        if v is not None and v >= chk["min_pct"]:
            return {"ok": True, "score": 100, "detail": f"Variação aceita: {v:.0f}%."}
        return {"ok": False, "score": 0,
                "detail": f"Fora da faixa: {v if v is not None else 0:.0f}% é menos que os {chk['min_pct']}% esperados."}

    if kind == "pick_band":
        if answer.get("band") == chk["band"]:
            return {"ok": True, "score": 100, "detail": f"Isso: banda {chk['band']}."}
        return {"ok": False, "score": 0, "detail": f"Na banda {answer.get('band') or '?'} o objeto não aparece bem. Tente outra."}

    if kind == "explore":
        n = ctx["regions_example"] if chk.get("example") else ctx["regions_new"]
        if n < chk["n"]:
            return {"ok": False, "score": 0, "detail": f"Regiões abertas: {n} de {chk['n']}."}
        if chk.get("mark") and ctx["marks"] < 1:
            return {"ok": False, "score": 0, "detail": "Falta marcar um candidato (clique em um objeto e use “Marcar candidato”)."}
        return {"ok": True, "score": 100, "detail": "Missão cumprida."}

    if kind == "classify":
        n, correct, controls = ctx["votes"], ctx["controls_right"], ctx["controls_seen"]
        if n < chk["n"]:
            return {"ok": False, "score": 0, "detail": f"Classificados: {n} de {chk['n']}."}
        part = n - controls
        txt = f"{n} classificações: {correct} de {controls} controles certos" if controls else f"{n} classificações"
        if part > 0:
            txt += f", {part} de participação (sem resposta conhecida)"
        score = 100 if not controls else round(50 + 50 * correct / controls)
        return {"ok": True, "score": score, "detail": txt + "."}

    if kind == "consensus":
        if ctx["consensus"]:
            return {"ok": True, "score": 100, "detail": "Um candidato que você classificou chegou ao consenso."}
        return {"ok": False, "score": 0, "detail": "Nenhum candidato que você votou tem consenso ainda (3 votos, 2/3 de acordo)."}

    return {"ok": False, "score": 0, "detail": f"Tipo de missão desconhecido: {kind}"}


# ------------------------------------------------------------------ loja
def buy(sat: dict, credits: int, lvl: int, my_badges: list[str], item: str, value) -> tuple[dict, int, str | None]:
    """Aplica uma peça. Cada categoria é desbloqueada uma vez; depois as opções trocam de graça."""
    spec = next((s for s in data()["shop"] if s["id"] == item), None)
    if spec is None:
        return sat, credits, "Peça desconhecida."
    if spec.get("level") and lvl < spec["level"]:
        return sat, credits, f"Libera no nível {spec['level']}."
    if spec.get("badge") and spec["badge"] not in my_badges:
        return sat, credits, "Libera com a insígnia do ato 3."
    if spec["kind"] == "text":
        value = str(value or "").strip()[:20]
    elif spec["kind"] == "toggle":
        value = bool(value)
    elif value not in spec["options"]:
        return sat, credits, "Opção inválida."
    sat = {**default_sat(), **sat}
    if spec["cost"] and item not in sat["owned"]:
        if credits < spec["cost"]:
            return sat, credits, f"Faltam créditos: custa {spec['cost']}."
        credits -= spec["cost"]
        sat["owned"] = sat["owned"] + [item]
    sat[item] = value
    return sat, credits, None


def now() -> float:
    return time.time()
