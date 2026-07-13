#!/usr/bin/env python3
"""
PMI 뉴스 추출 파이프라인 — 수집된 기사에서 제조업 PMI 수치를 뽑아 지표로 적재.

배경: 국가별 제조업 PMI는 공개·안정 수치 API가 없음(S&P Global 유료, TE는 키
필요, Investing.com은 이벤트 캘린더라 부적합). 그런데 PMI는 매달 발표 즉시
뉴스로 보도되는 지표라, 이미 돌고 있는 뉴스 수집 파이프라인(data/articles.json)
에서 수치를 추출하는 것이 현실적인 우회 경로다.

설계 원칙 — 보수적 추출(틀린 값보다 빈 값이 낫다):
  - "PMI" 언급 주변 윈도에서만 수치 탐색, 25~75 범위 밖은 버림(연도/비율 오탐 방지)
  - "%"가 붙은 숫자는 제외(관세율 등 오탐 방지)
  - 서비스업 PMI는 제외(제조업 지표에 섞이면 안 됨)
  - 대상 월(month)을 본문에서 못 찾으면 그 건은 버림 — 발행일로 추정하지 않음
  - 국가를 특정 못 하면 버림
  - 중국은 공식 NBS 수집(pmi_manufacturing_china_te)이 이미 있으므로, 해당
    period가 비어있을 때만 뉴스 값으로 보충(공식 데이터 우선)
  - 카탈로그 항목은 실제 값이 추출된 국가만 동적 생성(빈 '수집 대기' 카드 방지)

사용법:
    python3 scripts/extract_pmi_from_news.py
출력: {"pmiExtracted": N, "details": [...]} JSON 한 줄(stdout 마지막 줄)
"""
from __future__ import annotations
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTICLES_PATH = ROOT / "data" / "articles.json"
INDICATORS_PATH = ROOT / "src" / "data" / "indicators.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# 국가 별칭 → 지표 ID. 중국은 기존 공식(NBS) 지표에 보충, 나머지는 _news 신설.
COUNTRY_SPECS = [
    ("china", ["중국", "china", "차이신", "caixin", "nbs"], "pmi_manufacturing_china_te", "중국 제조업 PMI(국가통계국)"),
    ("korea", ["한국", "korea", "국내 제조업"], "pmi_manufacturing_korea_news", "한국 제조업 PMI(뉴스 추출)"),
    ("us", ["미국", "u.s", " us ", "ism"], "pmi_manufacturing_us_news", "미국 제조업 PMI(뉴스 추출)"),
    ("japan", ["일본", "japan", "지분은행", "jibun"], "pmi_manufacturing_japan_news", "일본 제조업 PMI(뉴스 추출)"),
    ("eurozone", ["유로존", "유럽", "eurozone", "euro area", "hcob"], "pmi_manufacturing_eurozone_news", "유로존 제조업 PMI(뉴스 추출)"),
]

# [v5.8] TradingEconomics public-web PMI가 있으면 뉴스 추출 PMI는 fallback으로만
# 동작해야 한다. 같은 국가/월 TE 값이 이미 있으면 *_news 카드를 다시 만들지 않는다.
TE_PRIMARY_BY_NEWS_ID = {
    "pmi_manufacturing_korea_news": "pmi_manufacturing_korea_te",
    "pmi_manufacturing_us_news": "pmi_manufacturing_us_te",
    "pmi_manufacturing_japan_news": "pmi_manufacturing_japan_te",
    "pmi_manufacturing_eurozone_news": "pmi_manufacturing_eurozone_te",
}

MONTH_EN = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june",
     "july", "august", "september", "october", "november", "december"])}
for abbr, full in [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
                   ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "september"),
                   ("oct", "october"), ("nov", "november"), ("dec", "december")]:
    MONTH_EN[abbr] = MONTH_EN[full]

SERVICES_RE = re.compile(r"서비스업|services\s+pmi|service\s+sector", re.I)
MANUF_RE = re.compile(r"제조업|manufacturing|factory", re.I)
# 숫자 후보: 앞뒤가 숫자/소수점과 이어지지 않는 2자리(+소수) — "June 2026"의
# "20"/"26" 같은 연도 조각 오탐 방지.
VALUE_CAND_RE = re.compile(r"(?<![\d.])(\d{2}(?:\.\d{1,2})?)(?!\d)")
MONTH_KO_RE = re.compile(r"(\d{1,2})\s*월")


def find_pmi_value(segment: str) -> float | None:
    """PMI 언급 뒤 구간에서 PMI 수치를 찾는다.

    [버그수정] 초기 버전은 "%가 붙은 숫자 제외"를 정규식 부정 전방탐색으로
    처리했는데, ISM 공식 표기("Manufacturing PMI® at 53.3%")에서 백트래킹이
    일어나 53.3이 조용히 53으로 잘려 들어갔다(실데이터에서 확인). 조용히 틀린
    값이 들어가는 최악의 실패 유형이라, 명시적 로직으로 재작성:
      - 모든 숫자 후보를 순회(백트래킹 개입 여지 제거)
      - %가 붙은 값은 "PMI ... at/: 53.3%"처럼 PMI에 직접 연결된 표기일 때만
        인정(ISM 스타일), 그 외 %값은 관세율 등 오탐으로 보고 배제
    """
    for vm in VALUE_CAND_RE.finditer(segment):
        value = float(vm.group(1))
        if not (25.0 <= value <= 75.0):
            continue
        after = segment[vm.end(): vm.end() + 1]
        if after == "%":
            between = segment[: vm.start()]
            # "PMI® at 53.3%" / "PMI: 53.3%" / "PMI는 53.3%" 같은 직접 연결만 인정
            if not re.search(r"(\bat\b|:|는|은|이|가)\s*$", between, re.I):
                continue
        return value
    return None


