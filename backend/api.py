"""API + servidor do site.  Rodar:  python -m uvicorn backend.api:app --port 8000"""
from __future__ import annotations

import csv
import io
import json
import sqlite3
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import catalogs, config as C, game, hunt, pipeline

app = FastAPI(title="SPHEREx Blink", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=2000)

LABELS = {"move", "nao_move", "defeito"}


@app.middleware("http")
async def cache_policy(request, call_next):
    """Cubos são imutáveis por chave e podem ficar no cache do navegador; o resto é sempre revalidado."""
    resp = await call_next(request)
    path = request.url.path
    if path.startswith("/data/cache/") and not path.endswith("meta.json"):
        resp.headers["Cache-Control"] = "public, max-age=3600"
    else:
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def _db():
    con = sqlite3.connect(C.VOTES_DB)
    con.execute("CREATE TABLE IF NOT EXISTS votes (candidate TEXT, nickname TEXT, label TEXT, ts REAL,"
                " PRIMARY KEY (candidate, nickname))")
    con.execute("CREATE TABLE IF NOT EXISTS marks (id INTEGER PRIMARY KEY, nickname TEXT, ra REAL, dec REAL,"
                " band TEXT, note TEXT, ts REAL)")
    if "sid" not in [r[1] for r in con.execute("PRAGMA table_info(marks)")]:
        con.execute("ALTER TABLE marks ADD COLUMN sid TEXT")
    con.execute("CREATE TABLE IF NOT EXISTS players (sid TEXT PRIMARY KEY, nickname TEXT, xp INT, credits INT,"
                " sat_json TEXT, extra_badges TEXT, active TEXT, created REAL, seen REAL)")
    con.execute("CREATE TABLE IF NOT EXISTS progress (sid TEXT, mission TEXT, status TEXT, answer_json TEXT,"
                " score INT, ts REAL, PRIMARY KEY (sid, mission))")
    con.execute("CREATE TABLE IF NOT EXISTS regions_seen (sid TEXT, key TEXT, example INT, ts REAL,"
                " PRIMARY KEY (sid, key))")
    con.execute("CREATE TABLE IF NOT EXISTS hunt_scores (sid TEXT, nickname TEXT, score INT, max INT, ts REAL)")
    return con


def _check_band(band: str):
    if band not in C.BANDS:
        raise HTTPException(400, f"band deve ser um de {C.BANDS}")


@app.get("/api/health")
def health():
    return {"ok": True, "collections": C.SIA_COLLECTIONS}


@app.get("/api/resolve")
def resolve(name: str = Query(min_length=1, max_length=80)):
    try:
        return catalogs.resolve_name(name)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Sesame indisponível: {e}")


@app.get("/api/cube")
def cube(ra: float = Query(ge=0, lt=360), dec: float = Query(ge=-90, le=90),
         fov: float = Query(C.FOV_DEFAULT, ge=C.FOV_MIN, le=C.FOV_MAX), band: str = "D2"):
    """Estado do cubo desta região. Se não existir, começa a montar; consulte de novo."""
    _check_band(band)
    return pipeline.ensure_cube(round(ra, 4), round(dec, 4), round(fov, 1), band)


@app.get("/api/catalog")
def catalog(ra: float = Query(ge=0, lt=360), dec: float = Query(ge=-90, le=90),
            fov: float = Query(C.FOV_DEFAULT, ge=C.FOV_MIN, le=C.FOV_MAX), cat: str = "gaia"):
    try:
        return catalogs.catalog(round(ra, 4), round(dec, 4), round(fov, 1), cat)
    except KeyError:
        raise HTTPException(400, "cat deve ser gaia ou catwise")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"VizieR indisponível: {e}")


# ------------------------------------------------------------------ votos e marcações
class Vote(BaseModel):
    candidate: str = Field(max_length=80)
    nickname: str = Field(min_length=1, max_length=24)
    label: str


