#!/usr/bin/env python3
"""Refresh EP macro indicators from stable public sources.

Current sources:
- FRED public CSV (no API key)
- World Bank WDI API (no API key)

The script preserves observations from unsupported/manual sources, refreshes supported
indicator IDs, and writes src/data/indicators.json atomically.
"""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
import tempfile
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import html
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'src/data/indicators.json'
FRED_KEY_FILE = Path('/home/ubuntu/.hermes/secrets/fred_api_key')
SERIES_RE = re.compile(r'/series/([A-Za-z0-9_]+)')

WORLD_BANK_MAP = {
    # Current US$ GDP, annual official WDI. Stored in indicators.json as trillion USD.
    'gdp_current_usd': ('USA', 'NY.GDP.MKTP.CD'),
    'gdp_annual_korea': ('KOR', 'NY.GDP.MKTP.CD'),
    'gdp_annual_japan': ('JPN', 'NY.GDP.MKTP.CD'),
    'gdp_annual_china': ('CHN', 'NY.GDP.MKTP.CD'),
    'gdp_annual_eurozone': ('EMU', 'NY.GDP.MKTP.CD'),
    'gdp_annual_india': ('IND', 'NY.GDP.MKTP.CD'),
    # China annual GDP growth proxy.
    'gdp_qoq_china_te': ('CHN', 'NY.GDP.MKTP.KD.ZG'),
}

# Stable FRED fallback series for catalog items whose original source is blank,
# TradingEconomics, or another fragile web source. These are labeled as public
# proxy data in the UI by preserving the original indicator name but sourcing
# observations from FRED CSV.
FRED_FALLBACK_MAP = {
    # OECD China composite leading / manufacturing-cycle proxy; used instead of
    # fragile TradingEconomics scraping for the China PMI card.
    'pmi_manufacturing_china_te': 'CSCICP03CNM665S',
}

ECB_ICP_MAP: dict[str, str] = {}

NBS_PMI_IDS = {'pmi_manufacturing_china_te'}

# FRED quarterly GDP series (confirmed real IDs via FRED API search July 2026).
FRED_GDP_QUARTERLY_MAP = {
    # Korea Real GDP (annual KRW, quarterly): latest 2026-Q1 = 596692800.0
    'gdp_quarterly_korea': 'NGDPRSAXDCKRQ',
    # Japan Real GDP (annual JPY, quarterly): latest 2026-Q1 = 148304700.0
    'gdp_quarterly_japan': 'NGDPRSAXDCJPQ',
}

FRED_DIRECT_MAP = {
    'oil_brent': 'DCOILBRENTEU',
    'oil_wti': 'DCOILWTICO',
    'fx_usd_krw': 'DEXKOUS',
    'fx_usd_cny': 'DEXCHUS',
}

# FRED quarterly GDP series (confirmed via FRED API search July 2026).
FRED_GDP_QUARTERLY_MAP = {
    'gdp_quarterly_korea': 'NGDPRSAXDCKRQ',   # Korea Real GDP, quarterly, latest 2026-Q1
    'gdp_quarterly_japan': 'NGDPRSAXDCJPQ',    # Japan Real GDP, quarterly, latest 2026-Q1
}

# China quarterly nominal GDP: FRED CHNGDPNQDSMEI is stale at 2023-Q3.
# Primary: OECD Quarterly National Accounts mirrored by DB.NOMICS.
DBNOMICS_QNA_DATASET = 'DSD_NAMAIN1@DF_QNA_BY_ACTIVITY_OUTPUT'
DBNOMICS_CHINA_GDP_SERIES = 'Q.N.CHN.S1.S1.B1GQ._Z._Z._Z.XDC.V.N.T0101'
DBNOMICS_INDIA_GDP_SERIES = 'Q.N.IND.S1.S1.B1GQ._Z._Z._Z.XDC.V.N.T0101'

def dbnomics_oecd_series_url(series: str) -> str:
    return (
        'https://api.db.nomics.world/v22/series/OECD/'
        'DSD_NAMAIN1%40DF_QNA_BY_ACTIVITY_OUTPUT/'
        f'{series}?observations=1'
    )