def detect_month(window: str, title: str) -> int | None:
    """PMI 언급 주변 윈도에서 대상 월을 찾고, 없으면 제목에서만 추가 탐색.
    본문 전체를 뒤지면 무관한 월(과거 비교 등)을 집을 위험이 커서 범위를 좁힘."""
    for text in (window, title):
        m = MONTH_KO_RE.search(text)
        if m:
            mm = int(m.group(1))
            if 1 <= mm <= 12:
                return mm
        low = text.lower()
        for name, num in MONTH_EN.items():
            if re.search(rf"\b{name}\b", low):
                return num
    return None


def detect_country(window: str, title: str) -> tuple[str, str, str] | None:
    """윈도 우선, 없으면 제목에서 국가 탐지. 두 군데 다 복수 국가면 보수적으로 포기."""
    for text in (window.lower(), title.lower()):
        hits = [(cid, iid, name) for cid, aliases, iid, name in COUNTRY_SPECS
                if any(a in text for a in aliases)]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None  # 여러 나라 총괄 기사 — 어느 나라 수치인지 확정 불가
    return None


def resolve_period(month: int, published_at: str) -> str | None:
    """대상 월 + 발행연도로 period 결정. 12월/1월 경계: 발행월보다 대상월이
    많이 앞서면(예: 1월 발행 기사가 '12월 PMI') 전년도로 판정."""
    try:
        pub = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    year = pub.year
    if month > pub.month + 1:
        year -= 1
    return f"{year}-{month:02d}-01"


def extract_from_article(article: dict) -> list[dict]:
    text = " ".join(str(article.get(k) or "") for k in ("title", "titleKo", "summary", "summaryKo"))
    title = str(article.get("title") or "")
    published_at = str(article.get("publishedAt") or "")
    results = []
    for m in re.finditer(r"pmi", text, re.I):
        window = text[max(0, m.start() - 70): m.end() + 80]
        # 제조업 확인: 윈도나 제목에 제조업 표현이 있어야 하고, 윈도가 서비스업이면 제외
        if SERVICES_RE.search(window):
            continue
        if not (MANUF_RE.search(window) or MANUF_RE.search(title)):
            continue
        value = find_pmi_value(text[m.end(): m.end() + 50])
        if value is None:
            continue
        country = detect_country(window, title)
        if not country:
            continue
        month = detect_month(window, title)
        if not month:
            continue  # 대상 월 불명 — 발행일로 추정하지 않고 버림(보수적)
        period = resolve_period(month, published_at)
        if not period:
            continue
        _, indicator_id, name_ko = country
        results.append({
            "indicatorId": indicator_id, "nameKo": name_ko,
            "period": period, "value": value,
            "sourceTitle": title[:80],
        })
    return results


def main():
    if not ARTICLES_PATH.exists() or not INDICATORS_PATH.exists():
        print(json.dumps({"pmiExtracted": 0, "error": "articles.json 또는 indicators.json 없음"}))
        sys.exit(0)

    articles = json.loads(ARTICLES_PATH.read_text(encoding="utf-8"))
    data = json.loads(INDICATORS_PATH.read_text(encoding="utf-8"))

    # [버그수정] 기존 관측치 대조는 월 단위로 정규화해서 비교 — NBS 공식 수집은
    # period를 "2026-06"으로, 뉴스 추출은 "2026-06-01"로 저장해서 문자열 그대로
    # 비교하면 같은 달인데도 다른 키로 취급돼 공식 데이터 우선 원칙이 깨졌음
    # (합성 테스트에서 실제 재현: NBS 6월 값이 있는데 뉴스 값이 중복 추가됨).
    def month_key(indicator_id: str, period: str) -> tuple[str, str]:
        return (indicator_id, (period or "")[:7])

    existing = {month_key(o["indicatorId"], o["period"]) for o in data.get("observations", [])}
    te_existing = {
        month_key(o["indicatorId"], o["period"])
        for o in data.get("observations", [])
        if o.get("indicatorId") in set(TE_PRIMARY_BY_NEWS_ID.values())
    }
    known_indicators = {i["id"] for i in data.get("indicators", [])}
    # 같은 (지표, 월)에 여러 기사가 있으면 첫 값만 채택
    candidates: dict[tuple[str, str], dict] = {}
    for a in articles:
        for r in extract_from_article(a):
            key = month_key(r["indicatorId"], r["period"])
            if key not in candidates:
                candidates[key] = r

    added, details = 0, []
    for key, r in sorted(candidates.items()):
        indicator_id = r["indicatorId"]
        te_primary_id = TE_PRIMARY_BY_NEWS_ID.get(indicator_id)
        if te_primary_id and (te_primary_id, key[1]) in te_existing:
            continue  # TradingEconomics public-web PMI 우선 — 뉴스 fallback 중복 생성 금지
        if key in existing:
            continue  # 공식 데이터/기존 추출값 우선 — 절대 덮어쓰지 않음
        if indicator_id not in known_indicators:
            data.setdefault("indicators", []).append({
                "id": indicator_id, "name": r["nameKo"], "nameKo": r["nameKo"],
                "frequency": "monthly", "category": "demand", "unit": "points",
                "sourceId": "news_extraction", "sourceUrl": "", "epRelevant": True,
            })
            known_indicators.add(indicator_id)
        data.setdefault("observations", []).append({
            "indicatorId": indicator_id, "period": r["period"], "value": r["value"],
            "observedAt": utc_now_iso(),
        })
        added += 1
        details.append({"indicatorId": indicator_id, "period": r["period"], "value": r["value"]})

    if added:
        data["generatedAt"] = utc_now_iso()
        INDICATORS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"pmiExtracted": added, "details": details}, ensure_ascii=False))


if __name__ == "__main__":
    main()
