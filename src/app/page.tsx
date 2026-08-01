import { getStats, queryArticles, enrichWithTranslations, DEFAULT_LOOKBACK_DAYS } from '@/lib/news-store';
import { getIndicatorCards, getIndicatorMeta, getFrequencyCounts } from '@/lib/indicator-store';
import Dashboard from './ui/dashboard';

export const dynamic = 'force-dynamic';

type HomeProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialPage = params.view === 'macro' ? 'macro' as const : 'feed' as const;
  const stats = getStats(DEFAULT_LOOKBACK_DAYS);
  // [v5.53] 첫 화면 성능: 카운트는 stats 기준으로 별도 표시하고, 카드 payload는
  // 최신 120건만 싣는다. 1000건 SSR은 HTML/JSON을 1MB 가까이 키워 TTFB를 늦춘다.
  const articles = await enrichWithTranslations(queryArticles({ limit: 120, days: DEFAULT_LOOKBACK_DAYS }), { maxTranslate: 0 });
  const indicatorCards = getIndicatorCards();
  const indicatorMeta = getIndicatorMeta();
  const indicatorCounts = getFrequencyCounts();
  return <Dashboard
    initialPage={initialPage}
    initialArticles={articles} initialStats={stats}
    initialIndicators={indicatorCards} initialIndicatorMeta={indicatorMeta} initialIndicatorCounts={indicatorCounts}
  />;
}
