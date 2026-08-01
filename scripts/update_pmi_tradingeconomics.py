#!/usr/bin/env python3
"""Refresh country manufacturing PMI from TradingEconomics public web metadata.

This intentionally uses public HTML meta descriptions, not the paid/official TE API.
It is a pragmatic fallback used at low frequency for countries whose PMI series are
otherwise hard to obtain through stable public APIs.

Outputs one JSON object on stdout.
"""
from __future__ import annotations

import html
import json
import os
import re
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data" / "indicators.json"

MONTH = {m: i for i, m in enumerate("January February March April May June July August September October November December".split(), 1)}

PAGES: dict[str, dict[str, Any]] = {
    "pmi_manufacturing_us_te": {
        "country": "미국",
        "name_en": "United States Manufacturing PMI",
        "name_ko": "미국 제조업 PMI(TradingEconomics)",
        "url": "https://tradingeconomics.com/united-states/manufacturing-pmi",
        "country_re": r"(?:the\s+)?United States",
    },
    "pmi_manufacturing_korea_te": {
        "country": "한국",
        "name_en": "South Korea Manufacturing PMI",
        "name_ko": "한국 제조업 PMI(TradingEconomics)",
        "url": "https://tradingeconomics.com/south-korea/manufacturing-pmi",
        "country_re": r"South Korea",
    },
    "pmi_manufacturing_japan_te": {
        "country": "일본",
        "name_en": "Japan Manufacturing PMI",
        "name_ko": "일본 제조업 PMI(TradingEconomics)",
        "url": "https://tradingeconomics.com/japan/manufacturing-pmi",
        "country_re": r"Japan",
    },
    "pmi_manufacturing_india_te": {
        "country": "인도",
        "name_en": "India Manufacturing PMI",
        "name_ko": "인도 제조업 PMI(TradingEconomics)",
        "url": "https://tradingeconomics.com/india/manufacturing-pmi",
        "country_re": r"India",
    },
    "pmi_manufacturing_eurozone_te": {
        "country": "유로존",
        "name_en": "Euro Area Manufacturing PMI",
        "name_ko": "유로존 제조업 PMI(TradingEconomics)",
        "url": "https://tradingeconomics.com/euro-area/manufacturing-pmi",
        "country_re": r"(?:the\s+)?Euro Area",
    },
}

# News-extracted PMI IDs are a fallback only. Once TE public-web PMI is present,
# remove these duplicate cards so the medium PMI section is country-clean.
NEWS_PMI_IDS = {
    "pmi_manufacturing_us_news",
    "pmi_manufacturing_korea_news",
    "pmi_manufacturing_japan_news",
    "pmi_manufacturing_eurozone_news",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_url(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; EPIndustryMonitor/5.8; +https://global-indicators.cadenkim.work)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def fetch_description(url: str) -> str:
    text = fetch_url(url)
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', text, re.I)
    if not m:
        raise RuntimeError("missing meta description")
    return html.unescape(m.group(1))


def parse_te_pmi(desc: str, country_re: str) -> tuple[float, str]:
    pattern = re.compile(
        rf"Manufacturing\s+PMI\s+(?:in|In)\s+{country_re}\s+.*?\s+to\s+([0-9]+(?:\.[0-9]+)?)\s+points\s+in\s+([A-Za-z]+)\s+from\s+[0-9]+(?:\.[0-9]+)?\s+points\s+in\s+[A-Za-z]+\s+of\s+([0-9]{{4}})",
        re.I,
    )
    m = pattern.search(desc)
    if not m:
        # TE occasionally changes wording; keep this narrow enough to avoid false positives.
        fallback = re.search(r"Manufacturing\s+PMI.*?\s+to\s+([0-9]+(?:\.[0-9]+)?)\s+points\s+in\s+([A-Za-z]+).*?of\s+([0-9]{4})", desc, re.I)
        if not fallback:
            raise RuntimeError(f"parse failed: {desc[:220]}")
        m = fallback
    value = float(m.group(1))
    month_name = m.group(2)
    year = int(m.group(3))
    month = MONTH.get(month_name)
    if not month:
        raise RuntimeError(f"unknown month {month_name!r}")
    return value, f"{year:04d}-{month:02d}-01"


def atomic_write_json(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def upsert_indicator(data: dict, indicator_id: str, cfg: dict[str, Any]) -> None:
    indicators = data.setdefault("indicators", [])
    for ind in indicators:
        if ind.get("id") == indicator_id:
            ind.update({
                "name": cfg["name_en"],
                "nameKo": cfg["name_ko"],
                "frequency": "monthly",
                "category": "demand",
                "unit": "points",
                "sourceId": "tradingeconomics_public_web",
                "sourceUrl": cfg["url"],
                "epRelevant": True,
            })
            return
    indicators.append({
        "id": indicator_id,
        "name": cfg["name_en"],
        "nameKo": cfg["name_ko"],
        "frequency": "monthly",
        "category": "demand",
        "unit": "points",
        "sourceId": "tradingeconomics_public_web",
        "sourceUrl": cfg["url"],
        "epRelevant": True,
    })


def main() -> None:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    observations = data.setdefault("observations", [])
    rows = []
    failures = []

    # Remove fallback news PMI duplicates before adding TE cards.
    data["indicators"] = [i for i in data.get("indicators", []) if i.get("id") not in NEWS_PMI_IDS]
    observations[:] = [o for o in observations if o.get("indicatorId") not in NEWS_PMI_IDS]

    for indicator_id, cfg in PAGES.items():
        try:
            desc = fetch_description(cfg["url"])
            value, period = parse_te_pmi(desc, cfg["country_re"])
            upsert_indicator(data, indicator_id, cfg)
            observations[:] = [
                o for o in observations
                if not (o.get("indicatorId") == indicator_id and str(o.get("period", ""))[:7] == period[:7])
            ]
            observations.append({
                "indicatorId": indicator_id,
                "period": period,
                "value": value,
                "observedAt": utc_now_iso(),
            })
            rows.append({
                "indicatorId": indicator_id,
                "period": period,
                "value": value,
                "sourceUrl": cfg["url"],
                "description": desc,
            })
        except Exception as exc:
            failures.append({"indicatorId": indicator_id, "url": cfg["url"], "error": str(exc)})

    if rows:
        data["generatedAt"] = utc_now_iso()
        data["version"] = "v5.8-pmi-tradingeconomics"
        atomic_write_json(DATA, data)

    print(json.dumps({
        "ok": bool(rows),
        "source": "TradingEconomics public web meta description",
        "rowsUpserted": len(rows),
        "rows": [{k: v for k, v in row.items() if k != "description"} for row in rows],
        "failures": failures,
        "generatedAt": data.get("generatedAt"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
