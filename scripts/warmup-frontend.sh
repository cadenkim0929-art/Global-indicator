#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${EP_MONITOR_WARMUP_URL:-http://127.0.0.1:8766}"
LOG_FILE="${EP_MONITOR_WARMUP_LOG:-/home/ubuntu/.openclaw/workspace/ep-industry-monitor-web/data/warmup.log}"
mkdir -p "$(dirname "$LOG_FILE")"

# Wait for Next.js to accept connections, then warm the heavy SSR page and the default feed API.
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "$BASE_URL/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
  if [ "$i" = "30" ]; then
    echo "$(date -Is) warmup failed: server did not become ready" >> "$LOG_FILE"
    exit 0
  fi
done

{
  echo "$(date -Is) warmup start"
  curl -sS -o /dev/null -w "home total=%{time_total} ttfb=%{time_starttransfer} size=%{size_download}\n" --max-time 10 "$BASE_URL/" || true
  curl -sS -o /dev/null -w "api120 total=%{time_total} ttfb=%{time_starttransfer} size=%{size_download}\n" --max-time 10 "$BASE_URL/api/articles?days=90&limit=120" || true
  echo "$(date -Is) warmup done"
} >> "$LOG_FILE" 2>&1
