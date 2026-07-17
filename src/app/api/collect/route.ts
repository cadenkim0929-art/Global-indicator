import { NextResponse } from 'next/server';
import { collectFeeds, getStats, queryArticles, enrichWithTranslations, DEFAULT_LOOKBACK_DAYS } from '@/lib/news-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = process.env.COLLECT_SECRET;
  const supplied = request.headers.get('x-collect-secret');
  if (token && supplied !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const maxFeeds = body.maxFeeds ? Number(body.maxFeeds) : undefined;
  const perCategory = body.perCategory ? Number(body.perCategory) : undefined;
  const concurrency = body.concurrency ? Number(body.concurrency) : undefined;
  const result = await collectFeeds({
    maxFeeds,
    perCategory,
    concurrency,
    category: typeof body.category === 'string' ? body.category : undefined,
    balanced: Boolean(body.balanced),
  });
  // [v5.55] 수집 직후 첫 화면에 새 중·일문 기사가 원문으로 노출되지 않도록
  // visible slice 일부를 미리 번역 캐시한다. 홈 SSR에서는 maxTranslate=0을 유지해
  // 사용자 로딩 속도를 보호한다.
  await enrichWithTranslations(queryArticles({ limit: 120, days: DEFAULT_LOOKBACK_DAYS }), { maxTranslate: 12 });
  return NextResponse.json({ ok: true, result, stats: getStats() });
}

export async function GET() {
  return NextResponse.json({ message: 'Use POST /api/collect with optional {"maxFeeds": 10}.', stats: getStats() });
}
