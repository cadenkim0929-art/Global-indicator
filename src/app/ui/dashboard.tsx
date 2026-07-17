'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Sparkline from './indicator-sparkline';
import type { Article, IndicatorCard, IndicatorFrequency } from '@/lib/types';
import { categoryLabelFor, countryLabelFor, displayArticleTitle, formatDate, impactBadgeFor, indicatorNameFor, isTodayKst, rankByScoreThenDate, shortDate, buildKeywordList, sourceNameFor, tagLabelFor, t } from './format-utils';
import type { PageKey, SortKey, UiLang } from './format-utils';
import FeedHeader from './feed/feed-header';
import FeedCategoryTabs from './feed/feed-filters';
import FeedHero from './feed/feed-hero';
import FeedCard from './feed/feed-card';
import FeedSidePanel from './feed/feed-side-panel';

export interface Stats {
  totalArticles: number;
  filteredArticles: number;
  totalFeeds: number;
  counts: Array<{ category: string; label?: string; count: number; feeds: number }>;
  lastCollectedAt: string | null;
  topTags: Array<{ tag: string; count: number }>;
  categories?: Array<{ id: string; label: string; color: string }>;
  lookbackDays?: number;
}
interface IndicatorMeta { version: string; generatedAt: string; totalIndicators: number }