class Mark(BaseModel):
    nickname: str = Field(min_length=1, max_length=24)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    band: str = Field("", max_length=4)
    note: str = Field("", max_length=200)
    sid: str = Field("", max_length=64, pattern=r"^[A-Za-z0-9-]*$")


@app.post("/api/vote")
def vote(v: Vote):
    if v.label not in LABELS:
        raise HTTPException(400, f"label deve ser um de {sorted(LABELS)}")
    with _db() as con:
        con.execute("INSERT OR REPLACE INTO votes VALUES (?,?,?,?)",
                    (v.candidate, v.nickname.strip(), v.label, time.time()))
    return votes()


@app.get("/api/votes")
def votes():
    """Contagem por candidato, quem votou primeiro, e ranking de participantes."""
    with _db() as con:
        rows = con.execute("SELECT candidate, nickname, label, ts FROM votes ORDER BY ts").fetchall()
    cands: dict[str, dict] = {}
    ranking: dict[str, int] = {}
    for cand, nick, label, ts in rows:
        c = cands.setdefault(cand, {"move": 0, "nao_move": 0, "defeito": 0, "first": nick, "first_ts": ts,
                                    "voters": {}})
        c[label] += 1
        c["voters"][nick] = label
        ranking[nick] = ranking.get(nick, 0) + 1
    return {"candidates": cands,
            "ranking": sorted(([n, k] for n, k in ranking.items()), key=lambda x: -x[1])[:50]}


@app.post("/api/mark")
def mark(m: Mark):
    with _db() as con:
        con.execute("INSERT INTO marks (nickname, ra, dec, band, note, ts, sid) VALUES (?,?,?,?,?,?,?)",
                    (m.nickname.strip(), m.ra, m.dec, m.band, m.note, time.time(), m.sid or None))
    return {"ok": True}