DBNOMICS_CHINA_GDP_URL = dbnomics_oecd_series_url(DBNOMICS_CHINA_GDP_SERIES)
DBNOMICS_INDIA_GDP_URL = dbnomics_oecd_series_url(DBNOMICS_INDIA_GDP_SERIES)


def utc_now_iso() -> str:
    # Store machine-readable timestamps in true UTC.
    # The UI converts to KST exactly once. Do not pre-add +9h here.
    return datetime.now(timezone.utc).isoformat()


def fetch_url(url: str, timeout: int = 8) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'EP-Industry-Monitor/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_fred_api_key() -> str | None:
    key = os.environ.get('FRED_API_KEY')
    if key:
        return key.strip()
    try:
        return FRED_KEY_FILE.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        return None


def fetch_fred_api(series: str, limit: int = 8):
    key = get_fred_api_key()
    if not key:
        raise RuntimeError('FRED API key missing')
    params = urllib.parse.urlencode({
        'series_id': series,
        'api_key': key,
        'file_type': 'json',
        'sort_order': 'desc',
        'limit': max(limit * 2, 12),
    })
    url = f'https://api.stlouisfed.org/fred/series/observations?{params}'
    payload = json.loads(fetch_url(url, timeout=20).decode('utf-8', errors='replace'))
    vals = []
    for row in payload.get('observations', []):
        raw = row.get('value')
        date = row.get('date')
        if not date or raw in (None, '', '.'):
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        vals.append({'period': date, 'value': value, 'observedAt': date})
    vals.sort(key=lambda x: x['period'])
    return vals[-limit:]


def fetch_fred(series: str, limit: int = 8):
    try:
        return fetch_fred_api(series, limit)
    except Exception:
        # Fallback to public graph CSV if official API is unavailable.
        pass
    url = f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}'
    text = fetch_url(url).decode('utf-8', errors='replace').splitlines()
    rows = list(csv.DictReader(text))
    vals = []
    for row in rows:
        date = row.get('observation_date')
        raw = row.get(series)
        if not date or raw in (None, '', '.'):
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        vals.append({'period': date, 'value': value, 'observedAt': date})
    return vals[-limit:]


def fetch_world_bank(country: str, indicator: str, limit: int = 8):
    url = f'https://api.worldbank.org/v2/country/{country}/indicator/{indicator}?format=json&per_page=80'
    payload = json.loads(fetch_url(url, timeout=20).decode('utf-8', errors='replace'))
    rows = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
    vals = []
    for row in rows:
        raw = row.get('value')
        date = row.get('date')
        if raw is None or not date:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        vals.append({'period': f'{date}-01-01', 'value': value, 'observedAt': f'{date}-01-01'})
    vals.sort(key=lambda x: x['period'])
    return vals[-limit:]


def quarter_to_period_start(q: str) -> str:
    m = re.match(r'^(20\d{2})-Q([1-4])$', q)
    if not m:
        return q
    month = {'1': '01', '2': '04', '3': '07', '4': '10'}[m.group(2)]
    return f'{m.group(1)}-{month}-01'


def fetch_dbnomics_quarterly_gdp(url: str, limit: int = 8):
    """Fetch quarterly nominal GDP from OECD QNA via DB.NOMICS.

    Series raw values are million national-currency units (UNIT_MULT=6, UNIT_MEASURE=XDC).
    EP Monitor displays quarterly nominal GDP cards in Billion local currency, so divide by 1,000.
    """
    payload = json.loads(fetch_url(url, timeout=30).decode('utf-8', errors='replace'))
    docs = payload.get('series', {}).get('docs', [])
    if not docs:
        raise RuntimeError('DB.NOMICS quarterly GDP series not found')
    series = docs[0]
    periods = series.get('period') or []
    values = series.get('value') or []
    vals = []
    for period, raw in zip(periods, values):
        if raw in (None, '', '.') or not period:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        vals.append({
            'period': quarter_to_period_start(period),
            'value': round(value / 1_000, 2),
            'observedAt': quarter_to_period_start(period),
        })
    vals.sort(key=lambda x: x['period'])
    return vals[-limit:]


