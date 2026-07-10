import { getStats, queryArticles, enrichWithTranslations, DEFAULT_LOOKBACK_DAYS } from '@/lib/news-store';
import { getIndicatorCards, getIndicatorMeta, getFrequencyCounts } from '@/lib/indicator-store';
import Dashboard from './ui/dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const stats = getStats(DEFAULT_LOOKBACK_DAYS);
  const articles = await enrichWithTranslations(queryArticles({ limit: 500, days: DEFAULT_LOOKBACK_DAYS }));
  const indicatorCards = getIndicatorCards();
  const indicatorMeta = getIndicatorMeta();
  const indicatorCounts = getFrequencyCounts();
  return <Dashboard
    initialArticles={articles} initialStats={stats}
    initialIndicators={indicatorCards} initialIndicatorMeta={indicatorMeta} initialIndicatorCounts={indicatorCounts}
  />;
}
