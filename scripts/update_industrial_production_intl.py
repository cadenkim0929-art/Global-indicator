#!/usr/bin/env python3
"""
산업생산지수(월간) 어댑터 — FRED가 stale인 한국/일본/유로존을 OECD/Eurostat 공식
API에서 직접 가져와 indicators.json에 병합한다.

배경: FRED 재게시 시리즈(KORPROINDMISMEI, JPNPROINDMISMEI 등)가 2024-01 이후
갱신이 끊긴 상태였는데, 이걸 "yearly"로 재분류해 stale 판정을 우회했던 걸 되돌리고
실제 최신 월간 데이터를 붙이는 게 이 스크립트의 목적이다. frequency는 반드시
monthly로 유지한다 — 데이터가 여전히 오래됐다면 그 사실을 stale로 정직하게
보여주는 게 맞다.

⚠️ 중요: 이 스크립트는 개발 환경(egress 제한된 샌드박스)에서 OECD/Eurostat API에
라이브로 접근해 검증하지 못한 상태로 작성됨. 특히 OECD 쪽은 API가 최근 새 버전
(sdmx.oecd.org/public/rest/data/...)으로 이전되어 정확한 dataflow/dimension
키 조합을 100% 확신할 수 없다 — 실행 후 stderr를 반드시 확인하고, 실패하면
OECD Data Explorer(data-explorer.oecd.org)에서 "Developer API" 버튼으로
직접 복사한 쿼리로 OECD_KEY_TEMPLATE을 교체할 것.

사용법:
    python3 scripts/update_industrial_production_intl.py
"""
from __future__ import annotations
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "src/data/indicators.json"
KST = timezone(timedelta(hours=9))

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── Eurostat: sts_inpr_m (Production in industry - monthly data) ───────────
# 실검색으로 확인된 정확한 데이터셋 코드/필터값. geo=EA20(유로존 20개국),
# nace_r2=C(전체 제조업), unit=I21(지수), s_adj=SCA(계절+영업일조정).
EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
EUROSTAT_DATASET = "sts_inpr_m"
EUROSTAT_PARAMS = {"geo": "EA20", "nace_r2": "C", "unit": "I21", "s_adj": "SCA", "format": "JSON"}

# ── OECD: Production/industrial output, monthly, Korea+Japan ───────────────
# 검증 완료(2026-07-10): OECD.STES DF_INDSERV 4.3, PRVM/IX/C 제조업 월간.
# REF_AREA.M.PRVM.IX.C..... = 국가/월간/Production volume/Index/Manufacturing.
OECD_URL_TEMPLATE = (
    "https://sdmx.oecd.org/public/rest/data/"
    "OECD.SDD.STES,DSD_STES@DF_INDSERV,4.3/{geo}.M.PRVM.IX.C.....?"
    "startPeriod={start}&dimensionAtObservation=AllDimensions&format=jsondata"
)
OECD_TARGETS = {
    "KOR": "industrial_production_korea",
    "JPN": "industrial_production_japan",
    "IND": "industrial_production_india",
}


