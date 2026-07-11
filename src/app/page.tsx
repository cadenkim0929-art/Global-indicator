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
  const articles = await enrichWithTranslations(queryArticles({ limit: 500, days: DEFAULT_LOOKBACK_DAYS }));
  const indicatorCards = getIndicatorCards();
  const indicatorMeta = getIndicatorMeta();
  const indicatorCounts = getFrequencyCounts();
  return <Dashboard
    initialPage={initialPage}
    initialArticles={articles} initialStats={stats}
    initialIndicators={indicatorCards} initialIndicatorMeta={indicatorMeta} initialIndicatorCounts={indicatorCounts}
  />;
}
