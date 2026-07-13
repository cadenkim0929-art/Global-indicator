#!/usr/bin/env python3
"""Refresh short-horizon macro market indicators from TradingEconomics public metadata.

Purpose:
- Keep the EP Monitor short macro cards (FX, oil, US 10Y) fresh when FRED lags.
- Use TradingEconomics public HTML meta descriptions as a low-frequency fallback/supplement.
- Do not use the paid TradingEconomics API.

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
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data" / "indicators.json"

MONTH = {m: i for i, m in enumerate("January February March April May June July August September October November December".split(), 1)}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_url(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; EPIndustryMonitor/5.15; +https://global-indicators.cadenkim.work)",
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


def parse_month_day_year(text: str) -> str:
    m = re.search(r"\bon\s+([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})\b", text)
    if not m:
        raise RuntimeError(f"missing date in description: {text[:180]}")
    month = MONTH.get(m.group(1))
    if not month:
        raise RuntimeError(f"unknown month {m.group(1)!r}")
    return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}"


def parse_usd_pair(desc: str, pair: str) -> tuple[float, str]:
    # Example: The USD/KRW exchange rate fell to 1,495.8000 on July 13, 2026...
    pattern = re.compile(rf"\b{re.escape(pair)}\s+exchange\s+rate\s+\w+\s+to\s+([0-9,]+(?:\.[0-9]+)?)\s+on\s+", re.I)
    m = pattern.search(desc)
    if not m:
        raise RuntimeError(f"parse failed for {pair}: {desc[:220]}")
    return float(m.group(1).replace(',', '')), parse_month_day_year(desc)


def parse_commodity(desc: str, name: str) -> tuple[float, str]:
    # Example: Brent rose to 78.74 USD/Bbl on July 13, 2026...
    pattern = re.compile(rf"\b{re.escape(name)}\s+\w+\s+to\s+([0-9,]+(?:\.[0-9]+)?)\s+USD/Bbl\s+on\s+", re.I)
    m = pattern.search(desc)
    if not m:
        raise RuntimeError(f"parse failed for {name}: {desc[:220]}")
    return float(m.group(1).replace(',', '')), parse_month_day_year(desc)


def parse_us_10y(desc: str) -> tuple[float, str]:
    # Example: The yield on US 10 Year Note Bond Yield rose to 4.59% on July 13, 2026...
    m = re.search(r"\byield\s+on\s+US\s+10\s+Year\s+Note\s+Bond\s+Yield\s+\w+\s+to\s+([0-9,]+(?:\.[0-9]+)?)%\s+on\s+", desc, re.I)
    if not m:
        raise RuntimeError(f"parse failed for US 10Y: {desc[:220]}")
    return float(m.group(1).replace(',', '')), parse_month_day_year(desc)


PAGES: dict[str, dict[str, Any]] = {
    "fx_usd_krw": {
        "name_ko": "원/달러 환율(TradingEconomics 보강)",
        "url": "https://tradingeconomics.com/south-korea/currency",
        "parser": lambda desc: parse_usd_pair(desc, "USD/KRW"),
    },
    "fx_usd_cny": {
        "name_ko": "위안/달러 환율(TradingEconomics 보강)",
        "url": "https://tradingeconomics.com/china/currency",
        "parser": lambda desc: parse_usd_pair(desc, "USD/CNY"),
    },
    "oil_brent": {
        "name_ko": "Brent유 가격(TradingEconomics 보강)",
        "url": "https://tradingeconomics.com/commodity/brent-crude-oil",
        "parser": lambda desc: parse_commodity(desc, "Brent"),
    },
    "oil_wti": {
        "name_ko": "WTI유 가격(TradingEconomics 보강)",
        "url": "https://tradingeconomics.com/commodity/crude-oil",
        "parser": lambda desc: parse_commodity(desc, "Crude Oil"),
    },
    "rate_us_10y": {
        "name_ko": "미국 10년물 국채금리(TradingEconomics 보강)",
        "url": "https://tradingeconomics.com/united-states/government-bond-yield",
        "parser": parse_us_10y,
    },
}


def atomic_write_json(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def period_key(period: str) -> str:
    return str(period)[:10]


def upsert_observation(observations: list[dict[str, Any]], indicator_id: str, period: str, value: float) -> bool:
    # Only replace same-day observation. If TE is older than current latest, do not downgrade.
    latest_period = max((period_key(o.get("period", "")) for o in observations if o.get("indicatorId") == indicator_id), default="")
    if latest_period and period < latest_period:
        return False
    observations[:] = [
        o for o in observations
        if not (o.get("indicatorId") == indicator_id and period_key(o.get("period", "")) == period)
    ]
    observations.append({
        "indicatorId": indicator_id,
        "period": period,
        "value": value,
        "observedAt": utc_now_iso(),
    })
    return True


def update_indicator_meta(data: dict, indicator_id: str, cfg: dict[str, Any]) -> None:
    for ind in data.get("indicators", []):
        if ind.get("id") == indicator_id:
            # Keep original catalog identity but make the freshness supplement visible.
            if "TradingEconomics" not in str(ind.get("nameKo", "")):
                ind["nameKo"] = cfg["name_ko"]
            ind["sourceId"] = "fred+tradingeconomics_public_web"
            ind["sourceUrl"] = cfg["url"]
            return


def main() -> None:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    observations = data.setdefault("observations", [])
    rows = []
    skipped = []
    failures = []

    for indicator_id, cfg in PAGES.items():
        try:
            desc = fetch_description(cfg["url"])
            parser: Callable[[str], tuple[float, str]] = cfg["parser"]
            value, period = parser(desc)
            if upsert_observation(observations, indicator_id, period, value):
                update_indicator_meta(data, indicator_id, cfg)
                rows.append({
                    "indicatorId": indicator_id,
                    "period": period,
                    "value": value,
                    "sourceUrl": cfg["url"],
                })
            else:
                skipped.append({"indicatorId": indicator_id, "period": period, "reason": "older-than-current-latest"})
        except Exception as exc:
            failures.append({"indicatorId": indicator_id, "url": cfg["url"], "error": str(exc)})

    if rows:
        data["generatedAt"] = utc_now_iso()
        data["version"] = "v5.15-short-macro-tradingeconomics"
        atomic_write_json(DATA, data)

    print(json.dumps({
        "ok": bool(rows),
        "source": "TradingEconomics public web meta description",
        "rowsUpserted": len(rows),
        "rows": rows,
        "skipped": skipped,
        "failures": failures,
        "generatedAt": data.get("generatedAt"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
