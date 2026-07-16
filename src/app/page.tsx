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
  // [v5.39] 재무리스크처럼 빈도는 낮지만 중요한 카테고리가 최신 500건 밖으로
  // 밀리면 탭은 보이는데 카드가 없는 불일치가 생긴다. 기본 로드를 1000건으로 확대한다.
  const articles = await enrichWithTranslations(queryArticles({ limit: 1000, days: DEFAULT_LOOKBACK_DAYS }), { maxTranslate: 0 });
  const indicatorCards = getIndicatorCards();
  const indicatorMeta = getIndicatorMeta();
  const indicatorCounts = getFrequencyCounts();
  return <Dashboard
    initialPage={initialPage}
    initialArticles={articles} initialStats={stats}
    initialIndicators={indicatorCards} initialIndicatorMeta={indicatorMeta} initialIndicatorCounts={indicatorCounts}
  />;
}