def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ep-industry-monitor/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def normalize_eurostat_period(period_raw: str) -> str | None:
    """Eurostat 월간 표기("2026M05")를 "2026-05-01"로 정규화.

    기존 eurostat.py의 jsonstat_rows()는 월간 포맷을 인식 못 하고 quarterly로
    오분류하는 버그가 있어(연간 YYYY / "-QN" 포함만 인식), 여기서 직접 처리한다.
    """
    m = re.match(r"^(\d{4})[-]?M(\d{2})$", period_raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-01"
    if re.match(r"^\d{4}-\d{2}$", period_raw):
        return f"{period_raw}-01"
    return None  # 연간/분기 등 월간이 아닌 형식은 이 스크립트에서 다루지 않음


def fetch_eurostat_industrial_production(limit: int = 8) -> list[dict]:
    url = f"{EUROSTAT_BASE}/{EUROSTAT_DATASET}?{urllib.parse.urlencode(EUROSTAT_PARAMS)}"
    payload = fetch_json(url, timeout=45)
    dims = payload.get("id") or []
    sizes = payload.get("size") or []
    values = payload.get("value") or {}
    categories = payload.get("dimension") or {}
    if not dims or not sizes or not values:
        print("[Eurostat] 응답에 데이터 없음 — 필터 조합을 재확인할 것", file=sys.stderr)
        return []

    lookups: list[list[str]] = []
    for dim in dims:
        idx = categories.get(dim, {}).get("category", {}).get("index", {})
        ordered = [None] * len(idx)
        for code, pos in idx.items():
            if 0 <= int(pos) < len(ordered):
                ordered[int(pos)] = code
        lookups.append([x or "" for x in ordered])

    def unravel(flat: int) -> list[int]:
        coords = []
        for size in reversed(sizes):
            coords.append(flat % size)
            flat //= size
        return list(reversed(coords))

    rows = []
    for flat_key, value in values.items():
        try:
            coords = unravel(int(flat_key))
            rec = {dim: lookups[i][coords[i]] for i, dim in enumerate(dims)}
            period_raw = str(rec.get("time") or rec.get("TIME_PERIOD") or "")
            period = normalize_eurostat_period(period_raw)
            if not period or value is None:
                continue
            rows.append({"period": period, "value": float(value)})
        except Exception:
            continue
    rows.sort(key=lambda r: r["period"], reverse=True)
    return rows[:limit]


def fetch_oecd_industrial_production(geo: str, limit: int = 8) -> list[dict]:
    start = (datetime.now(KST) - timedelta(days=730)).strftime("%Y-%m")
    url = OECD_URL_TEMPLATE.format(geo=geo, start=start)
    try:
        payload = fetch_json(url, timeout=30)
    except Exception as e:
        print(f"[OECD:{geo}] 호출 실패({e}) — dataflow/dimension 키를 OECD Data "
              f"Explorer에서 재확인 필요. URL: {url}", file=sys.stderr)
        return []
    # OECD SDMX-JSON(v2, AllDimensions) 구조: dataSets[0].observations에
    # {"인덱스문자열": [값, ...]} 형태로 들어옴. 구조가 예상과 다르면 여기서
    # 빈 리스트를 반환하고 stderr에 원인을 남긴다.
    try:
        # SDMX-JSON 2.0 stores structures/dataSets under payload['data']; older
        # examples sometimes put them at top level. Support both.
        data_node = payload.get("data", payload)
        structures = data_node.get("structures") or payload.get("structures") or []
        if not structures:
            print(f"[OECD:{geo}] structures를 못 찾음 — 응답 구조 확인 필요", file=sys.stderr)
            return []
        structure = structures[0]
        obs_dim = structure["dimensions"]["observation"]
        time_dim_index = next((i for i, d in enumerate(obs_dim) if d.get("id") in ("TIME_PERIOD", "TIME")), None)
        if time_dim_index is None:
            print(f"[OECD:{geo}] TIME_PERIOD dimension을 못 찾음 — 응답 구조 확인 필요", file=sys.stderr)
            return []
        time_dim = obs_dim[time_dim_index]
        time_values = [v.get("id") or v.get("name") for v in time_dim.get("values", [])]
        observations = data_node["dataSets"][0]["observations"]
        rows = []
        for key, obs in observations.items():
            idx_parts = key.split(":")
            if time_dim_index >= len(idx_parts):
                continue
            idx = int(idx_parts[time_dim_index])
            if idx >= len(time_values):
                continue
            period_raw = time_values[idx]
            m = re.match(r"^(\d{4})-(\d{2})", period_raw)
            if not m or obs[0] is None:
                continue
            rows.append({"period": f"{m.group(1)}-{m.group(2)}-01", "value": float(obs[0])})
        rows.sort(key=lambda r: r["period"], reverse=True)
        return rows[:limit]
    except (KeyError, IndexError, TypeError) as e:
        print(f"[OECD:{geo}] 응답 파싱 실패({e}) — SDMX-JSON 구조가 예상과 다름. "
              f"원본 응답을 확인할 것. URL: {url}", file=sys.stderr)
        return []


def merge_into_indicators_json(indicator_id: str, rows: list[dict], source_note: str) -> int:
    if not DATA_PATH.exists():
        print(f"[Merge] {DATA_PATH} 없음 — 먼저 기본 indicators.json이 있어야 함", file=sys.stderr)
        return 0
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    existing_periods = {
        o["period"] for o in data.get("observations", []) if o.get("indicatorId") == indicator_id
    }
    added = 0
    for row in rows:
        if row["period"] in existing_periods:
            continue
        data.setdefault("observations", []).append({
            "indicatorId": indicator_id,
            "period": row["period"],
            "value": row["value"],
            "observedAt": utc_now_iso(),
        })
        added += 1
    # frequency는 절대 건드리지 않음 — monthly 그대로 유지(오래된 데이터는 stale로
    # 정직하게 남겨야지, 임계값을 조작해 감추면 안 됨).
    for ind in data.get("indicators", []):
        if ind.get("id") == indicator_id:
            ind["sourceId"] = source_note
    data["generatedAt"] = utc_now_iso()
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return added


def main():
    total_added = 0

    print("[Eurostat] 유로존 산업생산(sts_inpr_m) 조회 중...")
    eu_rows = fetch_eurostat_industrial_production()
    if eu_rows:
        n = merge_into_indicators_json("industrial_production_eurozone", eu_rows, "eurostat_sts_inpr_m")
        print(f"[Eurostat] 유로존: {len(eu_rows)}건 조회, {n}건 신규 병합 (최신: {eu_rows[0]['period']})")
        total_added += n
    else:
        print("[Eurostat] 유로존: 데이터 없음 — 위 stderr 메시지 확인", file=sys.stderr)

    for geo, indicator_id in OECD_TARGETS.items():
        print(f"[OECD:{geo}] 산업생산 조회 중...")
        rows = fetch_oecd_industrial_production(geo)
        if rows:
            n = merge_into_indicators_json(indicator_id, rows, "oecd_sdmx_df_indserv")
            print(f"[OECD:{geo}] {len(rows)}건 조회, {n}건 신규 병합 (최신: {rows[0]['period']})")
            total_added += n
        else:
            print(f"[OECD:{geo}] 데이터 없음 — 위 stderr 메시지 확인, "
                  f"OECD Data Explorer에서 쿼리 재확인 필요", file=sys.stderr)

    print(json.dumps({"totalAdded": total_added}, ensure_ascii=False))


if __name__ == "__main__":
    main()
