#!/usr/bin/env python3
"""No-op derived indicator maintenance.

v3.8: proxy/trend indicator cards were removed from the macro catalog.
Keep this script in the refresh chain for backward compatibility, but do not
create derived observations anymore.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

DATA = Path('/home/ubuntu/.openclaw/workspace/ep-industry-monitor-web/src/data/indicators.json')
REMOVED_DERIVED_IDS = {
    'monthly_brent_trend',
    'quarterly_brent_trend',
    'quarterly_usdkrw_trend',
    'monthly_us_industrials_proxy',
    'quarterly_us_industrials_proxy',
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    before = len(data.get('observations', []))
    data['observations'] = [
        o for o in data.get('observations', [])
        if o.get('indicatorId') not in REMOVED_DERIVED_IDS
    ]
    removed = before - len(data['observations'])
    data['generatedAt'] = utc_now_iso()
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    with_data = {o['indicatorId'] for o in data['observations']}
    print(json.dumps({
        'derivedIndicators': 0,
        'addedObservations': 0,
        'removedLegacyProxyObservations': removed,
        'skipped': [],
        'withData': sum(1 for ind in data['indicators'] if ind['id'] in with_data),
        'withoutData': sum(1 for ind in data['indicators'] if ind['id'] not in with_data),
        'generatedAt': data['generatedAt'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
