import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { clearIndicatorCache, getFrequencyCounts, getIndicatorCards, getIndicatorMeta } from '@/lib/indicator-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

export async function POST() {
  const refreshScript = path.join(process.cwd(), 'scripts', 'update_indicators_all.py');
  const industrialProductionScript = path.join(process.cwd(), 'scripts', 'update_industrial_production_intl.py');
  const deriveScript = path.join(process.cwd(), 'scripts', 'derive_indicator_proxies.py');
  const tePmiScript = path.join(process.cwd(), 'scripts', 'update_pmi_tradingeconomics.py');
  const pmiScript = path.join(process.cwd(), 'scripts', 'extract_pmi_from_news.py');
  try {
    const refresh = await execFileAsync('python3', [refreshScript], {
      cwd: process.cwd(),
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
    const industrialProduction = await execFileAsync('python3', [industrialProductionScript], {
      cwd: process.cwd(),
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const derive = await execFileAsync('python3', [deriveScript], {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    // [v5.8] 국가별 제조업 PMI — TradingEconomics 공개 웹 meta description에서
    // 한국/미국/일본/인도/유로존 값을 보강. 뉴스 추출 PMI보다 우선한다.
    const tePmi = await execFileAsync('python3', [tePmiScript], {
      cwd: process.cwd(),
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    });
    // [v4.12] PMI 뉴스 추출 — 수집된 기사에서 제조업 PMI 수치를 보수적으로
    // 추출해 지표로 적재(공개 수치 API가 없는 국가들의 월간 수요 축 보강).
    const pmi = await execFileAsync('python3', [pmiScript], {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(refresh.stdout || '{}');
    const industrialProductionSummary = (() => {
      const lines = industrialProduction.stdout.trim().split('\n').filter(Boolean);
      const last = lines[lines.length - 1] || '{}';
      return JSON.parse(last);
    })();
    const derived = JSON.parse(derive.stdout || '{}');
    const pmiSummary = (() => {
      const lines = pmi.stdout.trim().split('\n').filter(Boolean);
      return JSON.parse(lines[lines.length - 1] || '{}');
    })();
    const tePmiSummary = JSON.parse(tePmi.stdout || '{}');
    clearIndicatorCache();
    return NextResponse.json({
      ok: true,
      result: { ...parsed, industrialProduction: industrialProductionSummary, derived, tePmi: tePmiSummary, pmi: pmiSummary },
      stderr: [refresh.stderr, industrialProduction.stderr, derive.stderr, tePmi.stderr, pmi.stderr].filter(Boolean).join('\n') || undefined,
      cards: getIndicatorCards(),
      meta: getIndicatorMeta(),
      counts: getFrequencyCounts(),
    });
  } catch (error) {
    const anyError = error as Error & { stdout?: string; stderr?: string; code?: number };
    return NextResponse.json({
      ok: false,
      error: anyError.message,
      code: anyError.code,
      stdout: anyError.stdout,
      stderr: anyError.stderr,
    }, { status: 500 });
  }
}