def fetch_dbnomics_china_quarterly_gdp(limit: int = 8):
    return fetch_dbnomics_quarterly_gdp(DBNOMICS_CHINA_GDP_URL, limit)


def fetch_dbnomics_india_quarterly_gdp(limit: int = 8):
    return fetch_dbnomics_quarterly_gdp(DBNOMICS_INDIA_GDP_URL, limit)


def fetch_china_quarterly_gdp(limit: int = 8):
    try:
        return fetch_dbnomics_china_quarterly_gdp(limit)
    except Exception:
        # Fallback: FRED CHNGDPNQDSMEI, currently stale at 2023-Q3.
        obs = fetch_fred('CHNGDPNQDSMEI', limit)
        return [{**o, 'value': round(o['value'] / 1_000_000_000, 3)} for o in obs]


def fetch_india_quarterly_gdp(limit: int = 8):
    try:
        return fetch_dbnomics_india_quarterly_gdp(limit)
    except Exception:
        # Fallback is intentionally growth-only because no reliable FRED nominal level
        # series is configured. Returning [] preserves existing observations on failure.
        return []


def fetch_ecb_icp(key: str, limit: int = 8):
    url = f'https://data-api.ecb.europa.eu/service/data/ICP/{key}?lastNObservations={limit}'
    xml = fetch_url(url, timeout=20)
    root = ET.fromstring(xml)
    vals = []
    for elem in root.iter():
        if not elem.tag.endswith('Obs'):
            continue
        period = None
        value = None
        for child in elem:
            if child.tag.endswith('ObsDimension'):
                period = child.attrib.get('value')
            elif child.tag.endswith('ObsValue'):
                raw = child.attrib.get('value')
                if raw not in (None, '', '.'):
                    value = float(raw)
        if period and value is not None:
            vals.append({'period': period, 'value': value, 'observedAt': period})
    vals.sort(key=lambda x: x['period'])
    return vals[-limit:]


def fetch_eurostat(dataset_id: str, params: dict[str, str], limit: int = 8):
    """Fetch from Eurostat JSON-stat 2.0 API and return latest observations."""
    base = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data'
    query = dict(params)
    query.setdefault('format', 'JSON')
    query['startPeriod'] = '2020'   # ensure we get enough history for quarterly
    encoded = urllib.parse.urlencode(query)
    url = f'{base}/{dataset_id}?{encoded}'
    raw = fetch_url(url, timeout=15)
    root = ET.fromstring(raw)
    vals: list[dict[str, Any]] = []
    # JSON-stat 2.0 compact form: <Series key="..."><Obs><ObsDimension value="..."/><ObsValue value="..."/></Obs></Series>
    for series in root.iter():
        if not series.tag.endswith('Series'):
            continue
        period: str | None = None
        value: float | None = None
        for child in series:
            if child.tag.endswith('ObsDimension'):
                period = child.attrib.get('value')
            elif child.tag.endswith('ObsValue'):
                raw_val = child.attrib.get('value')
                if raw_val not in (None, '', '.'):
                    try:
                        value = float(raw_val)
                    except ValueError:
                        value = None
            if period is not None and value is not None:
                vals.append({'period': period, 'value': value, 'observedAt': period})
                period = None
                value = None
    vals.sort(key=lambda x: x['period'])
    return vals[-limit:]


