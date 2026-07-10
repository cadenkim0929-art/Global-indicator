'use client';

import { useMemo, useState } from 'react';
import type { Article, IndicatorCard, IndicatorFrequency } from '@/lib/types';

interface Stats {
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

type PageKey = 'feed' | 'sources' | 'macro';
type SortKey = 'latest' | 'score' | 'category';
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
  { label: '전체', days: 365 },
];
// [v4.0] 데이터 주기(daily/monthly/quarterly/yearly)는 내부 메타로 유지하되,
// 사용자 화면은 의사결정 시간축인 지금/최근/장기 3단으로 재프레이밍.
// - 지금: daily market tape (환율·유가·금리)
// - 최근: monthly operating pulse (산업생산·CPI·PMI)
// - 장기: quarterly/yearly growth frame (GDP)
type IndicatorHorizon = 'now' | 'recent' | 'long';
const HORIZON_TABS: Array<{ key: IndicatorHorizon; label: string; frequencies: IndicatorFrequency[] }> = [
  { key: 'now', label: '지금', frequencies: ['daily'] },
  { key: 'recent', label: '최근', frequencies: ['monthly'] },
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
const GDP_COUNTRY_LABELS: Record<string, string> = {
  us: '미국', korea: '한국', japan: '일본', china: '중국', eurozone: '유로존', india: '인도',
};
const GDP_COUNTRY_ORDER = ['us', 'korea', 'japan', 'china', 'eurozone', 'india'];
function gdpCountry(id: string) {
  if (id.includes('korea')) return 'korea';
  if (id.includes('japan')) return 'japan';
  if (id.includes('india')) return 'india';
  if (id.includes('china')) return 'china';
  if (id.includes('eurozone')) return 'eurozone';
  if (id.includes('_us') || id.endsWith('_usd')) return 'us';
  return id;
}
function isGdpGrowthCard(ind: IndicatorCard) {
  return ind.id.startsWith('gdp_qoq_');
}
function isGdpLevelCard(ind: IndicatorCard) {
  return ind.id.startsWith('gdp_quarterly_') || ind.id.startsWith('gdp_annual_') || ind.id === 'gdp_current_usd';
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
// [v4.10] GDP 수준(level) 지표들의 단위가 소스마다 제각각(Million KRW /
// Billion chained 2017 USD / Million chained 2010 EUR / Trillion USD)이라
// 한눈에 비교가 안 되던 문제 — 전부 "조" 스케일 + 통화명으로 통일해서 표시.
// 원시 단위는 title 툴팁으로만 보존.
function gdpLevelDisplay(ind: IndicatorCard): { text: string; unitLabel: string } | null {
  if (ind.latestValue === null) return null;
  const u = (ind.unit || '').toLowerCase();
  let v: number | null = null; let cur = '';
  if (/million\s+krw/.test(u)) { v = ind.latestValue / 1e6; cur = '조 원'; }
  else if (/million\s+jpy/.test(u)) { v = ind.latestValue / 1e6; cur = '조 엔'; }
  else if (/million.*eur/.test(u)) { v = ind.latestValue / 1e6; cur = '조 유로'; }
  else if (/billion\s+cny/.test(u)) { v = ind.latestValue / 1e3; cur = '조 위안'; }
  else if (/billion\s+inr/.test(u)) { v = ind.latestValue / 1e3; cur = '조 루피'; }
  else if (/billion.*(usd|dollar)/.test(u)) { v = ind.latestValue / 1e3; cur = '조 달러'; }
  else if (/trillion\s+usd/.test(u)) { v = ind.latestValue; cur = '조 달러'; }
  if (v === null) return { text: formatIndicatorValue(ind.latestValue, ind.unit), unitLabel: ind.unit };
  const text = Math.abs(v) >= 100 ? v.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  return { text, unitLabel: cur };
}
function formatGrowthLine(ind?: IndicatorCard) {
  if (!ind || ind.latestValue === null) return null;
  return `${formatIndicatorValue(ind.latestValue, ind.unit)} ${ind.unit}`;
}
function formatIndicatorPeriod(ind?: Pick<IndicatorCard, 'frequency' | 'latestPeriod'>) {
  if (!ind?.latestPeriod) return '수집 전';
  if (ind.frequency === 'yearly') return ind.latestPeriod.slice(0, 4);
  if (ind.frequency === 'quarterly') {
    const year = ind.latestPeriod.slice(0, 4);
    const month = Number(ind.latestPeriod.slice(5, 7));
    if (Number.isFinite(month) && month > 0) return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
  return ind.latestPeriod;
}

function shortDate(value: string) {
  const d = new Date(value);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')}`;
}
function formatDate(value: string | null) {
  if (!value) return '수집 전';
  const d = new Date(value);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')} KST`;
}
function sourceRegion(name: string) {
  if (/[가-힣]|\.kr|korea/i.test(name)) return '한국';
  if (/[ぁ-ヿ一-龯]|japan|\.jp/i.test(name)) return '일본';
  if (/china|\.cn|中国/i.test(name)) return '중국';
  if (/eu|europe|\.de|\.fr|\.uk/i.test(name)) return '유럽';
  if (/us|america|\.com/i.test(name)) return '미국';
  return '기타';
}

export default function Dashboard({
  initialArticles, initialStats, initialIndicators, initialIndicatorMeta, initialIndicatorCounts,
}: {
  initialArticles: Article[]; initialStats: Stats;
  initialIndicators: IndicatorCard[]; initialIndicatorMeta: IndicatorMeta; initialIndicatorCounts: Record<IndicatorFrequency, number>;
}) {
  const [articles, setArticles] = useState(initialArticles);
  const [stats, setStats] = useState(initialStats);
  const [page, setPage] = useState<PageKey>('feed');
  const [days, setDays] = useState(initialStats.lookbackDays ?? 90);
  const [customDays, setCustomDays] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);
  // [v1.0] Global Indicators 통합 — 매크로 지표 상태
  const [allIndicators, setAllIndicators] = useState(initialIndicators);
  const [indicatorMeta, setIndicatorMeta] = useState(initialIndicatorMeta);
  const [indicatorCounts, setIndicatorCounts] = useState(initialIndicatorCounts);
  const [indicatorHorizonKey, setIndicatorHorizonKey] = useState<IndicatorHorizon>('now');
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorRefreshing, setIndicatorRefreshing] = useState(false);
  const [indicatorRefreshResult, setIndicatorRefreshResult] = useState<string | null>(null);

  async function loadIndicators(horizon: IndicatorHorizon) {
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
    loadIndicators(horizon);
  }
  async function refreshIndicators() {
    setIndicatorRefreshing(true); setIndicatorRefreshResult(null);
    try {
      const res = await fetch('/api/indicators/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) { setIndicatorRefreshResult(`지표 갱신 오류: ${data.error || res.status}`); return; }
      const cards = (data.cards || []) as IndicatorCard[];
      setAllIndicators(cards);
      setIndicatorMeta(data.meta);
      setIndicatorCounts(data.counts);
      const r = data.result || {};
      const d = r.derived || {};
      setIndicatorRefreshResult(`지표 갱신 완료: 데이터 ${d.withData ?? r.withData ?? 0}/${r.totalIndicators ?? 0}개, 신규 관측 ${(r.addedObservations ?? 0) + (d.addedObservations ?? 0)}개`);
    } catch (e) {
      setIndicatorRefreshResult(`지표 갱신 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setIndicatorRefreshing(false); }
  }

  const categories = stats.categories || [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const visibleCategories = categories.filter((c) =>
    (stats.counts.find((x) => x.category === c.id)?.count || 0) > 0 || selectedCategories.includes(c.id)
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = articles.filter((a) => {
      if (selectedCategories.length && !selectedCategories.includes(a.category)) return false;
      if (selectedLanguages.length && !selectedLanguages.includes(a.language || 'other')) return false;
      if ((a.score || 0) < minScore) return false;
      if (q && !`${a.title} ${a.titleKo || ''} ${a.titleEn || ''} ${a.summary} ${a.summaryKo || ''} ${a.sourceName || a.feedName} ${a.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'score') return (b.score || 0) - (a.score || 0);
      if (sort === 'category') return a.category.localeCompare(b.category) || +new Date(b.publishedAt) - +new Date(a.publishedAt);
      return +new Date(b.publishedAt) - +new Date(a.publishedAt);
    });
  }, [articles, selectedCategories, selectedLanguages, minScore, query, sort]);

  const feedCounts = useMemo(() => {
    const map = new Map<string, { count: number; region: string; type: string }>();
    articles.forEach((a) => {
      const name = a.sourceName || a.feedName;
      const existing = map.get(name) || { count: 0, region: sourceRegion(name), type: categoryById.get(a.category)?.label || a.category };
      existing.count += 1;
      map.set(name, existing);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [articles, stats.categories]);

  async function refresh(nextDays = days) {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?limit=500&days=${nextDays}`);
      const data = await res.json();
      setArticles(data.articles);
      setStats(data.stats);
    } finally { setLoading(false); }
  }
  async function collectNow() {
    setCollecting(true); setCollectResult(null);
    try {
      const res = await fetch('/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxFeeds: 124, concurrency: 8 }) });
      const data = await res.json();
      if (!res.ok) { setCollectResult(`오류: ${data.error || res.status}`); return; }
      const r = data.result || {};
      setCollectResult(`${r.inserted ?? 0}건 신규 수집 (${r.durationMs ? Math.round(r.durationMs / 1000) + '초' : ''}${r.errors?.length ? `, 실패 ${r.errors.length}건` : ''})`);
      await refresh();
    } catch (e) {
      setCollectResult(`실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setCollecting(false); }
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

  function renderIndicatorCard(ind: IndicatorCard, growth?: IndicatorCard) {
    const up = ind.pctChange !== null && ind.pctChange > 0;
    const down = ind.pctChange !== null && ind.pctChange < 0;
    const isRateIndicator = /%|percent|growth|qoq/i.test(ind.unit);
    const pointDelta = ind.latestValue !== null && ind.previousValue !== null
      ? Math.round((ind.latestValue - ind.previousValue) * 100) / 100
      : null;
    const rateUp = pointDelta !== null && pointDelta > 0;
    const rateDown = pointDelta !== null && pointDelta < 0;
    const changeText = ind.dataStatus === 'stale'
      ? '최신 아님'
      : isRateIndicator && pointDelta !== null
        ? `${rateUp ? '▲' : rateDown ? '▼' : '–'} ${Math.abs(pointDelta)}p`
        : ind.pctChange !== null
          ? `${up ? '▲' : down ? '▼' : '–'} ${Math.abs(ind.pctChange)}%`
          : '전기 데이터 없음';
    const growthLine = formatGrowthLine(growth);
    const badge = indicatorImpactBadge(ind);
    return <div className="indicatorCard" key={ind.id}>
      <div className="indicatorHead">
        <span className="indicatorName">{ind.nameKo}</span>
        <span className={`epBadge ${badge.tone}`} title={badge.title}>{badge.label}</span>
      </div>
      {ind.dataStatus !== 'insufficient' ? <>
        <div className="indicatorValue">
          {formatIndicatorValue(ind.latestValue, ind.unit)}
          <span className="indicatorUnit">{ind.unit}</span>
        </div>
        {growthLine && <div className="indicatorSubMetric">GDP 성장률 <b>{growthLine}</b><span>{formatIndicatorPeriod(growth)}</span></div>}
        <div className={`indicatorChange ${ind.dataStatus === 'stale' ? 'stale' : isRateIndicator ? (rateUp ? 'up' : rateDown ? 'down' : '') : up ? 'up' : down ? 'down' : ''}`}>
          {changeText}
          <span className="indicatorPeriod">{formatIndicatorPeriod(ind)}</span>
        </div>
      </> : <div className="indicatorEmpty">데이터 수집 대기 중</div>}
      {ind.relatedNews && ind.relatedNews.length > 0 && <div className="indicatorNews">
        <span className="indicatorNewsLabel">관련 뉴스</span>
        {ind.relatedNews.map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className="indicatorNewsItem" title={n.title}>{n.title}</a>
        ))}
      </div>}
    </div>;
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
    const lvl = gdpLevelDisplay(ind);
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

  function renderGdpCountryCard(group: {
    country: string;
    quarterly?: IndicatorCard;
    annual?: IndicatorCard;
    quarterlyGrowth?: IndicatorCard;
    annualGrowth?: IndicatorCard;
  }) {
    const primary = group.quarterly || group.annual || group.quarterlyGrowth || group.annualGrowth;
    if (!primary) return null;
    const newsSource = [group.quarterly, group.annual, group.quarterlyGrowth, group.annualGrowth]
      .find((x) => x?.relatedNews && x.relatedNews.length > 0);
    const badge = indicatorImpactBadge(group.quarterly || group.quarterlyGrowth || primary);
    const hasStale = [group.quarterly, group.annual, group.quarterlyGrowth, group.annualGrowth]
      .some((x) => x?.dataStatus === 'stale');
    // [v4.11] 메인 성장률 숫자를 모든 국가에 보장 — QoQ 지표가 없는 나라(중국·
    // 유로존)는 카드에 성장률이 아예 안 떠서 "성장/정체 판별"이 불가능했음.
    // 폴백 체인: ① 분기 QoQ 지표 → ② 연간 YoY 지표 → ③ 실질(연쇄) 분기
    // 수준값의 전기 대비(계절조정된 실질이라 QoQ로 쓰기에 타당; 명목은 제외).
    const isQuarterlyReal = !!group.quarterly && /chained|실질/i.test(`${group.quarterly.unit} ${group.quarterly.nameKo}`);
    const lead = (() => {
      if (group.quarterlyGrowth?.latestValue != null)
        return { v: group.quarterlyGrowth.latestValue, suffix: '% 전분기 대비', qoq: true, ind: group.quarterlyGrowth };
      if (group.annualGrowth?.latestValue != null)
        return { v: group.annualGrowth.latestValue, suffix: '% 전년 대비', qoq: false, ind: group.annualGrowth };
      if (isQuarterlyReal && group.quarterly!.pctChange != null)
        return { v: group.quarterly!.pctChange, suffix: '% 전분기 대비', qoq: true, ind: group.quarterly! };
      return null;
    })();
    const gClass = lead && lead.v > 0 ? 'up' : lead && lead.v < 0 ? 'down' : '';
    // 판정 임계값은 기준이 다름: QoQ는 0.5% 이상이면 성장세, YoY는 2% 이상.
    const judgment = lead === null ? '' : lead.v < 0 ? '역성장' : (lead.qoq ? lead.v > 0.5 : lead.v > 2) ? '성장세' : '정체';
    // 명목(비계절조정) 분기 수준값의 전기 대비 화살표는 계절 노이즈라 숨김.
    const quarterlyIsNominal = !!group.quarterly?.nameKo.includes('명목');
    return <div className="indicatorCard gdpCountryCard" key={`gdp-country-${group.country}`}>
      <div className="indicatorHead">
        <span className="indicatorName">{GDP_COUNTRY_LABELS[group.country] || group.country} GDP</span>
        <span className={`epBadge ${badge.tone}`} title={badge.title}>{badge.label}</span>
      </div>
      {lead !== null && <div className={`indicatorValue gdpGrowthLead ${gClass}`}>
        {lead.v > 0 ? '+' : ''}{lead.v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<span className="indicatorUnit">{lead.suffix}</span>
      </div>}
      <div className="gdpMetricStack">
        {metricLine(
          quarterlyIsNominal ? '분기 명목 GDP' : group.quarterly?.nameKo.includes('실질') ? '분기 실질 GDP' : '분기 GDP',
          group.quarterly,
          { hideDelta: quarterlyIsNominal },
        )}
        {metricLine('연간 명목 GDP', group.annual)}
        {lead?.ind !== group.annualGrowth && metricLine('연간 성장률', group.annualGrowth, { kind: 'growth' })}
      </div>
      <div className={`indicatorChange ${hasStale ? 'stale' : ''}`}>
        {hasStale ? '일부 지표 최신 아님' : judgment}
        <span className="indicatorPeriod">{formatIndicatorPeriod(lead?.ind || primary)}</span>
      </div>
      {newsSource?.relatedNews && newsSource.relatedNews.length > 0 && <div className="indicatorNews">
        <span className="indicatorNewsLabel">관련 뉴스</span>
        {newsSource.relatedNews.map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className="indicatorNewsItem" title={n.title}>{n.title}</a>
        ))}
      </div>}
    </div>;
  }

  return <main className="appShell">
    <aside className="sidebar">
      <div className="logo"><span>EP</span><div className="logoText"><b>Industry Monitor</b><small>Engineering Plastics Intelligence</small></div></div>
      <nav>
        <button className={page === 'feed' ? 'active' : ''} onClick={() => setPage('feed')}>피드</button>
        <button className={page === 'macro' ? 'active' : ''} onClick={() => setPage('macro')}>매크로 지표</button>
        <button className={page === 'sources' ? 'active' : ''} onClick={() => setPage('sources')}>소스</button>
      </nav>
      <div className="sidebarMeta">
        <button className="sidebarCollect" onClick={collectNow} disabled={collecting} title="RSS 소스에서 새 기사를 실제로 가져옵니다">
          {collecting ? '뉴스 수집 중…' : '뉴스 수집'}
        </button>
        <div className="metaRow"><span>최종 수집</span><b>{formatDate(stats.lastCollectedAt)}</b></div>
        <div className="metaRow"><span>파이프라인</span><b>{stats.totalArticles.toLocaleString()}건 수집 → {stats.filteredArticles.toLocaleString()}건 표시</b></div>
        <div className="metaRow"><span>소스</span><b>{stats.totalFeeds}개</b></div>
      </div>
    </aside>
    <section className="content">
      <header className="pageHeader">
        <div className="pageHeaderTitle">
          <span className="eyebrow">{page === 'macro' ? 'Global Indicators' : 'Live Intelligence Feed'}</span>
          <h1>{page === 'sources' ? '소스 현황' : page === 'macro' ? '매크로 & 전방산업 지표' : 'Engineering Plastics'}</h1>
          <p>{page === 'sources' ? `${feedCounts.length}개 소스가 최근 기여한 기사 수`
            : page === 'macro' ? `${indicatorMeta.totalIndicators}개 지표 · ${formatDate(indicatorMeta.generatedAt)} 갱신`
            : `${stats.totalArticles.toLocaleString()}건 수집 · 현재 조건 ${filtered.length.toLocaleString()}건 표시`}</p>
        </div>
        <div className="headerActions">
          {page === 'macro' && <button className="ghost" onClick={refreshIndicators} disabled={indicatorRefreshing}>{indicatorRefreshing ? '지표 갱신 중…' : '지표 갱신'}</button>}
          {page !== 'macro' && <button className="ghost" onClick={() => refresh()} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>}
          <button className="primary" onClick={collectNow} disabled={collecting} title="RSS 소스에서 새 기사를 실제로 가져옵니다 (새로고침과 다름)">{collecting ? '뉴스 수집 중…' : '뉴스 수집'}</button>
        </div>
      </header>
      {collectResult && <div className="collectResult">{collectResult}</div>}
      {indicatorRefreshResult && <div className="collectResult">{indicatorRefreshResult}</div>}

      {page === 'feed' ? <>
        <div className="filters">
          <div className="filterRow">
            <input className="searchInput" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="회사명·소재명 검색: PC, PA66, PEEK, LG Chem…" />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="latest">최신순</option>
              <option value="score">스코어 높은순</option>
              <option value="category">카테고리순</option>
            </select>
          </div>
          <div className="filterRow periodImpactRow">
            <div className="periodGroup">
              {PERIOD_PRESETS.map((p) => (
                <button key={p.days} className={!customDays && days === p.days ? 'active' : ''} onClick={() => changePeriod(p.days)}>{p.label}</button>
              ))}
              <label className={`customDays ${customDays ? 'active' : ''}`}>
                직접입력
                <input type="number" min={1} max={730} value={customDays ? days : ''} placeholder="일수"
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) { setCustomDays(true); setDays(v); } }}
                  onBlur={() => refresh()} onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }} />
              </label>
            </div>
            <label className="scoreSlider">최소 Impact {minScore}<input type="range" min="0" max="100" step="5" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} /></label>
          </div>
          <div className="tabs">
            <button className={!selectedCategories.length ? 'active' : ''} onClick={() => setSelectedCategories([])}>전체 <span>{stats.filteredArticles}</span></button>
            {visibleCategories.map((c) => <button key={c.id} className={selectedCategories.includes(c.id) ? 'active' : ''} style={{ ['--chip' as string]: c.color }} onClick={() => toggle(selectedCategories, c.id, setSelectedCategories)}>{c.label} <span>{stats.counts.find((x) => x.category === c.id)?.count || 0}</span></button>)}
          </div>
          <div className="tabs smallTabs">{Object.entries(LANGUAGE_LABELS).map(([k, v]) => <button key={k} className={selectedLanguages.includes(k) ? 'active' : ''} onClick={() => toggle(selectedLanguages, k, setSelectedLanguages)}>{v}</button>)}</div>
        </div>
        <div className="newsList" key="feed-news-list">{filtered.length === 0 ? <div className="empty"><b>조건에 맞는 기사가 없습니다</b><span>검색어를 지우거나 기간을 늘려보세요. 데이터가 오래됐다면 &ldquo;뉴스 수집&rdquo;을 눌러 새 기사를 가져오세요.</span></div> : filtered.map((a, i) => {
            const cat = categoryById.get(a.category); const color = cat?.color || '#E8A63C';
            // [v1.4] 엄격한 문자열 비교(!==)는 "[매크로] X - 출처" vs "X 출처"처럼
            // 접두사/구두점만 다른 사실상 동일한 텍스트를 서로 다르다고 판단해
            // 번역이 실패했을 때도 영문이 두 줄로 중복 표시되는 버그가 있었음
            // (스크린샷에서 확인: 번역 안 된 영문 제목이 위아래로 거의 그대로 반복).
            // 정규화(소문자·공백·구두점 제거) 후 비교해 진짜 다른 내용일 때만 부제로 노출.
            const normText = (s: string) => s.toLowerCase().replace(/^\[매크로\]\s*/,'').replace(/[^\p{L}\p{N}]+/gu,'').trim();
            const titleKo = a.titleKo || a.title; const titleEn = a.titleEn && normText(a.titleEn) !== normText(titleKo) ? a.titleEn : null;
            const rawSummary = a.summaryKo || a.summary; const titleCore = a.title.replace(/\s[-–—|]\s.*$/,'').trim(); const summaryCore = (rawSummary || '').replace(/\s[-–—|]\s.*$/,'').trim();
            const summary = rawSummary && summaryCore !== titleCore && !summaryCore.includes(titleCore.slice(0, 24)) ? rawSummary : `${cat?.label || 'EP 산업'} 관련 신호입니다. 원문 확인이 필요한 항목으로 분류·중복 병합·스코어링을 통과했습니다.`;
            return <article className="newsCard" key={a.id} style={{ ['--accent' as string]: color, ['--i' as string]: Math.min(i, 12) }}>
              <div className="meta"><span className="cat">{cat?.label || a.category}</span><time>{shortDate(a.publishedAt)}</time><span className="impact">Impact {Math.round(a.score || 0)}</span><span>{LANGUAGE_LABELS[a.language || 'other'] || '기타'}</span>{(a.duplicateCount || 1) > 1 && <span className="merged">{a.duplicateCount}개 매체 보도</span>}</div>
              <h3>{titleKo}{titleEn && <span className="titleEn">{titleEn}</span>}</h3>
              <p>{summary || '요약 없음'}</p>
              <div className="cardFooter"><span>{(a.duplicateSources || []).slice(0, 3).join(' · ')}</span><a href={a.link} target="_blank" rel="noreferrer">[{a.sourceName || a.feedName}] ↗</a></div>
            </article>;
          })}</div>
      </> : page === 'macro' ? <>
        <div className="filters">
          <div className="tabs">
            {HORIZON_TABS.map((f) => (
              <button key={f.key} className={indicatorHorizonKey === f.key ? 'active' : ''} onClick={() => changeIndicatorHorizon(f.key)}>
                {f.label} <span>{horizonCount(indicatorCounts, f.key)}</span>
              </button>
            ))}
          </div>
        </div>
        {indicatorLoading ? <div className="indicatorGrid" key="macro-loading"><div className="empty"><b>불러오는 중…</b></div></div> : indicators.length === 0 ? <div className="indicatorGrid" key="macro-empty"><div className="empty"><b>이 시간축에 등록된 지표가 없습니다</b></div></div> : indicatorHorizonKey === 'long' ? <div className="indicatorSections" key="macro-gdp-country-grouped">
          <section className="indicatorSection">
            <div className="indicatorSectionHead"><b>국가별 GDP</b></div>
            <div className="indicatorGrid">{longGdpGroups.map((group) => renderGdpCountryCard(group))}</div>
          </section>
        </div> : <div className="indicatorGrid" key={`macro-indicator-grid-${indicatorHorizonKey}`}>{indicators.map((ind) => renderIndicatorCard(ind))}</div>}
      </> : <>
        <div className="filters"><input className="searchInput" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="소스 검색…" /></div>
        <div className="sourceList">{feedCounts.filter(([name]) => !query || name.toLowerCase().includes(query.toLowerCase())).map(([name, info]) => <div className="sourceRow" key={name}><div className="sourceInfo"><b>{name}</b><span>{info.region} · {info.type}</span></div><div className="sourceStats"><strong>{info.count}</strong><span>최근 기여</span></div></div>)}</div>
      </>}
    </section>
  </main>;
}
