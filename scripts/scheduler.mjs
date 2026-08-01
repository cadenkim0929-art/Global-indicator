#!/usr/bin/env node
// scripts/scheduler.mjs
//
// 웹앱 안에 내장된 "크론잡" — Next.js는 요청을 처리하는 프레임워크라 API 라우트
// 안에서 setInterval/장기 타이머를 돌리는 건 권장되지 않는다(빌드마다 프로세스가
// 재시작될 수 있고, Next 공식 문서도 커스텀 서버를 권장하지 않음). 그래서 이 스크립트를
// `next start`와 나란히 떠 있는 별도의 상시 프로세스로 두고(systemd/pm2),
// node-cron으로 스케줄을 관리하면서 기존 API 라우트(/api/collect,
// /api/indicators/refresh)를 그대로 호출한다 — UI의 "뉴스 수집"/"지표 갱신" 버튼과
// 완전히 동일한 코드 경로라 로직 중복이나 결과 불일치 위험이 없다.
//
// 실행: node scripts/scheduler.mjs  (또는 `npm run scheduler`)
// 필요 env: BASE_URL, COLLECT_SECRET, INDICATORS_SECRET, *_CRON (아래 기본값 참고)

import cron from 'node-cron';

const BASE_URL = process.env.SCHEDULER_BASE_URL || 'http://127.0.0.1:8766';
const COLLECT_CRON = process.env.SCHEDULER_COLLECT_CRON || '0 7,12,18 * * *';  // 매일 07:00/12:00/18:00 KST
const INDICATORS_CRON = process.env.SCHEDULER_INDICATORS_CRON || '50 6 * * *';  // 매일 06:50 KST
const TIMEZONE = process.env.SCHEDULER_TIMEZONE || 'Asia/Seoul';
const COLLECT_SECRET = process.env.COLLECT_SECRET || '';
const INDICATORS_SECRET = process.env.INDICATORS_SECRET || '';

// 실행 하나가 다음 스케줄 시각까지 안 끝났을 때 중복 실행되는 것을 막는 가드.
// (지표 갱신은 파이썬 스크립트 4개를 순차 실행하며 최대 300초까지 걸릴 수 있음)
const inProgress = { collect: false, indicators: false };

function nowLabel() {
  return new Date().toLocaleString('ko-KR', { timeZone: TIMEZONE, hour12: false });
}

async function callWithTimeout(path, { method = 'POST', headers = {}, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function runCollect() {
  if (inProgress.collect) {
    console.log(`[${nowLabel()}] [scheduler] 뉴스 수집: 이전 실행이 아직 진행 중 — 이번 회차 스킵`);
    return;
  }
  inProgress.collect = true;
  const startedAt = Date.now();
  console.log(`[${nowLabel()}] [scheduler] 뉴스 수집 시작`);
  try {
    const headers = COLLECT_SECRET ? { 'x-collect-secret': COLLECT_SECRET } : {};
    const { ok, status, json } = await callWithTimeout('/api/collect', {
      headers,
      timeoutMs: 55_000, // API route의 maxDuration(60s)보다 살짝 여유 있게 짧게
    });
    const ms = Date.now() - startedAt;
    if (ok) {
      console.log(`[${nowLabel()}] [scheduler] 뉴스 수집 완료 (${ms}ms) — ${JSON.stringify(json.result || {})}`);
    } else {
      console.error(`[${nowLabel()}] [scheduler] 뉴스 수집 실패 (${ms}ms) status=${status} — ${JSON.stringify(json)}`);
    }
  } catch (err) {
    console.error(`[${nowLabel()}] [scheduler] 뉴스 수집 오류: ${err.message}`);
  } finally {
    inProgress.collect = false;
  }
}

async function runIndicatorsRefresh() {
  if (inProgress.indicators) {
    console.log(`[${nowLabel()}] [scheduler] 지표 갱신: 이전 실행이 아직 진행 중 — 이번 회차 스킵`);
    return;
  }
  inProgress.indicators = true;
  const startedAt = Date.now();
  console.log(`[${nowLabel()}] [scheduler] 지표 갱신 시작`);
  try {
    const headers = INDICATORS_SECRET ? { 'x-indicators-secret': INDICATORS_SECRET } : {};
    const { ok, status, json } = await callWithTimeout('/api/indicators/refresh', {
      headers,
      timeoutMs: 290_000, // API route의 maxDuration(300s)보다 살짝 여유 있게 짧게
    });
    const ms = Date.now() - startedAt;
    if (ok) {
      console.log(`[${nowLabel()}] [scheduler] 지표 갱신 완료 (${ms}ms) — ${json.meta ? JSON.stringify(json.meta) : ''}`);
    } else {
      console.error(`[${nowLabel()}] [scheduler] 지표 갱신 실패 (${ms}ms) status=${status} — ${JSON.stringify(json)}`);
    }
  } catch (err) {
    console.error(`[${nowLabel()}] [scheduler] 지표 갱신 오류: ${err.message}`);
  } finally {
    inProgress.indicators = false;
  }
}

if (!cron.validate(COLLECT_CRON)) throw new Error(`잘못된 SCHEDULER_COLLECT_CRON: ${COLLECT_CRON}`);
if (!cron.validate(INDICATORS_CRON)) throw new Error(`잘못된 SCHEDULER_INDICATORS_CRON: ${INDICATORS_CRON}`);

cron.schedule(COLLECT_CRON, runCollect, { timezone: TIMEZONE });
cron.schedule(INDICATORS_CRON, runIndicatorsRefresh, { timezone: TIMEZONE });

console.log(`[${nowLabel()}] [scheduler] 시작됨 — base=${BASE_URL} tz=${TIMEZONE}`);
console.log(`[${nowLabel()}] [scheduler]   뉴스 수집:  "${COLLECT_CRON}"`);
console.log(`[${nowLabel()}] [scheduler]   지표 갱신:  "${INDICATORS_CRON}"`);
if (!COLLECT_SECRET) console.warn(`[${nowLabel()}] [scheduler] 경고: COLLECT_SECRET 미설정 — /api/collect가 인증 없이 열려있다면 그대로 호출됨`);
if (!INDICATORS_SECRET) console.warn(`[${nowLabel()}] [scheduler] 경고: INDICATORS_SECRET 미설정 — /api/indicators/refresh가 인증 없이 열려있다면 그대로 호출됨`);

// 프로세스가 살아있는 한 계속 대기 (systemd/pm2가 죽으면 재시작해줌)
process.on('SIGTERM', () => { console.log(`[${nowLabel()}] [scheduler] SIGTERM 수신, 종료`); process.exit(0); });
process.on('SIGINT', () => { console.log(`[${nowLabel()}] [scheduler] SIGINT 수신, 종료`); process.exit(0); });