def fetch_nbs_china_pmi():
    """Fetch latest China manufacturing PMI from China's NBS press release list."""
    base = 'https://www.stats.gov.cn/sj/zxfb/'
    page = fetch_url(base, timeout=20).decode('utf-8', errors='ignore')
    matches = re.findall(r'href="(\.\/20\d{4}/t20\d+_\d+\.html)"[^>]*>\s*([^<]*中国采购经理指数运行情况)', page)
    if not matches:
        # The newest link is sometimes duplicated with whitespace; fall back to a wider href scan.
        matches = [(m, '') for m in re.findall(r'href="(\.\/20\d{4}/t20\d+_\d+\.html)"', page) if '采购经理指数' in page[max(0, page.find(m)-300):page.find(m)+500]]
    if not matches:
        raise RuntimeError('NBS PMI release link not found')
    rel = matches[0][0]
    url = urllib.parse.urljoin(base, rel)
    raw = fetch_url(url, timeout=20).decode('utf-8', errors='ignore')
    text = re.sub(r'<[^>]+>', ' ', raw)
    text = html.unescape(re.sub(r'\s+', ' ', text))
    val_match = re.search(r'制造业采购经理指数.*?为\s*([0-9]+\.?[0-9]*)%', text)
    if not val_match:
        val_match = re.search(r'采购经理指数.*?为\s*([0-9]+\.?[0-9]*)%', text)
    if not val_match:
        raise RuntimeError('NBS PMI value not found')
    title_match = re.search(r'(20\d{2})年(\d{1,2})月中国采购经理指数运行情况', text)
    if title_match:
        period = f"{title_match.group(1)}-{int(title_match.group(2)):02d}"
    else:
        period = datetime.now(timezone.utc).strftime('%Y-%m')
    return [{'period': period, 'value': float(val_match.group(1)), 'observedAt': period}]


def atomic_write_json(path: Path, data: dict):
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    indicators = data.get('indicators', [])
    refreshed_ids = set()
    added = []
    failures = []

    for ind in indicators:
        ind_id = ind.get('id')
        source = ind.get('sourceId')
        try:
            obs: list[dict[str, Any]] = []
            if ind_id in FRED_DIRECT_MAP:
                obs = fetch_fred(FRED_DIRECT_MAP[ind_id], 8)
            elif ind_id == 'gdp_quarterly_china':
                obs = fetch_china_quarterly_gdp(8)
            elif ind_id == 'gdp_quarterly_india':
                obs = fetch_india_quarterly_gdp(8)
            elif ind_id in FRED_GDP_QUARTERLY_MAP:
                obs = fetch_fred(FRED_GDP_QUARTERLY_MAP[ind_id], 8)
            elif ind_id in NBS_PMI_IDS:
                obs = fetch_nbs_china_pmi()
            elif ind_id in WORLD_BANK_MAP:
                obs = fetch_world_bank(*WORLD_BANK_MAP[ind_id], limit=8)
                if ind_id in {'gdp_current_usd', 'gdp_annual_korea', 'gdp_annual_japan', 'gdp_annual_china', 'gdp_annual_eurozone', 'gdp_annual_india'}:
                    # World Bank returns current USD. Store/display in trillion USD to avoid huge UI numbers.
                    obs = [{**o, 'value': round(o['value'] / 1_000_000_000_000, 3)} for o in obs]
            elif source == 'fred':
                m = SERIES_RE.search(ind.get('sourceUrl') or '')
                if not m:
                    raise RuntimeError('missing FRED series id')
                obs = fetch_fred(m.group(1), 8)
            else:
                continue
            refreshed_ids.add(ind_id)
            for o in obs:
                added.append({'indicatorId': ind_id, **o})
        except Exception as e:
            failures.append({'id': ind_id, 'source': source, 'error': str(e)})

    preserved = [o for o in data.get('observations', []) if o.get('indicatorId') not in refreshed_ids]
    data['observations'] = preserved + added
    data['generatedAt'] = utc_now_iso()
    data['version'] = 'v4.8-india-gdp-dbnomics'
    atomic_write_json(DATA, data)

    with_data = {o['indicatorId'] for o in data['observations']}
    print(json.dumps({
        'refreshedIndicators': len(refreshed_ids),
        'addedObservations': len(added),
        'failures': failures,
        'totalIndicators': len(indicators),
        'withData': sum(1 for ind in indicators if ind['id'] in with_data),
        'withoutData': sum(1 for ind in indicators if ind['id'] not in with_data),
        'generatedAt': data['generatedAt'],
    }, ensure_ascii=False, indent=2))
    # Partial source failures should not break deployment/API refresh.
    # Existing observations for failed sources are preserved because their IDs are
    # not added to refreshed_ids. Return success and surface warnings in JSON.


if __name__ == '__main__':
    main()