const LANGUAGE_LABELS: Record<string, string> = { ko: '한', en: '영', ja: '일', zh: '중', de: '독', other: '기타' };
// [v1.3] Daily/Weekly/Archive 3분할을 폐지하고 하나의 연속 피드 + 기간 프리셋으로 통합.
// 이메일 다이제스트의 발송 주기 개념을 그대로 옮겨온 구분이라 웹 대시보드에선 실익이
// 없었음(받은편지함 관리 문제가 없으므로) — 대신 "지금 얼마나 거슬러 볼지"를 그때그때
// 바꾸는 게 실제 사용 패턴에 가까움.
const PERIOD_PRESETS = [
  { label: '오늘', days: 1 },
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
  { label: '최근 180일', days: 180 },
  { label: '전체', days: 365 },
];
// [v4.0] 데이터 주기(daily/monthly/quarterly/yearly)는 내부 메타로 유지하되,
// 사용자 화면은 의사결정 시간축인 단기/중기/장기 3단으로 재프레이밍.
// - 단기: daily market tape (환율·유가·금리)
// - 중기: monthly operating pulse (산업생산·CPI·PMI)
// - 장기: quarterly/yearly growth frame (GDP)
type IndicatorHorizon = 'now' | 'recent' | 'long';
const HORIZON_TABS: Array<{ key: IndicatorHorizon; label: string; frequencies: IndicatorFrequency[] }> = [
  { key: 'now', label: '단기', frequencies: ['daily'] },
  { key: 'recent', label: '중기', frequencies: ['monthly'] },
  { key: 'long', label: '장기', frequencies: ['quarterly', 'yearly'] },
];
function indicatorHorizon(ind: IndicatorCard): IndicatorHorizon {
  if (ind.frequency === 'daily') return 'now';
  if (ind.frequency === 'monthly') return 'recent';
  return 'long';
}
function horizonCount(counts: Record<IndicatorFrequency, number>, horizon: IndicatorHorizon) {
  if (horizon === 'long') {
    // 장기 화면은 분기/연간을 따로 세지 않고 국가별 GDP 묶음으로 표시한다.
    // 현재 국가/권역 묶음: 미국·한국·일본·중국·유로존·인도 = 6개.
    return 6;
  }
  const tab = HORIZON_TABS.find((x) => x.key === horizon);
  return tab ? tab.frequencies.reduce((sum, f) => sum + (counts[f] || 0), 0) : 0;
}
const GDP_COUNTRY_ORDER = ['us', 'korea', 'japan', 'china', 'eurozone', 'india'];
const GDP_COUNTRY_FLAGS: Record<string, string> = {
  us: '🇺🇸', korea: '🇰🇷', japan: '🇯🇵', china: '🇨🇳', eurozone: '🇪🇺', india: '🇮🇳',
};
function gdpCountry(id: string) {
  if (id.includes('korea')) return 'korea';
  if (id.includes('japan')) return 'japan';
  if (id.includes('india')) return 'india';
  if (id.includes('china')) return 'china';
  if (id.includes('eurozone')) return 'eurozone';
  if (id.includes('_us') || id.endsWith('_usd')) return 'us';
  return id;
}
type IndicatorImpactBadge = { label: string; tone: 'ep' | 'raw' | 'demand' | 'macro'; title: string };
function indicatorImpactBadge(ind: Pick<IndicatorCard, 'id' | 'category' | 'epRelevant' | 'frequency'>): IndicatorImpactBadge {
  if (ind.id.startsWith('oil_')) return { label: '원료', tone: 'raw', title: '원유·나프타·feedstock 원가 방향성' };
  if (ind.id.startsWith('industrial_production_') || ind.id.includes('pmi')) return { label: '수요', tone: 'demand', title: '전방 제조업·산업생산 수요 신호' };
  if (ind.id.startsWith('gdp_quarterly_') || ind.id.startsWith('gdp_qoq_')) return { label: '수요', tone: 'demand', title: '분기 GDP 기반 전방수요·경기 신호' };
  if (ind.id.startsWith('fx_')) return { label: 'EP', tone: 'ep', title: 'EP 수출·원가·마진에 직접 영향이 큰 환율 지표' };
  if (ind.epRelevant) return { label: 'EP', tone: 'ep', title: 'EP 산업과 직접 관련된 우선 지표' };
  return { label: '거시', tone: 'macro', title: '금리·물가·연간 GDP 등 거시 참고 지표' };
}
function formatIndicatorValue(value: number | null, unit?: string) {
  if (value === null) return '—';
  const maxDigits = unit?.toLowerCase().includes('trillion') ? 2 : 4;
  return value.toLocaleString('ko-KR', { maximumFractionDigits: maxDigits });
}
function compactIndicatorName(name: string) {
  return name
    .replace(/\(FRED\)/gi, '')
    .replace(/\([^)]*(뉴스 추출|국가통계국)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function editorialHeadline(title: string, sourceName?: string) {
  let result = title.replace(/^\[매크로\]\s*/, '').trim();
  if (sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\s[-–—|]\\s${escaped}\\s*$`, 'i'), '').trim();
  }
  // 긴 RSS 제목 뒤에 붙는 영문 매체명·프로그램명은 메타 영역에서 이미 보여주므로 제거한다.
  result = result.replace(/\s[-–—|]\s[A-Za-z0-9][A-Za-z0-9 .&'’/()-]{2,40}$/u, '').trim();
  if (result.length > 44) {
    const boundary = result.lastIndexOf(' ', 44);
    result = `${result.slice(0, boundary >= 30 ? boundary : 44).trim()}…`;
  }
  return result;
}
// [v4.10] GDP 수준(level) 지표들의 단위가 소스마다 제각각(Million KRW /
// Billion chained 2017 USD / Million chained 2010 EUR / Trillion USD)이라
// 한눈에 비교가 안 되던 문제 — 전부 "조" 스케일 + 통화명으로 통일해서 표시.
// 원시 단위는 title 툴팁으로만 보존.
function gdpLevelDisplay(ind: IndicatorCard, lang: UiLang = 'ko'): { text: string; unitLabel: string } | null {
  if (ind.latestValue === null) return null;
  const u = (ind.unit || '').toLowerCase();
  let v: number | null = null; let cur = '';
  if (/million\s+krw/.test(u)) { v = ind.latestValue / 1e6; cur = t(lang, '조 원', 'tn KRW'); }
  else if (/million\s+jpy/.test(u)) { v = ind.latestValue / 1e6; cur = t(lang, '조 엔', 'tn JPY'); }
  else if (/million.*eur/.test(u)) { v = ind.latestValue / 1e6; cur = t(lang, '조 유로', 'tn EUR'); }
  else if (/billion\s+cny/.test(u)) { v = ind.latestValue / 1e3; cur = t(lang, '조 위안', 'tn CNY'); }
  else if (/billion\s+inr/.test(u)) { v = ind.latestValue / 1e3; cur = t(lang, '조 루피', 'tn INR'); }
  else if (/billion.*(usd|dollar)/.test(u)) { v = ind.latestValue / 1e3; cur = t(lang, '조 달러', 'tn USD'); }
  else if (/trillion\s+usd/.test(u)) { v = ind.latestValue; cur = t(lang, '조 달러', 'tn USD'); }
  if (v === null) return { text: formatIndicatorValue(ind.latestValue, ind.unit), unitLabel: ind.unit };
  const text = Math.abs(v) >= 100 ? v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  return { text, unitLabel: cur };
}
function formatIndicatorPeriod(ind?: Pick<IndicatorCard, 'frequency' | 'latestPeriod'>) {
  if (!ind?.latestPeriod) return '수집 전';
  if (ind.frequency === 'yearly') return ind.latestPeriod.slice(0, 4);
  if (ind.frequency === 'quarterly') {
    const year = ind.latestPeriod.slice(0, 4);
    const month = Number(ind.latestPeriod.slice(5, 7));
    if (Number.isFinite(month) && month > 0) return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
  if (ind.frequency === 'monthly') return ind.latestPeriod.slice(0, 7);
  return ind.latestPeriod;
}

function sourceRegion(name: string, lang: UiLang = 'ko') {
  if (/[가-힣]|\.kr|korea/i.test(name)) return t(lang, '한국', 'Korea');
  if (/china|\.cn|中国|財聯社|财联社|cailian/i.test(name)) return t(lang, '중국', 'China');
  if (/[ぁ-ヿ一-龯]|japan|\.jp/i.test(name)) return t(lang, '일본', 'Japan');
  if (/eu|europe|\.de|\.fr|\.uk/i.test(name)) return t(lang, '유럽', 'Europe');
  if (/us|america|\.com/i.test(name)) return t(lang, '미국', 'United States');
  return t(lang, '기타', 'Other');
}
function isMacroArticle(article: Pick<Article, 'category' | 'title'>) {
  return article.category === 'macro-trade' || article.title.startsWith('[매크로]');
}
function stripMacroPrefix(title: string) {
  return title.replace(/^\[매크로\]\s*/, '').trim();
}

export default function Dashboard({
  initialArticles, initialStats, initialIndicators, initialIndicatorMeta, initialIndicatorCounts, initialPage = 'feed',
}: {
  initialArticles: Article[]; initialStats: Stats;
  initialIndicators: IndicatorCard[]; initialIndicatorMeta: IndicatorMeta; initialIndicatorCounts: Record<IndicatorFrequency, number>;
  initialPage?: PageKey;
}) {
  const [articles, setArticles] = useState(initialArticles);
  const [stats, setStats] = useState(initialStats);
  const [page, setPage] = useState<PageKey>(initialPage);
  const [days, setDays] = useState(initialStats.lookbackDays ?? 90);
  const [customDays, setCustomDays] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(false);

  // [피드 리디자인] 고급 필터(언어/최소 Impact) 서랍 토글, 일반 기사 그리드의
  // "더 보기" 표시 개수. 필터가 바뀌면 12개로 리셋해서 항상 첫 페이지부터 보여준다.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  // [v1.0] Global Indicators 통합 — 매크로 지표 상태
  const [allIndicators, setAllIndicators] = useState(initialIndicators);
  const [indicatorMeta, setIndicatorMeta] = useState(initialIndicatorMeta);
  const [indicatorCounts, setIndicatorCounts] = useState(initialIndicatorCounts);
  const [indicatorHorizonKey, setIndicatorHorizonKey] = useState<IndicatorHorizon>('now');
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [reportTab, setReportTab] = useState<'daily' | 'weekly' | 'monthly' | 'theme'>('daily');
  const [uiLang, setUiLang] = useState<UiLang>(() => {
    if (typeof window === 'undefined') return 'ko';
    const saved = window.localStorage.getItem('ep-monitor-ui-lang');
    return saved === 'en' ? 'en' : 'ko';
  });
  function changeUiLang(next: UiLang) {
    setUiLang(next);
    window.localStorage.setItem('ep-monitor-ui-lang', next);
  }


  async function loadIndicators() {
    setIndicatorLoading(true);
    try {
      const res = await fetch(`/api/indicators?ts=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      const cards = (data.cards || []) as IndicatorCard[];
      setAllIndicators(cards);
      setIndicatorMeta(data.meta);
      setIndicatorCounts(data.counts);
    } finally { setIndicatorLoading(false); }
  }
  function changeIndicatorHorizon(horizon: IndicatorHorizon) {
    setIndicatorHorizonKey(horizon);
    loadIndicators();
  }


  const categories = stats.categories || [];
  const categoryById = useMemo(() => new Map((stats.categories || []).map((c) => [c.id, c])), [stats.categories]);
  const epArticles = useMemo(() => articles.filter((a) => !isMacroArticle(a)), [articles]);
  const macroArticles = useMemo(() => articles.filter(isMacroArticle), [articles]);
  const statsCount = (category: string) => stats.counts.find((row) => row.category === category)?.count || 0;
  const macroTotalCount = statsCount('macro-trade') || macroArticles.length;
  const epTotalCount = Math.max(0, (stats.counts.find((row) => row.category === '전체')?.count || stats.filteredArticles || articles.length) - macroTotalCount);
  const epCounts = useMemo(() => {
    return stats.counts.map((row) => row.category === '전체'
      ? { ...row, count: epTotalCount }
      : row).filter((row) => row.category === '전체' || row.category !== 'macro-trade');
  }, [epTotalCount, stats.counts]);
  const macroCount = macroTotalCount;
  const visibleCategories = categories.filter((c) =>
    // [v5.39] 카테고리 탭 노출은 현재 클라이언트에 로드된 기사 subset이 아니라
    // 서버 stats.counts 기준으로 판단한다. 재무리스크처럼 빈도는 낮지만 중요한 레인은
    // 최신 limit 안에 대표 카드가 없더라도 탭/빠른필터가 보여야 한다.
    c.id !== 'macro-trade' && ((stats.counts.find((x) => x.category === c.id)?.count || 0) > 0 || selectedCategories.includes(c.id))
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = epArticles.filter((a) => {
      if (selectedCategories.length && !selectedCategories.includes(a.category)) return false;
      if (selectedLanguages.length && !selectedLanguages.includes(a.language || 'other')) return false;
      if ((a.score || 0) < minScore) return false;
      if (q && !`${a.title} ${a.titleKo || ''} ${a.titleEn || ''} ${a.summary} ${a.summaryKo || ''} ${a.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'score') return (b.score || 0) - (a.score || 0);
      if (sort === 'category') return a.category.localeCompare(b.category) || +new Date(b.publishedAt) - +new Date(a.publishedAt);
      return +new Date(b.publishedAt) - +new Date(a.publishedAt);
    });
  }, [epArticles, selectedCategories, selectedLanguages, minScore, query, sort]);

  // [피드 리디자인] 대표 기사(오늘의 핵심 인사이트)와 "오늘의 브리프"는 사용자가 고른
  // 정렬(sort) 기준과 무관하게 항상 score→최신순으로 뽑는다(섹션9 데이터 매핑 규칙).
  // 일반 기사 그리드는 계속 사용자가 고른 sort 기준(filtered)을 따른다.
  const scoreRanked = useMemo(() => rankByScoreThenDate(filtered), [filtered]);
  const heroArticle = scoreRanked[0] || null;
  const briefItems = useMemo(
    () => scoreRanked.filter((a) => a.id !== heroArticle?.id).slice(0, 4),
    [scoreRanked, heroArticle],
  );
  const generalArticles = useMemo(
    () => filtered.filter((a) => a.id !== heroArticle?.id),
    [filtered, heroArticle],
  );
  const visibleGeneralArticles = generalArticles.slice(0, visibleCount);
  const isDefaultFeedFilter = selectedCategories.length === 0 && selectedLanguages.length === 0 && minScore === 0 && query.trim() === '';
  const displayedResultCount = isDefaultFeedFilter ? epTotalCount : filtered.length;
  const keywordList = useMemo(
    () => buildKeywordList(stats.topTags, filtered, 10),
    [stats.topTags, filtered],
  );

  const feedCounts = useMemo(() => {
    const map = new Map<string, { count: number; region: string; type: string }>();
    epArticles.forEach((a) => {
      const name = a.sourceName || a.feedName;
      const existing = map.get(name) || { count: 0, region: sourceRegion(name, uiLang), type: categoryLabelFor(categoryById.get(a.category)?.label || a.category, uiLang) };
      existing.count += 1;
      map.set(name, existing);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [epArticles, categoryById, uiLang]);

  const reportModel = useMemo(() => {
    const validArticles = articles.filter((a) => Number.isFinite(+new Date(a.publishedAt)));
    const anchor = validArticles.reduce((max, a) => Math.max(max, +new Date(a.publishedAt)), 0);
    const rangeArticles = (rangeDays: number) => validArticles.filter((a) => anchor > 0 && anchor - +new Date(a.publishedAt) <= rangeDays * 86400000);
    const makeReport = (rangeDays: number) => {
      const scope = rangeArticles(rangeDays).filter((a) => !isMacroArticle(a));
      const topArticles = rankByScoreThenDate(scope).slice(0, 6);
      const categoryMap = new Map<string, { label: string; count: number; scoreSum: number }>();
      const tagMap = new Map<string, number>();
      const sourceMap = new Map<string, number>();
      scope.forEach((a) => {
        const meta = categoryById.get(a.category);
        const row = categoryMap.get(a.category) || { label: meta?.label || a.category, count: 0, scoreSum: 0 };
        row.count += 1; row.scoreSum += a.score || 0; categoryMap.set(a.category, row);
        (a.tags || []).forEach((t) => { if (t && t.length <= 18) tagMap.set(t, (tagMap.get(t) || 0) + 1); });
        const src = a.sourceName || a.feedName || 'Unknown';
        sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
      });
      const categoryRows = Array.from(categoryMap.entries())
        .map(([id, v]) => ({ id, ...v, avgScore: v.count ? Math.round(v.scoreSum / v.count) : 0 }))
        .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore);
      const indicatorMovers = [...allIndicators]
        // 보고서 변동 랭킹에서는 GDP 계열 전체를 제외한다. GDP level은 단위·계절성,
        // GDP growth는 '성장률 값의 증감률'이라 보고서 신호를 왜곡할 수 있다.
        .filter((ind) => ind.latestValue !== null && ind.pctChange !== null)
        .filter((ind) => !ind.id.startsWith('gdp_'))
        .sort((a, b) => Math.abs(b.pctChange || 0) - Math.abs(a.pctChange || 0))
        .slice(0, 6);
      return {
        rangeDays,
        articles: scope,
        topArticles,
        categoryRows,
        topTags: Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
        topSources: Array.from(sourceMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
        highImpact: scope.filter((a) => (a.score || 0) >= 80).length,
        avgScore: scope.length ? Math.round(scope.reduce((sum, a) => sum + (a.score || 0), 0) / scope.length) : 0,
        indicatorMovers,
      };
    };
    const themeRows = (stats.categories || []).map((cat) => {
      const scope = validArticles.filter((a) => !isMacroArticle(a) && a.category === cat.id);
      const top = rankByScoreThenDate(scope).slice(0, 3);
      return { ...cat, count: scope.length, avgScore: scope.length ? Math.round(scope.reduce((sum, a) => sum + (a.score || 0), 0) / scope.length) : 0, top };
    }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count || b.avgScore - a.avgScore).slice(0, 8);
    return {
      generatedAt: anchor ? new Date(anchor).toISOString() : null,
      daily: makeReport(1), weekly: makeReport(7), monthly: makeReport(30), themeRows,
    };
  }, [articles, allIndicators, categoryById, stats.categories]);

  async function refresh(nextDays = days, nextQuery = query) {
    setLoading(true);
    try {
      const q = nextQuery.trim();
      // Search mode favors recall: query the server with a wider lookback and
      // larger limit instead of filtering only the already-loaded feed page.
      const effectiveDays = q ? Math.max(nextDays, 730) : nextDays;
      const params = new URLSearchParams({ limit: q ? '1000' : '120', days: String(effectiveDays) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/articles?${params.toString()}`);
      const data = await res.json();
      setArticles(data.articles);
      setStats(data.stats);
    } finally { setLoading(false); }
  }

  function handleFeedQueryChange(value: string) {
    setQuery(value);
    setVisibleCount(12);
    void refresh(days, value);
  }

  function toggle(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }
  function changePeriod(nextDays: number) {
    setDays(nextDays);
    setCustomDays(!PERIOD_PRESETS.some((p) => p.days === nextDays));
    refresh(nextDays);
  }

  const indicators = allIndicators.filter((c) => indicatorHorizon(c) === indicatorHorizonKey);
  const longGdpGroups = useMemo(() => {
    const longCards = allIndicators.filter((c) => indicatorHorizon(c) === 'long');
    const byCountry = new Map<string, {
      country: string;
      quarterly?: IndicatorCard;
      annual?: IndicatorCard;
      quarterlyGrowth?: IndicatorCard;
      annualGrowth?: IndicatorCard;
    }>();
    longCards.forEach((ind) => {
      if (!ind.id.startsWith('gdp_') && ind.id !== 'gdp_current_usd') return;
      const country = gdpCountry(ind.id);
      const group = byCountry.get(country) || { country };
      if (ind.id.startsWith('gdp_quarterly_')) group.quarterly = ind;
      else if (ind.id.startsWith('gdp_annual_') || ind.id === 'gdp_current_usd') group.annual = ind;
      else if (ind.id.startsWith('gdp_qoq_') && ind.frequency === 'quarterly') group.quarterlyGrowth = ind;
      else if (ind.id.startsWith('gdp_qoq_') && ind.frequency === 'yearly') group.annualGrowth = ind;
      byCountry.set(country, group);
    });
    return Array.from(byCountry.values())
      .filter((g) => g.quarterly || g.annual || g.quarterlyGrowth || g.annualGrowth)
      .sort((a, b) => GDP_COUNTRY_ORDER.indexOf(a.country) - GDP_COUNTRY_ORDER.indexOf(b.country));
  }, [allIndicators]);

  // [v5.3] 시안 반영 — "오늘의 인사이트" 단일 배너를 여러 건 순환하는
  // 캐러셀로 확장(1/6 페이지네이션). 최근 매크로 뉴스 중 지표와 연결된
  // 것을 최신순으로 최대 6건 추출.
  const macroHighlights = useMemo(() => {
    const seen = new Set<string>();
    return indicators
      .flatMap((indicator) => indicator.relatedNews.map((news) => ({ indicator, news })))
      .filter(({ news }) => {
        const key = news.link || news.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => +new Date(b.news.publishedAt) - +new Date(a.news.publishedAt))
      .slice(0, 6);
  }, [indicators]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  // useEffect로 setState하는 대신, 렌더링 중 안전 범위로 clamp — 목록 길이가
  // 줄어들어(indicators 갱신 등) 이전 인덱스가 범위를 벗어나도 항상 유효한
  // 항목을 가리키게 함.
  const safeHighlightIdx = macroHighlights.length > 0 ? highlightIdx % macroHighlights.length : 0;
  const macroHighlight = macroHighlights[safeHighlightIdx] || null;
  const macroNewsCards = useMemo(() => rankByScoreThenDate(macroArticles).slice(0, 12), [macroArticles]);
  const macroNewsSources = useMemo(() => {
    const map = new Map<string, number>();
    macroArticles.forEach((a) => map.set(a.sourceName || a.feedName, (map.get(a.sourceName || a.feedName) || 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [macroArticles]);

  const mediumIndicatorGroups = useMemo(() => {
    if (indicatorHorizonKey !== 'recent') return [];
    const groups = [
      {
        key: 'industrial-production',
        title: t(uiLang, '산업생산지수', 'Industrial Production'),
        description: t(uiLang, '제조·광공업 활동의 실제 생산 흐름', 'Actual manufacturing and mining production flow'),
        items: indicators.filter((ind) => ind.id.startsWith('industrial_production_')),
      },
      {
        key: 'pmi',
        title: 'PMI',
        description: t(uiLang, '구매관리자 설문 기반 경기 선행 신호', 'Forward cycle signal from purchasing manager surveys'),
        items: indicators.filter((ind) => ind.id.startsWith('pmi_')),
      },
      {
        key: 'inflation',
        title: t(uiLang, '물가', 'Inflation'),
        description: t(uiLang, '원가·금리 환경을 좌우하는 인플레이션 지표', 'Inflation indicators shaping cost and rate conditions'),
        items: indicators.filter((ind) => ind.id.startsWith('cpi_')),
      },
    ];
    const assigned = new Set(groups.flatMap((group) => group.items.map((ind) => ind.id)));
    const others = indicators.filter((ind) => !assigned.has(ind.id));
    if (others.length) {
      groups.push({
        key: 'other-medium',
        title: t(uiLang, '기타 중기 지표', 'Other Medium-Term Indicators'),
        description: t(uiLang, '월간 단위로 함께 확인할 보조 지표', 'Supplementary monthly indicators to review together'),
        items: others,
      });
    }
    return groups.filter((group) => group.items.length > 0);
  }, [indicatorHorizonKey, indicators, uiLang]);

  function renderIndicatorCard(ind: IndicatorCard) {
    const up = ind.pctChange !== null && ind.pctChange > 0;
    const down = ind.pctChange !== null && ind.pctChange < 0;
    const isRateIndicator = /%|percent|growth|qoq/i.test(ind.unit);
    const pointDelta = ind.latestValue !== null && ind.previousValue !== null
      ? Math.round((ind.latestValue - ind.previousValue) * 100) / 100
      : null;
    const rateUp = pointDelta !== null && pointDelta > 0;
    const rateDown = pointDelta !== null && pointDelta < 0;
    const gapText = ind.changeStatus === 'gap' && ind.changeIntervalDays
      ? t(uiLang, `갱신공백 ${ind.changeIntervalDays}일`, `Gap ${ind.changeIntervalDays}d`)
      : null;
    const changeText = gapText
      ? gapText
      : ind.dataStatus === 'stale'
        ? '최신 아님'
      : isRateIndicator && pointDelta !== null
        ? `${rateUp ? '▲' : rateDown ? '▼' : '–'} ${Math.abs(pointDelta)}p`
        : ind.pctChange !== null
          ? `${up ? '▲' : down ? '▼' : '–'} ${Math.abs(ind.pctChange)}%`
          : t(uiLang, '전기 데이터 없음', 'No prior data');
    const rawBadge = indicatorImpactBadge(ind);
    const badge = { ...rawBadge, ...impactBadgeFor(ind.id, rawBadge.label, rawBadge.title, uiLang) };
    const changeClass = ind.dataStatus === 'stale' ? 'stale' : isRateIndicator
      ? (rateUp ? 'up' : rateDown ? 'down' : '')
      : up ? 'up' : down ? 'down' : '';
    const isPmiIndicator = ind.id.includes('pmi');

    return <Link href={`/indicators/${ind.id}`} className={`indicatorCard indicatorListCard ${isPmiIndicator ? 'pmiNoChartCard' : ''}`} key={ind.id} aria-label={`${indicatorNameFor(ind.id, ind.nameKo, uiLang)} ${t(uiLang, '상세 보기', 'details')}`}>
      <div className="indicatorListMain">
        <div className="indicatorHead">
          <span className="indicatorName" title={indicatorNameFor(ind.id, ind.nameKo, uiLang)}>{indicatorNameFor(ind.id, ind.nameKo, uiLang)}</span>
          <span className={`epBadge ${badge.tone}`} title={badge.title}>{badge.label}</span>
        </div>
        <span className="indicatorListMeta">{ind.frequency.toUpperCase()} · {formatIndicatorPeriod(ind)}</span>
        {ind.dataStatus !== 'insufficient' ? <div className="indicatorValue">
          {formatIndicatorValue(ind.latestValue, ind.unit)}
          <span className="indicatorUnit">{ind.unit}</span>
        </div> : <div className="indicatorEmpty">{t(uiLang, '데이터 수집 대기 중', 'Waiting for data')}</div>}
      </div>
      <div className="indicatorListTrend">
        {!isPmiIndicator && <Sparkline history={ind.history} />}
        <span className={`indicatorChange ${changeClass}`} title={ind.dataWarning}>{changeText}</span>
      </div>
      <span className="indicatorChevron" aria-hidden="true">›</span>
    </Link>;
  }

  function renderTapeRow(ind: IndicatorCard) {
    const isRateIndicator = /%|percent|growth|qoq/i.test(ind.unit);
    const pointDelta = ind.latestValue !== null && ind.previousValue !== null
      ? Math.round((ind.latestValue - ind.previousValue) * 100) / 100
      : null;
    const changeValue = isRateIndicator ? pointDelta : ind.pctChange;
    const changeClass = ind.dataStatus === 'stale' ? 'stale' : changeValue !== null && changeValue > 0
      ? 'up' : changeValue !== null && changeValue < 0 ? 'down' : '';
    const gapText = ind.changeStatus === 'gap' && ind.changeIntervalDays
      ? t(uiLang, `갱신공백 ${ind.changeIntervalDays}일`, `Gap ${ind.changeIntervalDays}d`)
      : null;
    const changeText = gapText
      ? gapText
      : ind.dataStatus === 'stale'
        ? '최신 아님'
      : changeValue !== null
        ? `${changeValue > 0 ? '▲' : changeValue < 0 ? '▼' : '–'} ${Math.abs(changeValue)}${isRateIndicator ? 'p' : '%'}`
        : '—';
    return <Link href={`/indicators/${ind.id}`} className="macroTapeRow" key={`tape-${ind.id}`} aria-label={`${indicatorNameFor(ind.id, ind.nameKo, uiLang)} ${t(uiLang, '상세 보기', 'details')}`}>
      <div className="macroTapeName">
        <b title={indicatorNameFor(ind.id, ind.nameKo, uiLang)}>{compactIndicatorName(indicatorNameFor(ind.id, ind.nameKo, uiLang))}</b>
        <small>{ind.frequency.toUpperCase()} · {formatIndicatorPeriod(ind)}</small>
      </div>
      <Sparkline history={ind.history} width={82} height={28} />
      <div className="macroTapeValue">
        <strong>{formatIndicatorValue(ind.latestValue, ind.unit)}</strong>
        <small>{ind.unit}</small>
      </div>
      <div className="macroTapeDelta">
        <span className={changeClass} title={ind.dataWarning}>{changeText}</span>
        <small>{gapText ? t(uiLang, '비교 중단', 'Comparison paused') : t(uiLang, '전기 대비', 'vs prior')}</small>
      </div>
      <span className="macroTapeChevron" aria-hidden="true">›</span>
    </Link>;
  }

  function metricLine(label: string, ind?: IndicatorCard, opts?: { kind?: 'level' | 'growth'; hideDelta?: boolean }) {
    if (!ind || ind.latestValue === null) return null;
    // [v4.11] 성장률 지표(단위가 percent/yoy 등)는 "4.9599 percent yoy"처럼 원시
    // 단위가 그대로 노출되던 문제 — 부호 있는 %로 색상 입혀 표시.
    if (opts?.kind === 'growth') {
      const v = ind.latestValue;
      const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
      return <div className="gdpMetricLine" key={label}>
        <span>{label}</span>
        <b className={cls} title={`${formatIndicatorValue(ind.latestValue, ind.unit)} ${ind.unit}`}>{v > 0 ? '+' : ''}{v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<em>%</em></b>
        <small>{formatIndicatorPeriod(ind)}</small>
      </div>;
    }
    const lvl = gdpLevelDisplay(ind, uiLang);
    if (!lvl) return null;
    // 수준(level) 지표에는 전기 대비 방향 화살표를 함께 표시 — 단, 계절조정 안 된
    // 명목 분기값의 전기 대비(예: 중국 Q4→Q1 -13.85%)는 계절 요인이라 오해만
    // 부르므로 숨김(hideDelta).
    const d = opts?.hideDelta ? null : ind.pctChange;
    const dirClass = d !== null && d > 0 ? 'up' : d !== null && d < 0 ? 'down' : '';
    return <div className="gdpMetricLine" key={label}>
      <span>{label}</span>
      <b title={`${formatIndicatorValue(ind.latestValue, ind.unit)} ${ind.unit}`}>{lvl.text}<em>{lvl.unitLabel}</em>
        {d !== null && <i className={dirClass}>{d > 0 ? '▲' : d < 0 ? '▼' : '–'}{Math.abs(d)}%</i>}
      </b>
      <small>{formatIndicatorPeriod(ind)}</small>
    </div>;
  }

  function renderGdpOverviewCard(group: {
    country: string;
    quarterly?: IndicatorCard;
    annual?: IndicatorCard;
    quarterlyGrowth?: IndicatorCard;
    annualGrowth?: IndicatorCard;
  }) {
    const primary = group.quarterly || group.annual || group.quarterlyGrowth || group.annualGrowth;
    if (!primary) return null;
    const lead = (() => {
      if (group.quarterlyGrowth?.latestValue != null)
        return { v: group.quarterlyGrowth.latestValue, suffix: t(uiLang, '전분기 대비', 'QoQ'), ind: group.quarterlyGrowth };
      // [v5.16] 대표 성장률은 국가 간 기준을 통일한다.
      // QoQ 지표가 없는 국가(중국·유로존 등)도 분기 GDP의 전기 대비 변화율을 우선 사용하고,
      // 연간/전년동기 성장률은 보조 항목에만 둔다.
      if (group.quarterly?.pctChange != null)
        return { v: group.quarterly.pctChange, suffix: t(uiLang, '전분기 대비', 'QoQ'), ind: group.quarterly };
      return null;
    })();
    const leadClass = lead && lead.v > 0 ? 'up' : lead && lead.v < 0 ? 'down' : '';
    const compactLevel = (ind?: IndicatorCard) => {
      if (!ind) return '—';
      const value = gdpLevelDisplay(ind, uiLang);
      return value ? `${value.text} ${value.unitLabel}` : '—';
    };
    const annualGrowth = group.annualGrowth?.latestValue;
    return <Link href={`/indicators/gdp-${group.country}`} className="gdpOverviewCard" key={`gdp-overview-${group.country}`} aria-label={`${countryLabelFor(group.country, uiLang)} GDP ${t(uiLang, '상세 보기', 'details')}`}>
      <div className="gdpOverviewHead">
        <span className="gdpFlag" aria-hidden="true">{GDP_COUNTRY_FLAGS[group.country] || '•'}</span>
        <b>{countryLabelFor(group.country, uiLang)}</b>
        <span className="gdpOverviewChevron" aria-hidden="true">›</span>
      </div>
      <div className="gdpOverviewBody">
        <div className="gdpOverviewLead">
          {lead ? <strong className={leadClass}>{lead.v > 0 ? '+' : ''}{lead.v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<small>%</small></strong> : <strong>—</strong>}
          <span>{lead?.suffix || t(uiLang, '성장률', 'Growth')}</span>
          <Sparkline history={(lead?.ind || primary).history} width={104} height={30} />
        </div>
        <dl className="gdpOverviewStats">
          <div><dt>{t(uiLang, '분기 GDP', 'Quarterly GDP')}</dt><dd>{compactLevel(group.quarterly)}</dd></div>
          <div><dt>{t(uiLang, '연간 GDP', 'Annual GDP')}</dt><dd>{compactLevel(group.annual)}</dd></div>
          <div><dt>{t(uiLang, '연간 성장률', 'Annual Growth')}</dt><dd>{annualGrowth == null ? '—' : `${annualGrowth > 0 ? '+' : ''}${annualGrowth.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`}</dd></div>
        </dl>
      </div>
      <time>{formatIndicatorPeriod(lead?.ind || primary)}</time>
    </Link>;
  }

  function renderGdpCountryCard(group: {
    country: string;
    quarterly?: IndicatorCard;
    annual?: IndicatorCard;
    quarterlyGrowth?: IndicatorCard;
    annualGrowth?: IndicatorCard;
  }) {
    const primary = group.quarterly || group.annual || group.quarterlyGrowth || group.annualGrowth;
    if (!primary) return null;
    const rawBadge = indicatorImpactBadge(group.quarterly || group.quarterlyGrowth || primary);
    const badge = { ...rawBadge, ...impactBadgeFor(primary.id, rawBadge.label, rawBadge.title, uiLang) };
    const hasStale = [group.quarterly, group.annual, group.quarterlyGrowth, group.annualGrowth]
      .some((x) => x?.dataStatus === 'stale');
    // [v5.17] 장기 탭의 대표 숫자는 장기 컨셉에 맞춰 연간 기준으로 통일한다.
    // 공식 연간 성장률이 있으면 우선 사용하고, 없으면 연간 GDP level의 전년 대비 변동률을 사용한다.
    // 분기 QoQ는 장기 카드의 보조 정보로만 남긴다.
    const lead = (() => {
      if (group.annualGrowth?.latestValue != null)
        return { v: group.annualGrowth.latestValue, suffix: t(uiLang, '% 전년 대비', '% YoY'), annual: true, ind: group.annualGrowth };
      if (group.annual?.pctChange != null)
        return { v: group.annual.pctChange, suffix: t(uiLang, '% 전년 대비', '% YoY'), annual: true, ind: group.annual };
      return null;
    })();
    const gClass = lead && lead.v > 0 ? 'up' : lead && lead.v < 0 ? 'down' : '';
    // 장기 탭 대표 지표는 연간 기준: 2% 이상이면 성장세, 0 미만이면 역성장.
    const judgment = lead === null ? '' : lead.v < 0 ? t(uiLang, '역성장', 'Contraction') : lead.v > 2 ? t(uiLang, '성장세', 'Growth') : t(uiLang, '정체', 'Flat');
    // 명목(비계절조정) 분기 수준값의 전기 대비 화살표는 계절 노이즈라 숨김.
    const quarterlyIsNominal = !!group.quarterly?.nameKo.includes('명목');
    return <Link href={`/indicators/gdp-${group.country}`} className="indicatorCard gdpCountryCard indicatorListCard" key={`gdp-country-${group.country}`} aria-label={`${countryLabelFor(group.country, uiLang)} GDP ${t(uiLang, '상세 보기', 'details')}`}>
      <div className="indicatorListMain gdpCardBody">
        <div className="indicatorHead">
          <span className="indicatorName"><span className="gdpFlag" aria-hidden="true">{GDP_COUNTRY_FLAGS[group.country] || '•'}</span>{countryLabelFor(group.country, uiLang)} GDP</span>
          <span className={`epBadge ${badge.tone}`} title={badge.title}>{badge.label}</span>
        </div>
        <div className="gdpLeadRow">
          {lead !== null && <div className={`indicatorValue gdpGrowthLead ${gClass}`}>
            {lead.v > 0 ? '+' : ''}{lead.v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<span className="indicatorUnit">{lead.suffix}</span>
          </div>}
          <Sparkline history={(lead?.ind || primary).history} className="gdpSparkline" />
        </div>
        <div className="gdpMetricStack">
          {metricLine(
            quarterlyIsNominal ? t(uiLang, '분기 명목 GDP', 'Quarterly Nominal GDP') : group.quarterly?.nameKo.includes('실질') ? t(uiLang, '분기 실질 GDP', 'Quarterly Real GDP') : t(uiLang, '분기 GDP', 'Quarterly GDP'),
            group.quarterly,
            { hideDelta: quarterlyIsNominal },
          )}
          {metricLine(t(uiLang, '연간 명목 GDP', 'Annual Nominal GDP'), group.annual)}
          {lead?.ind !== group.annualGrowth && metricLine(t(uiLang, '연간 성장률', 'Annual Growth'), group.annualGrowth, { kind: 'growth' })}
        </div>
        <div className={`indicatorChange ${hasStale ? 'stale' : ''}`}>
          {hasStale ? t(uiLang, '일부 지표 최신 아님', 'Some indicators not current') : judgment}
          <span className="indicatorPeriod">{formatIndicatorPeriod(lead?.ind || primary)}</span>
        </div>
      </div>
      <span className="indicatorChevron" aria-hidden="true">›</span>
    </Link>;
  }


  function renderReportArticle(a: Article, index: number) {
    const cat = categoryById.get(a.category);
    return <a className="reportArticleRow" href={a.link} target="_blank" rel="noreferrer" key={a.id}>
      <span>{index + 1}</span>
      <div><b>{editorialHeadline(displayArticleTitle(a, uiLang), a.sourceName || a.feedName)}</b><small>{categoryLabelFor(cat?.label || a.category, uiLang)} · {sourceNameFor(a.sourceName || a.feedName, uiLang)} · {shortDate(a.publishedAt)}</small></div>
      <strong>{a.score || 0}</strong>
    </a>;
  }

  function renderReportBlock(title: string, report: typeof reportModel.daily) {
    const topCategory = report.categoryRows[0];
    const topMover = report.indicatorMovers[0];
    const articleCount = report.articles.length.toLocaleString();
    const topCategoryLabel = topCategory ? categoryLabelFor(topCategory.label, uiLang) : '—';
    const topCategoryCount = topCategory?.count || 0;
    const topMoverLabel = topMover ? indicatorNameFor(topMover.id, topMover.nameKo, uiLang) : '';
    const reportWindow = uiLang === 'en' ? `${report.rangeDays}-day window` : `${report.rangeDays}일 기준`;
    const categoryCountLabel = uiLang === 'en' ? `${topCategoryCount} articles` : `${topCategoryCount}건`;
    const briefTitle = uiLang === 'en' ? `${title} key signals` : `${title} 핵심 신호`;
    const articleSignal = uiLang === 'en'
      ? `${articleCount} articles in the last ${report.rangeDays} days; ${report.highImpact.toLocaleString()} are High Impact.`
      : `최근 ${report.rangeDays}일 기준 기사는 ${articleCount}건, High Impact 기사는 ${report.highImpact.toLocaleString()}건입니다.`;
    const categorySignal = topCategory
      ? (uiLang === 'en' ? `Most frequent category: ${topCategoryLabel} (${topCategory.count} articles).` : `가장 많이 관측된 영역은 ${topCategory.label} ${topCategory.count}건입니다.`)
      : t(uiLang, '아직 충분한 데이터가 없습니다.', 'Not enough data yet.');
    const moverSignal = topMover
      ? (uiLang === 'en' ? `Largest indicator move: ${topMoverLabel} ${topMover.pctChange! > 0 ? '+' : ''}${topMover.pctChange}%.` : `가장 큰 지표 변동은 ${topMover.nameKo} ${topMover.pctChange! > 0 ? '+' : ''}${topMover.pctChange}%입니다.`)
      : t(uiLang, '지표 수집 대기 중입니다.', 'Waiting for indicator data.');
    return <div className="reportPage">
      <section className="reportSummaryGrid">
        <article><span>{t(uiLang, '기사 수', 'Articles')}</span><b>{articleCount}</b><small>{reportWindow}</small></article>
        <article><span>High Impact</span><b>{report.highImpact.toLocaleString()}</b><small>{t(uiLang, 'Impact 80 이상', 'Impact 80 or higher')}</small></article>
        <article><span>{t(uiLang, '평균 Impact', 'Average Impact')}</span><b>{report.avgScore}</b><small>{t(uiLang, '단순 평균', 'Simple average')}</small></article>
        <article><span>{t(uiLang, '최다 카테고리', 'Top Category')}</span><b>{topCategoryLabel}</b><small>{categoryCountLabel}</small></article>
      </section>
      <section className="reportInsightCard">
        <span>Rule-based brief</span>
        <h2>{briefTitle}</h2>
        <ul>
          <li>{articleSignal}</li>
          <li>{categorySignal}</li>
          <li>{moverSignal}</li>
        </ul>
      </section>
      <div className="reportTwoCol">
        <section className="reportPanel"><div className="reportPanelHead"><b>{t(uiLang, 'Impact Top 기사', 'Impact Top Articles')}</b><span>{t(uiLang, '점수·최신순', 'Score and recency')}</span></div><div className="reportArticleList">{report.topArticles.length ? report.topArticles.map(renderReportArticle) : <div className="empty small">{t(uiLang, '기사 없음', 'No articles')}</div>}</div></section>
        <section className="reportPanel"><div className="reportPanelHead"><b>{t(uiLang, '카테고리 분포', 'Category Distribution')}</b><span>{t(uiLang, '건수 기준', 'By article count')}</span></div><div className="reportBars">{report.categoryRows.slice(0, 8).map((row) => <div className="reportBar" key={row.id}><span>{categoryLabelFor(row.label, uiLang)}</span><b>{row.count}</b><i style={{ width: `${Math.max(8, Math.round((row.count / Math.max(1, report.articles.length)) * 100))}%` }} /></div>)}</div></section>
      </div>
      <div className="reportTwoCol">
        <section className="reportPanel"><div className="reportPanelHead"><b>{t(uiLang, '반복 키워드', 'Repeated Keywords')}</b><span>{t(uiLang, '빈도순', 'By frequency')}</span></div><div className="reportChips">{report.topTags.map(([tag, count]) => <span key={tag}>#{tagLabelFor(tag, uiLang)}<b>{count}</b></span>)}</div></section>
        <section className="reportPanel"><div className="reportPanelHead"><b>{t(uiLang, '최근 발표 기준', 'Latest Release Basis')}</b><span>{t(uiLang, '지표 변동', 'Indicator Moves')}</span></div><p className="reportPanelNote">{t(uiLang, '지표별 발표주기가 달라 이 기간 안에 새 발표가 없을 수 있습니다.', 'Indicator release cycles differ, so this window may not include a fresh release for every metric.')}</p><div className="reportMetricList">{report.indicatorMovers.map((ind) => <Link href={`/indicators/${ind.id}`} key={ind.id}><b>{indicatorNameFor(ind.id, ind.nameKo, uiLang)}</b><span className={(ind.pctChange || 0) >= 0 ? 'up' : 'down'}>{ind.pctChange! > 0 ? '+' : ''}{ind.pctChange}%</span></Link>)}</div></section>
      </div>
    </div>;
  }

  return <main className="appShell">
    <aside className="sidebar">
      <div className="logo"><span>EP</span><div className="logoText"><b>EP Industry Monitor</b><small>Engineering · Plastics · Intelligence</small></div></div>
      <div className="languageToggle" role="group" aria-label={t(uiLang, '표시 언어', 'Display language')}>
        <button type="button" className={uiLang === 'ko' ? 'active' : ''} onClick={() => changeUiLang('ko')}>한국어</button>
        <button type="button" className={uiLang === 'en' ? 'active' : ''} onClick={() => changeUiLang('en')}>English</button>
      </div>
      <nav>
        <button className={page === 'feed' ? 'active' : ''} onClick={() => setPage('feed')}>{t(uiLang, 'EP 산업 뉴스', 'EP Industry News')}</button>
        <button className={page === 'macro' ? 'active' : ''} onClick={() => setPage('macro')}>{t(uiLang, '매크로 브리핑', 'Macro Briefing')}</button>
        <button className={page === 'sources' ? 'active' : ''} onClick={() => setPage('sources')}>{t(uiLang, '소스', 'Sources')}</button>
        {/* [디자인 리뉴얼] 보고서/관심 지표/알림 설정은 아직 백엔드가 없는 예정 기능이라
            실제 페이지 전환 없이 자리만 잡아두고 "Soon" 배지로 준비 중임을 명시.
            데이터 없는 기능을 있는 것처럼 보이게 하지 않기 위한 의도적 처리. */}
        <button className={page === 'reports' ? 'active' : ''} onClick={() => setPage('reports')}>{t(uiLang, '보고서', 'Reports')}</button>
        <button className="soon" disabled title="준비 중인 기능입니다">{t(uiLang, '관심 지표', 'Watchlist')}<span className="soonBadge">Soon</span></button>
        <button className="soon" disabled title="준비 중인 기능입니다">{t(uiLang, '알림 설정', 'Alerts')}<span className="soonBadge">Soon</span></button>
      </nav>
      <div className="sidebarMeta">
        <div className="sidebarStatusRow">
          <b>{t(uiLang, '실시간 수집', 'Live Collection')}</b>
          <span className="statusPill"><i></i>{t(uiLang, '정상', 'OK')}</span>
        </div>
        <div className="metaRow"><span>{t(uiLang, '최종 수집', 'Last collected')}</span><b>{formatDate(stats.lastCollectedAt)}</b></div>
        <div className="metaRow"><span>{t(uiLang, 'EP 뉴스', 'EP News')}</span><b>{epTotalCount.toLocaleString()}{t(uiLang, '건 표시', ' shown')}</b></div>
        <div className="metaRow"><span>{t(uiLang, '매크로', 'Macro')}</span><b>{macroCount.toLocaleString()}{t(uiLang, '건 별도 레인', ' separate lane')}</b></div>
        <div className="metaRow"><span>{t(uiLang, '소스', 'Sources')}</span><b>{stats.totalFeeds}{t(uiLang, '개', '')}</b></div>
        <div className="productCredit">
          <span>{t(uiLang, '제작', 'Built by')}</span>
          <b>{t(uiLang, 'LG화학 엔지니어링소재 사업부 마케팅전략팀', 'LG Chem Engineering Materials Marketing Strategy Team')}</b>
          <a href="mailto:qdong@lgchem.com">{t(uiLang, '문의', 'Contact')} qdong@lgchem.com</a>
        </div>
      </div>
    </aside>
    <section className="content">
      {page !== 'feed' && <header className="pageHeader">
        <div className="pageHeaderTitle">
          <span className="eyebrow">{page === 'macro' ? 'Macro Briefing' : page === 'reports' ? 'Deterministic Reports' : 'Source Directory'}</span>
          <h1>{page === 'sources' ? t(uiLang, '소스 현황', 'Source Directory') : page === 'reports' ? t(uiLang, '보고서', 'Reports') : t(uiLang, '매크로 브리핑', 'Macro Briefing')}</h1>
          <p>{page === 'sources' ? t(uiLang, `${feedCounts.length}개 소스가 최근 기여한 기사 수`, `${feedCounts.length} sources with recent contributions`)
            : page === 'reports' ? t(uiLang, 'LLM 없이 기사·지표 데이터를 규칙 기반으로 집계한 자동 보고서입니다.', 'Rule-based reports from article and indicator data, without LLM calls.')
            : t(uiLang, `매크로 기사 ${macroCount.toLocaleString()}건과 핵심 지표를 EP 산업 뉴스와 분리해 봅니다.`, `${macroCount.toLocaleString()} macro articles and key indicators separated from EP industry news.`)}</p>
          {page === 'macro' && <span className="pageHeaderMeta">{indicatorMeta.totalIndicators}{t(uiLang, '개 지표', ' indicators')} · {formatDate(indicatorMeta.generatedAt)} {t(uiLang, '갱신', 'updated')}</span>}
          {page === 'reports' && <span className="pageHeaderMeta">{t(uiLang, '기준 데이터', 'Reference data')} · {formatDate(reportModel.generatedAt)}</span>}
        </div>
        <div className={`headerActions ${page === 'macro' ? 'macroHeaderActions' : ''}`}>
          {page === 'macro' && <div className="headerHorizonTabs" aria-label="지표 기간">
            {HORIZON_TABS.map((f) => (
              <button key={f.key} className={indicatorHorizonKey === f.key ? 'active' : ''} onClick={() => changeIndicatorHorizon(f.key)}>
                {f.key === 'now' ? t(uiLang, '단기', 'Short') : f.key === 'recent' ? t(uiLang, '중기', 'Medium') : t(uiLang, '장기', 'Long')}<span>{horizonCount(indicatorCounts, f.key)}</span>
              </button>
            ))}
          </div>}
          <div className="headerUtilityActions">
            {page === 'sources' && <button className="ghost" onClick={() => refresh()} disabled={loading}>{loading ? t(uiLang, '불러오는 중…', 'Loading…') : t(uiLang, '새로고침', 'Refresh')}</button>}
          </div>
        </div>
      </header>}
      {page === 'feed' ? <>
        <div className="laneNotice epLaneNotice"><b>{t(uiLang, 'EP 산업 뉴스 레인', 'EP Industry News Lane')}</b><span>{t(uiLang, '매크로 기사는 기본 피드에서 분리했습니다. 환율·PMI·GDP·유가 뉴스는 매크로 브리핑에서 확인하세요.', 'Macro articles are separated from the default feed. FX, PMI, GDP and oil updates live in Macro Briefing.')}</span><button onClick={() => setPage('macro')}>{t(uiLang, '매크로 보기', 'View macro')}</button></div>
        <FeedHeader
          lastCollectedAt={stats.lastCollectedAt}
          resultsCount={displayedResultCount}
          query={query}
          onQueryChange={handleFeedQueryChange}
          sort={sort}
          onSortChange={(v) => { setSort(v); setVisibleCount(12); }}
          advancedOpen={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
          lang={uiLang}
        />

        {showAdvanced && <div id="feedAdvancedPanel" className="feedAdvancedPanel">
          <div className="feedAdvancedRow">
            <span className="feedAdvancedLabel">{t(uiLang, '언어', 'Article language')}</span>
            <div className="tabs smallTabs">
              {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
                <button key={k} className={selectedLanguages.includes(k) ? 'active' : ''} onClick={() => { toggle(selectedLanguages, k, setSelectedLanguages); setVisibleCount(12); }}>{v}</button>
              ))}
            </div>
          </div>
          <div className="feedAdvancedRow">
            <label className="scoreSlider">{t(uiLang, '최소 Impact', 'Minimum Impact')} {minScore}
              <input type="range" min="0" max="100" step="5" value={minScore} onChange={(e) => { setMinScore(Number(e.target.value)); setVisibleCount(12); }} />
            </label>
            <label className={`customDays ${customDays ? 'active' : ''}`}>
              {t(uiLang, '직접 입력(일)', 'Custom days')}
              <input type="number" min={1} max={730} value={customDays ? days : ''} placeholder={t(uiLang, '일수', 'Days')}
                onChange={(e) => { const v = Number(e.target.value); if (v > 0) { setCustomDays(true); setDays(v); } }}
                onBlur={() => refresh()} onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }} />
            </label>
          </div>
        </div>}

        <FeedCategoryTabs
          categories={visibleCategories}
          selected={selectedCategories}
          counts={epCounts}
          totalCount={epTotalCount}
          onToggle={(id) => { toggle(selectedCategories, id, setSelectedCategories); setVisibleCount(12); }}
          onSelectAll={() => { setSelectedCategories([]); setVisibleCount(12); }}
          lang={uiLang}
        />

        <div className="feedLayout">
          <div className="feedMain" id="feedArticles">
            {heroArticle && <FeedHero
              article={heroArticle}
              categoryLabel={categoryLabelFor(categoryById.get(heroArticle.category)?.label || heroArticle.category, uiLang)}
              lang={uiLang}
              categoryColor={categoryById.get(heroArticle.category)?.color || '#E8A63C'}
            />}
            {filtered.length === 0 ? (
              <div className="empty"><b>{t(uiLang, '조건에 맞는 기사가 없습니다', 'No articles match your filters')}</b><span>{t(uiLang, '검색어를 지우거나 기간을 늘려보세요. 뉴스와 지표는 스케줄러가 자동으로 갱신합니다.', 'Clear the search term or extend the period. News and indicators refresh automatically.')}</span></div>
            ) : visibleGeneralArticles.length > 0 ? (
              <>
              <div className="feedGrid">
                {visibleGeneralArticles.map((a, i) => (
                  <FeedCard
                    key={a.id}
                    article={a}
                    index={i}
                    categoryLabel={categoryLabelFor(categoryById.get(a.category)?.label || a.category, uiLang)}
                    lang={uiLang}
                    categoryColor={categoryById.get(a.category)?.color || '#E8A63C'}
                  />
                ))}
              </div>
              {generalArticles.length > visibleGeneralArticles.length && (
                <button type="button" className="feedMoreBtn" onClick={() => setVisibleCount((v) => v + 12)}>
                  {uiLang === 'en' ? `Show ${Math.min(12, generalArticles.length - visibleGeneralArticles.length).toLocaleString()} more from loaded articles` : `로드된 기사에서 ${Math.min(12, generalArticles.length - visibleGeneralArticles.length).toLocaleString()}건 더 보기`}
                </button>
              )}
              </>
            ) : (
              // heroArticle만 있고 일반 기사가 없는 경우 — 빈(empty) 대신 대표 기사만 표시
              null
            )}
          </div>

          <FeedSidePanel
            briefItems={briefItems}
            keywords={keywordList}
            activeKeyword={query}
            onKeywordClick={(t) => handleFeedQueryChange(t)}
            categories={visibleCategories}
            selectedCategories={selectedCategories}
            onToggleCategory={(id) => { toggle(selectedCategories, id, setSelectedCategories); setVisibleCount(12); }}
            onSelectAllCategories={() => { setSelectedCategories([]); setVisibleCount(12); }}
            periodPresets={PERIOD_PRESETS}
            days={days}
            customDays={customDays}
            onChangePeriod={(d) => { changePeriod(d); setVisibleCount(12); }}
            onReset={() => {
              setQuery(''); setSelectedCategories([]); setSelectedLanguages([]); setMinScore(0);
              setVisibleCount(12); changePeriod(30);
            }}
            resultCount={displayedResultCount}
            lang={uiLang}
          />
        </div>
      </> : page === 'macro' ? <>
        {macroHighlight && <article className="macroHighlightCard">
          {/* [디자인 리뉴얼] 순수 장식용 도트-글로브. 실데이터가 아니므로 히어로 카드
              배경 우측에만 은은하게 깔고, 기존 스파크라인 배경과 함께 겹쳐 "글로벌"
              톤을 보강한다. */}
          <div className="macroHighlightGlobe" aria-hidden="true">
            <span className="globeRing" /><span className="globeRing small" /><span className="globePulse" />
          </div>
          <div className="macroHighlightBg" aria-hidden="true"><Sparkline history={macroHighlight.indicator.history} width={420} height={140} className="macroHighlightBgChart" /></div>
          <div className="macroHighlightMain">
            <span className="macroHighlightLabel">{isTodayKst(macroHighlight.news.publishedAt) ? t(uiLang, '오늘의 인사이트', 'Insight Today') : t(uiLang, '최근 인사이트', 'Recent Insight')}</span>
            <h2>{editorialHeadline(displayArticleTitle(macroHighlight.news, uiLang), macroHighlight.news.sourceName)}</h2>
            {macroHighlight.news.summary && <p className="macroHighlightSummary">{macroHighlight.news.summary}</p>}
            <div className="macroHighlightActions">
              <a href={macroHighlight.news.link} target="_blank" rel="noreferrer">{t(uiLang, '뉴스 원문 보기 →', 'Read original →')}</a>
              <Link href={`/indicators/${macroHighlight.indicator.id}`} className="ghostLink">{t(uiLang, '관련 지표 보기', 'Related indicator')}</Link>
            </div>
          </div>
          <div className="macroHighlightMeta">
            <div><span>{t(uiLang, '발행처', 'Source')}</span><b>{sourceNameFor(macroHighlight.news.sourceName, uiLang)}</b></div>
            <div><span>{t(uiLang, '발행일', 'Published')}</span><b>{shortDate(macroHighlight.news.publishedAt)}</b></div>
            {macroHighlight.news.tags && macroHighlight.news.tags.length > 0 && <div className="macroHighlightTags"><span>{t(uiLang, '키워드', 'Keywords')}</span><div>{macroHighlight.news.tags.map((tag) => <em key={tag}>#{tag}</em>)}</div></div>}
            {macroHighlights.length > 1 && <div className="macroHighlightPager">
              <button onClick={() => setHighlightIdx((safeHighlightIdx - 1 + macroHighlights.length) % macroHighlights.length)} aria-label={t(uiLang, '이전 인사이트', 'Previous insight')}>‹</button>
              <span>{safeHighlightIdx + 1} / {macroHighlights.length}</span>
              <button onClick={() => setHighlightIdx((safeHighlightIdx + 1) % macroHighlights.length)} aria-label={t(uiLang, '다음 인사이트', 'Next insight')}>›</button>
            </div>}
          </div>
        </article>}

        <section className="macroNewsLane">
          <div className="macroNewsHead">
            <div><span>Macro News Lane</span><b>{t(uiLang, '매크로 기사 브리핑', 'Macro News Briefing')}</b><p>{t(uiLang, '환율·유가·GDP·PMI·통상 이슈는 EP 산업 뉴스와 분리해 관리합니다.', 'FX, oil, GDP, PMI and trade issues are managed separately from EP industry news.')}</p></div>
            <strong>{macroCount.toLocaleString()}{t(uiLang, '건', '')}</strong>
          </div>
          <div className="macroNewsGrid">
            <div className="macroNewsList">
              {macroNewsCards.length ? macroNewsCards.map((a) => <a className="macroNewsRow" href={a.link} target="_blank" rel="noreferrer" key={a.id}>
                <div><b>{editorialHeadline(stripMacroPrefix(displayArticleTitle(a, uiLang)), a.sourceName || a.feedName)}</b><small>{sourceNameFor(a.sourceName || a.feedName, uiLang)} · {shortDate(a.publishedAt)} · Impact {a.score || 0}</small></div>
                <span>{t(uiLang, '원문 ↗', 'Original ↗')}</span>
              </a>) : <div className="empty small">{t(uiLang, '매크로 기사가 없습니다', 'No macro articles')}</div>}
            </div>
            <aside className="macroNewsSources">
              <b>{t(uiLang, '주요 매크로 소스', 'Key Macro Sources')}</b>
              {macroNewsSources.map(([name, count]) => <div key={name}><span>{sourceNameFor(name, uiLang)}</span><strong>{count}</strong></div>)}
            </aside>
          </div>
        </section>
        {indicatorLoading ? <div className="indicatorGrid" key="macro-loading"><div className="empty"><b>{t(uiLang, '불러오는 중…', 'Loading…')}</b></div></div> : indicators.length === 0 ? <div className="indicatorGrid" key="macro-empty"><div className="empty"><b>{t(uiLang, '이 시간축에 등록된 지표가 없습니다', 'No indicators registered for this horizon')}</b></div></div> : indicatorHorizonKey === 'now' ? <div className="macroOverviewGrid" key="macro-overview-now">
          <section className="indicatorSection macroTapeSection">
            <div className="indicatorSectionHead"><b>{t(uiLang, '주요 매크로 지표', 'Key Macro Indicators')}</b><span>{t(uiLang, '환율·유가·금리의 단기 흐름', 'Short-term FX, oil and rate moves')}</span></div>
            <div className="macroTapeList">{indicators.map((ind) => renderTapeRow(ind))}</div>
          </section>
          <section className="indicatorSection gdpOverviewSection">
            <div className="indicatorSectionHead">
              <span className="indicatorSectionTitleGroup"><b>{t(uiLang, '주요국 성장률 요약', 'Major Economy Growth Summary')}</b><span className="sectionInfoIcon" title={t(uiLang, 'GDP 기반 경기 속도만 요약 표시합니다. 자세한 GDP 규모와 성장률은 장기 탭에서 확인하세요.', 'Shows GDP-based economic speed only. See the Long tab for GDP size and growth details.')}>ⓘ</span></span>
              <button className="sectionMore" onClick={() => changeIndicatorHorizon('long')}>{t(uiLang, '더보기 ›', 'More ›')}</button>
            </div>
            <div className="gdpOverviewGrid">{longGdpGroups.map((group) => renderGdpOverviewCard(group))}</div>
          </section>
        </div> : indicatorHorizonKey === 'long' ? <div className="indicatorSections" key="macro-gdp-country-grouped">
          <section className="indicatorSection">
            <div className="indicatorSectionHead"><span className="indicatorSectionTitleGroup"><b>{t(uiLang, '국가별 GDP 규모와 성장률', 'GDP Size and Growth by Country')}</b><span className="sectionInfoIcon" title={t(uiLang, '경제 규모, 분기 흐름, 연간 성장률을 국가별로 비교합니다. 성장률은 지표 가용성에 따라 전분기 또는 전년 대비 기준입니다.', 'Compares economic scale, quarterly momentum and annual growth by country. Growth basis depends on indicator availability.')}>ⓘ</span></span><span>{t(uiLang, '경제 규모, 분기 흐름, 연간 성장률을 국가별로 비교', 'Compare economic scale, quarterly momentum and annual growth by country')}</span></div>
            <div className="indicatorGrid gdpDetailGrid">{longGdpGroups.map((group) => renderGdpCountryCard(group))}</div>
          </section>
        </div> : <div className="indicatorSections" key="macro-medium-grouped">
          {mediumIndicatorGroups.map((group) => <section className="indicatorSection" key={group.key}>
            <div className="indicatorSectionHead"><b>{group.title}</b><span>{group.description}</span></div>
            <div className="indicatorGrid mediumIndicatorGrid">{group.items.map((ind) => renderIndicatorCard(ind))}</div>
          </section>)}
        </div>}
      </> : page === 'reports' ? <>
        <div className="reportTabs" aria-label={t(uiLang, '보고서 유형', 'Report type')}>
          <button className={reportTab === 'daily' ? 'active' : ''} onClick={() => setReportTab('daily')}>{t(uiLang, '데일리 브리프', 'Daily Brief')}</button>
          <button className={reportTab === 'weekly' ? 'active' : ''} onClick={() => setReportTab('weekly')}>{t(uiLang, '주간 인사이트', 'Weekly Insight')}</button>
          <button className={reportTab === 'monthly' ? 'active' : ''} onClick={() => setReportTab('monthly')}>{t(uiLang, '월간 리뷰', 'Monthly Review')}</button>
          <button className={reportTab === 'theme' ? 'active' : ''} onClick={() => setReportTab('theme')}>{t(uiLang, '테마 리포트', 'Theme Report')}</button>
        </div>
        {reportTab === 'daily' && renderReportBlock(t(uiLang, '데일리 브리프', 'Daily Brief'), reportModel.daily)}
        {reportTab === 'weekly' && renderReportBlock(t(uiLang, '주간 인사이트', 'Weekly Insight'), reportModel.weekly)}
        {reportTab === 'monthly' && renderReportBlock(t(uiLang, '월간 리뷰', 'Monthly Review'), reportModel.monthly)}
        {reportTab === 'theme' && <div className="reportPage"><section className="reportPanel"><div className="reportPanelHead"><b>{t(uiLang, '테마 리포트', 'Theme Report')}</b><span>{t(uiLang, '카테고리별 자동 묶음', 'Automatic category grouping')}</span></div><div className="themeReportGrid">{reportModel.themeRows.map((theme) => <article className="themeReportCard" key={theme.id}><span>{categoryLabelFor(theme.label, uiLang)}</span><b>{t(uiLang, `${theme.count.toLocaleString()}건`, `${theme.count.toLocaleString()} articles`)}</b><small>{t(uiLang, `평균 Impact ${theme.avgScore}`, `Average Impact ${theme.avgScore}`)}</small><div>{theme.top.map((a, i) => renderReportArticle(a, i))}</div></article>)}</div></section></div>}
      </> : <>
        <div className="laneNotice"><b>{t(uiLang, '소스도 EP 기준으로 표시', 'Sources are shown by EP relevance')}</b><span>{t(uiLang, '매크로 소스는 매크로 브리핑 레인에서 별도로 집계합니다.', 'Macro sources are counted separately in the Macro Briefing lane.')}</span></div>
        <div className="filters"><input className="searchInput" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(uiLang, '소스 검색…', 'Search sources…')} /></div>
        <div className="sourceList">{feedCounts.filter(([name]) => !query || name.toLowerCase().includes(query.toLowerCase())).map(([name, info]) => <div className="sourceRow" key={name}><div className="sourceInfo"><b>{sourceNameFor(name, uiLang)}</b><span>{info.region} · {info.type}</span></div><div className="sourceStats"><strong>{info.count}</strong><span>{t(uiLang, '최근 기여', 'Recent contributions')}</span></div></div>)}</div>
      </>}
      <footer className="contentCredit">
        <span>{t(uiLang, 'LG화학 엔지니어링소재 사업부 마케팅전략팀 제작', 'Built by LG Chem Engineering Materials Marketing Strategy Team')}</span>
        <a href="mailto:qdong@lgchem.com">{t(uiLang, '문의', 'Contact')} qdong@lgchem.com</a>
      </footer>
    </section>
  </main>;
}