@app.get("/api/marks")
def marks():
    with _db() as con:
        rows = con.execute("SELECT nickname, ra, dec, band, note, ts FROM marks ORDER BY ts").fetchall()
    return [{"nickname": r[0], "ra": r[1], "dec": r[2], "band": r[3], "note": r[4],
             "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r[5]))} for r in rows]


@app.get("/api/marks.csv", response_class=PlainTextResponse)
def marks_csv():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["apelido", "ra_graus", "dec_graus", "banda", "nota", "data_utc"])
    for m in marks():
        w.writerow([m["nickname"], f"{m['ra']:.6f}", f"{m['dec']:.6f}", m["band"], m["note"], m["date"]])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=marcacoes.csv"})


# ------------------------------------------------------------------ quem está online agora
# Só na memória do servidor: cada aba manda um sinal a cada ~30 s com um id aleatório e o apelido (se
# houver). Online = sinal nos últimos 90 s. Não guarda IP nem localização; a órbita de cada satélite
# no globo é inventada a partir do id, no navegador.
PRESENCE_TTL = 90
_presence: dict[str, tuple] = {}   # id -> (apelido, visto, [lat, lon] aproximado, região)


class Ping(BaseModel):
    id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    nickname: str = Field("", max_length=24)
    # região aproximada (fuso horário + deslocamento de centenas de km, feito no navegador); nunca GPS
    loc: list[float] | None = Field(None, min_length=2, max_length=2)
    region: str = Field("", max_length=40)


@app.post("/api/presence")
def presence(p: Ping):
    now = time.time()
    loc = None
    if p.loc and -90 <= p.loc[0] <= 90 and -180 <= p.loc[1] <= 180:
        loc = [round(p.loc[0], 1), round(p.loc[1], 1)]
    _presence[p.id] = (p.nickname.strip(), now, loc, p.region.strip())
    for k in [k for k, v in _presence.items() if now - v[1] > PRESENCE_TTL]:
        del _presence[k]
    return online()


@app.get("/api/online")
def online():
    """Quem está online, com o visual (ilustrativo) do satélite e a missão ativa de cada um."""
    now = time.time()
    ids = [k for k, v in _presence.items() if now - v[1] <= PRESENCE_TTL]
    info = {}
    if ids:
        with _db() as con:
            q = f"SELECT sid, xp, sat_json, active FROM players WHERE sid IN ({','.join('?' * len(ids))})"
            info = {r[0]: r[1:] for r in con.execute(q, ids)}
    out = []
    for k in ids:
        row = {"id": k, "nickname": _presence[k][0], "loc": _presence[k][2], "region": _presence[k][3]}
        if k in info:
            xp, sat_json, active = info[k]
            sat = json.loads(sat_json or "{}")
            m = game.mission(active) if active else None
            row.update(level=game.level(xp), color=sat.get("trail"), emblem=sat.get("emblem"), satname=sat.get("name"),
                       mission=f"Missão {game.data()['missions'].index(m) + 1}: {m['title']}" if m else None)
        out.append(row)
    return out


# ------------------------------------------------------------------ modo missões (ver backend/game.py)
SID = r"^[A-Za-z0-9-]+$"
_report_times: dict[str, list[float]] = {}


class SidBody(BaseModel):
    sid: str = Field(min_length=8, max_length=64, pattern=SID)
    nickname: str = Field("", max_length=24)


class Accept(SidBody):
    mission: str = Field(max_length=40)


class Report(SidBody):
    mission: str = Field(max_length=40)
    answer: dict = Field(default_factory=dict)


class RegionSeen(SidBody):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    example: bool = False


class SatItem(SidBody):
    item: str = Field(max_length=20)
    value: str | bool | None = None


def _player(con, sid: str, nickname: str = "") -> dict:
    now = time.time()
    row = con.execute("SELECT nickname, xp, credits, sat_json, extra_badges, active FROM players WHERE sid=?",
                      (sid,)).fetchone()
    if row is None:
        con.execute("INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?)",
                    (sid, nickname, 0, 0, json.dumps(game.default_sat()), "[]", None, now, now))
        row = (nickname, 0, 0, json.dumps(game.default_sat()), "[]", None)
    elif nickname and nickname != row[0]:
        con.execute("UPDATE players SET nickname=?, seen=? WHERE sid=?", (nickname, now, sid))
        row = (nickname, *row[1:])
    prog = {r[0]: {"status": r[1], "answer": json.loads(r[2] or "{}"), "score": r[3], "ts": r[4]}
            for r in con.execute("SELECT mission, status, answer_json, score, ts FROM progress WHERE sid=?", (sid,))}
    return {"sid": sid, "nickname": row[0] or "", "xp": row[1], "credits": row[2],
            "sat": {**game.default_sat(), **json.loads(row[3] or "{}")}, "extra": set(json.loads(row[4] or "[]")),
            "active": row[5], "progress": prog}


def _player_view(p: dict) -> dict:
    done = {k for k, v in p["progress"].items() if v["status"] == "done"}
    lvl = game.level(p["xp"])
    missions = []
    for m in game.public_missions():
        full = game.mission(m["id"])
        pr = p["progress"].get(m["id"], {})
        item = {**m, "status": pr.get("status", "open"), "locked": game.locked_reason(full, done, lvl)}
        if pr.get("status") == "done":   # depois de cumprida, a referência e a explicação vão para o diário
            item.update(answer=pr["answer"], score=pr["score"], done_ts=pr["ts"], ref=full.get("ref"),
                        explain=full.get("explain"))
        missions.append(item)
    return {"sid": p["sid"], "nickname": p["nickname"], "xp": p["xp"], "level": lvl,
            "next_level_xp": game.LEVEL_K * lvl * lvl, "level_xp": game.LEVEL_K * (lvl - 1) ** 2, "credits": p["credits"],
            "sat": p["sat"], "badges": game.badges(done, p["extra"]), "active": p["active"],
            "acts": game.data()["acts"], "shop": game.data()["shop"], "missions": missions}


@app.get("/api/missions")
def missions_list():
    """As missões, sem as faixas de resposta (check)."""
    return {"acts": game.data()["acts"], "missions": game.public_missions(), "shop": game.data()["shop"]}


@app.get("/api/player")
def player(sid: str = Query(min_length=8, max_length=64, pattern=SID), nickname: str = Query("", max_length=24)):
    with _db() as con:
        return _player_view(_player(con, sid, nickname.strip()))


@app.post("/api/mission/accept")
def mission_accept(b: Accept):
    m = game.mission(b.mission)
    if m is None:
        raise HTTPException(404, "missão desconhecida")
    with _db() as con:
        p = _player(con, b.sid, b.nickname.strip())
        done = {k for k, v in p["progress"].items() if v["status"] == "done"}
        why = game.locked_reason(m, done, game.level(p["xp"]))
        if why:
            raise HTTPException(409, why)
        if b.mission not in done:
            con.execute("INSERT OR REPLACE INTO progress VALUES (?,?,?,?,?,?)",
                        (b.sid, b.mission, "accepted", None, 0, time.time()))
        con.execute("UPDATE players SET active=? WHERE sid=?", (b.mission, b.sid))
        return _player_view(_player(con, b.sid))


@app.post("/api/mission/abandon")
def mission_abandon(b: SidBody):
    with _db() as con:
        con.execute("UPDATE players SET active=NULL WHERE sid=?", (b.sid,))
        return _player_view(_player(con, b.sid))


@app.post("/api/player/region")
def region_seen(b: RegionSeen):
    """Registra uma região aberta (missões de exploração)."""
    with _db() as con:
        _player(con, b.sid, b.nickname.strip())
        con.execute("INSERT OR IGNORE INTO regions_seen VALUES (?,?,?,?)",
                    (b.sid, f"{b.ra:.2f},{b.dec:.2f}", int(b.example), time.time()))
    return {"ok": True}


def _context(con, p: dict) -> dict:
    """O que o servidor confere por conta própria: regiões, marcações, votos e consenso."""
    ex = con.execute("SELECT SUM(example), SUM(1 - example) FROM regions_seen WHERE sid=?", (p["sid"],)).fetchone()
    marks_n = con.execute("SELECT COUNT(*) FROM marks WHERE sid=? OR (sid IS NULL AND nickname=? AND ?<>'')",
                          (p["sid"], p["nickname"], p["nickname"])).fetchone()[0]
    my_votes = {}
    if p["nickname"]:
        my_votes = dict(con.execute("SELECT candidate, label FROM votes WHERE nickname=?", (p["nickname"],)).fetchall())
    controls = {}
    qf = C.CANDIDATE_DIR / "queue.json"
    if qf.exists():
        controls = {c["id"]: "move" for c in json.loads(qf.read_text("utf-8"))["candidates"] if c.get("control")}
    seen = [c for c in my_votes if c in controls]
    allv = votes()["candidates"]
    consensus = False
    for c in my_votes:
        v = allv.get(c)
        if v:
            tot = v["move"] + v["nao_move"] + v["defeito"]
            if tot >= 3 and max(v["move"], v["nao_move"], v["defeito"]) / tot >= 2 / 3:
                consensus = True
    return {"regions_example": ex[0] or 0, "regions_new": ex[1] or 0, "marks": marks_n, "votes": len(my_votes),
            "controls_seen": len(seen), "controls_right": sum(my_votes[c] == controls[c] for c in seen),
            "consensus": consensus}


@app.post("/api/mission/report")
def mission_report(b: Report):
    now = time.time()
    recent = [t for t in _report_times.get(b.sid, []) if now - t < 60]
    if len(recent) >= 10:
        raise HTTPException(429, "Muitos relatórios: espere um minuto.")
    _report_times[b.sid] = recent + [now]
    m = game.mission(b.mission)
    if m is None:
        raise HTTPException(404, "missão desconhecida")
    with _db() as con:
        p = _player(con, b.sid, b.nickname.strip())
        done = {k for k, v in p["progress"].items() if v["status"] == "done"}
        why = game.locked_reason(m, done, game.level(p["xp"]))
        if why:
            raise HTTPException(409, why)
        res = game.check_report(m, b.answer, _context(con, p))
        best = p["progress"].get(m["id"], {}).get("score") or 0 if m["id"] in done else 0
        out = {**res, "mission": m["id"], "title": m["title"], "xp": 0, "credits": 0, "level_up": False,
               "explain": m.get("explain") if res["ok"] else None, "ref": m.get("ref") if res["ok"] else None,
               "repeat": m["id"] in done, "best": max(best, res["score"] if res["ok"] else 0), "max": game.PTS}
        if res["ok"] and m["id"] in done and res["score"] > best:
            # jogar de novo vale a pena: a diferença para o melhor resultado vira pontos
            gain = res["score"] - best
            lvl0 = game.level(p["xp"])
            con.execute("UPDATE players SET xp=xp+?, active=NULL WHERE sid=?", (gain, b.sid))
            con.execute("UPDATE progress SET score=?, answer_json=?, ts=? WHERE sid=? AND mission=?",
                        (res["score"], json.dumps(b.answer), now, b.sid, m["id"]))
            out.update(xp=gain, improved=True, level_up=game.level(p["xp"] + gain) > lvl0)
        if res["ok"] and m["id"] not in done:
            lvl0 = game.level(p["xp"])
            xp = res["score"]
            cr = round(m["reward"]["credits"] * res["score"] / game.PTS)
            extra = set(p["extra"])
            if m["kind"] == "consensus":
                extra.add("consenso")
            if m["kind"] == "explore" and m["check"].get("mark"):
                extra.add("campo-novo")
            con.execute("UPDATE players SET xp=xp+?, credits=credits+?, extra_badges=?, active=NULL WHERE sid=?",
                        (xp, cr, json.dumps(sorted(extra)), b.sid))
            con.execute("INSERT OR REPLACE INTO progress VALUES (?,?,?,?,?,?)",
                        (b.sid, m["id"], "done", json.dumps(b.answer), res["score"], now))
            out.update(xp=xp, credits=cr, level_up=game.level(p["xp"] + xp) > lvl0)
        elif not res["ok"]:
            con.execute("INSERT OR IGNORE INTO progress VALUES (?,?,?,?,?,?)",
                        (b.sid, m["id"], "accepted", None, 0, now))
        out["player"] = _player_view(_player(con, b.sid))
        return out


@app.post("/api/player/satellite")
def player_satellite(b: SatItem):
    with _db() as con:
        p = _player(con, b.sid, b.nickname.strip())
        view = _player_view(p)
        sat, credits, err = game.buy(p["sat"], p["credits"], view["level"], view["badges"], b.item, b.value)
        if err:
            raise HTTPException(409, err)
        con.execute("UPDATE players SET sat_json=?, credits=? WHERE sid=?", (json.dumps(sat), credits, b.sid))
        return _player_view(_player(con, b.sid))


@app.get("/api/leaderboard")
def leaderboard():
    with _db() as con:
        rows = con.execute("SELECT sid, nickname, xp, extra_badges FROM players WHERE xp > 0"
                           " ORDER BY xp DESC LIMIT 50").fetchall()
        out = []
        for sid, nick, xp, extra in rows:
            done = {r[0] for r in con.execute("SELECT mission FROM progress WHERE sid=? AND status='done'", (sid,))}
            out.append({"nickname": nick or "sem apelido", "xp": xp, "level": game.level(xp),
                        "badges": game.badges(done, set(json.loads(extra or "[]"))), "missions": len(done)})
    return out


# ------------------------------------------------------------------ Caça ao movimento (ver backend/hunt.py)
class HuntBody(SidBody):
    game: str = Field("", max_length=32)
    round: int = Field(0, ge=0, lt=10)


class HuntGuess(HuntBody):
    x: float = Field(ge=-1, le=200)
    y: float = Field(ge=-1, le=200)


def _hunt_game(gid: str, sid: str) -> None:
    g = hunt._games.get(gid)
    if not g or g["sid"] != sid:
        raise HTTPException(404, "Partida não encontrada. Comece outra.")


@app.post("/api/hunt/new")
def hunt_new(b: SidBody):
    return hunt.new_game(b.sid)


@app.post("/api/hunt/hint")
def hunt_hint(b: HuntBody):
    _hunt_game(b.game, b.sid)
    return hunt.hint(b.game, b.round)


@app.post("/api/hunt/guess")
def hunt_guess(b: HuntGuess):
    _hunt_game(b.game, b.sid)
    res = hunt.guess(b.game, b.round, b.x, b.y)
    g = hunt._games[b.game]
    if res["done"] and not g.get("saved"):
        g["saved"] = True
        with _db() as con:
            con.execute("INSERT INTO hunt_scores VALUES (?,?,?,?,?)",
                        (b.sid, b.nickname.strip(), res["total"], hunt.PTS * len(g["rounds"]), time.time()))
    return res


@app.get("/api/hunt/img/{gid}/{rnd}/{ep}")
def hunt_img(gid: str, rnd: int, ep: int):
    g = hunt._games.get(gid)
    if not g or not (0 <= rnd < len(g["rounds"])) or not (0 <= ep <= len(g["rounds"][rnd]["crops"])):
        raise HTTPException(404, "imagem desconhecida")
    return Response(hunt.png(gid, rnd, ep), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/hunt/leaderboard")
def hunt_leaderboard():
    with _db() as con:
        rows = con.execute("SELECT nickname, MAX(score), max, COUNT(*) FROM hunt_scores WHERE nickname<>''"
                           " GROUP BY nickname ORDER BY MAX(score) DESC LIMIT 20").fetchall()
    return [{"nickname": n, "best": s, "max": m, "games": c} for n, s, m, c in rows]


# ------------------------------------------------------------------ arquivos estáticos
@app.get("/api/regions")
def regions():
    """Regiões que já têm cubo pronto (aparecem no panorama do céu)."""
    out: dict[tuple, dict] = {}
    for p in C.CACHE_DIR.glob("*/meta.json"):
        try:
            m = pipeline.load_meta(p.parent.name)
        except Exception:  # noqa: BLE001 - cubo sendo gravado
            continue
        r = out.setdefault((m["ra"], m["dec"], m["fov"]), {"ra": m["ra"], "dec": m["dec"], "fov": m["fov"],
                                                             "bands": [], "created": m["created"]})
        r["bands"].append(m["band"])
        r["created"] = max(r["created"], m["created"])
    return sorted(out.values(), key=lambda r: r["created"], reverse=True)


@app.get("/data/sky.json")
def sky():
    p = C.DATA_DIR / "sky.json"
    if not p.exists():
        raise HTTPException(404, "rode `python -m backend.pregen`")
    return FileResponse(p)


@app.get("/data/targets.json")
def targets():
    p = C.DATA_DIR / "targets.json"
    if not p.exists():
        raise HTTPException(404, "rode `python -m backend.pregen` para gerar os alvos de teste")
    return FileResponse(p, headers={"Cache-Control": "no-cache"})


app.mount("/data/cache", StaticFiles(directory=C.CACHE_DIR), name="cache")
app.mount("/data/candidates", StaticFiles(directory=C.CANDIDATE_DIR), name="candidates")
app.mount("/data/catalogs", StaticFiles(directory=C.CATALOG_DIR), name="catalogs")
app.mount("/", StaticFiles(directory=C.FRONTEND_DIR, html=True), name="frontend")
