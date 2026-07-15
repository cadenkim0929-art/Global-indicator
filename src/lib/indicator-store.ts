import fs from 'fs';
import path from 'path';
import type { IndicatorCatalogItem, IndicatorObservation, IndicatorCard, IndicatorFrequency, RelatedNewsItem } from './types';
import { queryArticles } from './news-store';

// [v1.0] Global Indicators MVP(별도 Python+SQLite 프로젝트) 통합 — 하나의 앱
// 안에 "매크로 지표" 탭으로 편입. 원본 프로젝트는 계속 Python 수집기로 SQLite에
// 데이터를 쌓고, scripts/export_indicators_for_ep.py(이 저장소가 아니라 원본
// global-indicators 프로젝트 쪽에 둠)가 주기적으로 이 JSON을 갱신하는 구조.
const DATA_PATH = path.join(process.cwd(), 'src/data/indicators.json');

interface IndicatorsFile {
  version: string;
  generatedAt: string;
  indicators: IndicatorCatalogItem[];
  observations: IndicatorObservation[];
  indicatorRefresh?: {
    generatedAt?: string;
    source?: string;
    rowsUpserted?: number;
    failures?: Array<{ indicatorId: string; url?: string; error: string }>;
    skipped?: Array<{ indicatorId: string; period?: string; reason: string }>;
  };
}

let cache: IndicatorsFile | null = null;
let cacheReadAt = 0;
const CACHE_TTL_MS = 30_000; // 30초 — 파일이 외부(Python export)에서 갱신될 수 있으므로 짧게

function parsePeriodDate(period?: string | null): Date | null {
  if (!period) return null;
  const normalized = /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : period;
  const d = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFresh(period: string | null | undefined, frequency: IndicatorFrequency): boolean {
  const d = parsePeriodDate(period);
  if (!d) return false;
  const now = Date.now();
  const ageDays = (now - d.getTime()) / 86_400_000;
  const limits: Record<IndicatorFrequency, number> = {
    daily: 21,
    monthly: 120,
    quarterly: 220,
    yearly: 700,
  };
  return ageDays <= limits[frequency];
}

function daysBetween(a?: string | null, b?: string | null): number | null {
  const da = parsePeriodDate(a);
  const db = parsePeriodDate(b);
  if (!da || !db) return null;
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86_400_000);
}

function maxExpectedIntervalDays(frequency: IndicatorFrequency): number {
  // Daily market indicators can skip weekends/holidays, but an 8-day gap must not
  // be displayed as a normal one-period move. Monthly/quarterly/yearly thresholds
  // are intentionally wider to avoid false warnings from release calendars.
  if (frequency === 'daily') return 4;
  if (frequency === 'monthly') return 45;
  if (frequency === 'quarterly') return 120;
  return 430;
}

// [v1.2] 지표별 관련뉴스 매칭. 입력 뉴스 풀을 macro-trade로 제한하되,
// 국가/권역 alias + 지표축 topic을 함께 점수화한다. 영어 기사에서도 Korea/China/Japan
// 등을 잡아야 하므로 country는 단일 한국어 문자열이 아니라 aliases 배열로 관리한다.
type IndicatorNewsSpec = { countries?: string[]; topics: string[]; boost?: string[] };
const COUNTRY_ALIASES: Record<string, string[]> = {
  us: ['미국','us ','u.s.','united states','america','federal reserve','fed'],
  korea: ['한국','korea','south korea','korean','bank of korea','bok'],
  china: ['중국','china','chinese','beijing','中国'],
  japan: ['일본','japan','japanese','boj','日本'],
  eurozone: ['유로존','eurozone','euro area','europe','ecb','eu '],
  india: ['인도','india','indian'],
};
const GDP_TOPICS = ['gdp','gross domestic product','economic growth','economic outlook','growth forecast','economy grew','economy','growth','forecast','경제성장','경제 성장','경제전망','국내총생산','성장률'];
const PMI_TOPICS = ['manufacturing pmi','ism manufacturing','purchasing managers index','factory activity','factory activity grows','factory activity slows','factory sector','제조업 pmi','제조업 경기','구매관리자지수'];
const IP_TOPICS = ['industrial production','factory output','manufacturing output','industrial output','factory activity','manufacturing pmi','export demand','산업생산','제조업 생산','공장 생산','제조업 경기'];
const INFLATION_TOPICS = ['cpi','inflation','consumer prices','price pressure','물가','소비자물가','인플레이션'];
const FX_TOPICS = ['exchange rate','currency','won','yuan','dollar','usd/krw','usd/cny','환율','원화','위안화'];
const OIL_TOPICS = ['brent','wti','crude oil','oil prices','naphtha','feedstock','유가','원유','나프타'];
const RATE_TOPICS = ['treasury yield','10-year treasury','bond yield','fed','fomc','interest rate','금리','국채금리','연준'];
const INDICATOR_NEWS_TOPICS: Record<string, IndicatorNewsSpec> = {
  fx_usd_krw: { countries: COUNTRY_ALIASES.korea, topics: FX_TOPICS, boost: ['won','원화','usd/krw'] },
  fx_usd_cny: { countries: COUNTRY_ALIASES.china, topics: FX_TOPICS, boost: ['yuan','위안','usd/cny'] },
  oil_brent: { topics: OIL_TOPICS, boost: ['brent'] },
  oil_wti: { topics: OIL_TOPICS, boost: ['wti'] },
  rate_us_10y: { countries: COUNTRY_ALIASES.us, topics: RATE_TOPICS, boost: ['10-year treasury','treasury yield'] },
  industrial_production_korea: { countries: COUNTRY_ALIASES.korea, topics: IP_TOPICS },
  industrial_production_japan: { countries: COUNTRY_ALIASES.japan, topics: IP_TOPICS },
  industrial_production_eurozone: { countries: COUNTRY_ALIASES.eurozone, topics: IP_TOPICS },
  industrial_production_india: { countries: COUNTRY_ALIASES.india, topics: IP_TOPICS },
  cpi_china: { countries: COUNTRY_ALIASES.china, topics: INFLATION_TOPICS },
  pmi_manufacturing_china_te: { countries: COUNTRY_ALIASES.china, topics: PMI_TOPICS },
  pmi_manufacturing_us_news: { countries: COUNTRY_ALIASES.us, topics: PMI_TOPICS },
  pmi_manufacturing_korea_news: { countries: COUNTRY_ALIASES.korea, topics: PMI_TOPICS },
  pmi_manufacturing_japan_news: { countries: COUNTRY_ALIASES.japan, topics: PMI_TOPICS },
  pmi_manufacturing_eurozone_news: { countries: COUNTRY_ALIASES.eurozone, topics: PMI_TOPICS },
  gdp_quarterly_us: { countries: COUNTRY_ALIASES.us, topics: GDP_TOPICS },
  gdp_qoq_us: { countries: COUNTRY_ALIASES.us, topics: GDP_TOPICS },
  gdp_current_usd: { countries: COUNTRY_ALIASES.us, topics: GDP_TOPICS },
  gdp_quarterly_korea: { countries: COUNTRY_ALIASES.korea, topics: GDP_TOPICS },
  gdp_qoq_korea: { countries: COUNTRY_ALIASES.korea, topics: GDP_TOPICS },
  gdp_annual_korea: { countries: COUNTRY_ALIASES.korea, topics: GDP_TOPICS },
  gdp_quarterly_japan: { countries: COUNTRY_ALIASES.japan, topics: GDP_TOPICS },
  gdp_qoq_japan: { countries: COUNTRY_ALIASES.japan, topics: GDP_TOPICS },
  gdp_annual_japan: { countries: COUNTRY_ALIASES.japan, topics: GDP_TOPICS },
  gdp_quarterly_eurozone: { countries: COUNTRY_ALIASES.eurozone, topics: GDP_TOPICS },
  gdp_annual_eurozone: { countries: COUNTRY_ALIASES.eurozone, topics: GDP_TOPICS },
  gdp_qoq_india: { countries: COUNTRY_ALIASES.india, topics: GDP_TOPICS },
  gdp_quarterly_india: { countries: COUNTRY_ALIASES.india, topics: GDP_TOPICS },
  gdp_annual_india: { countries: COUNTRY_ALIASES.india, topics: GDP_TOPICS },
  gdp_quarterly_china: { countries: COUNTRY_ALIASES.china, topics: GDP_TOPICS },
  gdp_qoq_china_te: { countries: COUNTRY_ALIASES.china, topics: GDP_TOPICS },
  gdp_annual_china: { countries: COUNTRY_ALIASES.china, topics: GDP_TOPICS },
};

// [v1.1] 매크로 뉴스 전체를 한 번만 읽어서 재사용(반복 검색 호출 줄임) —
// getIndicatorCards() 호출 1번당 최대 22번 queryArticles를 부르던 것을 1번으로.
let macroNewsCache: ReturnType<typeof queryArticles> | null = null;
let macroNewsCacheAt = 0;
function getMacroNewsPool() {
  const now = Date.now();
  if (macroNewsCache && now - macroNewsCacheAt < CACHE_TTL_MS) return macroNewsCache;
  macroNewsCache = queryArticles({ category: 'macro-trade', days: 90, limit: 300 });
  macroNewsCacheAt = now;
  return macroNewsCache;
}

function getRelatedNews(indicatorId: string, limit = 3): RelatedNewsItem[] {
  const spec = INDICATOR_NEWS_TOPICS[indicatorId];
  if (!spec) return [];
  try {
    const pool = getMacroNewsPool();
    const scored = pool
      .map(a => {
        const text = `${a.title} ${a.titleKo || ''} ${a.summary} ${a.summaryKo || ''} ${a.feedName || ''} ${a.sourceName || ''}`.toLowerCase();
        const pmiFalsePositive = indicatorId.includes('pmi_manufacturing') && (
          text.includes('services pmi') || text.includes('service pmi') || text.includes('services activity') || text.includes('service activity') ||
          text.includes('서비스 pmi') || text.includes('서비스업') || text.includes('서비스 활동') ||
          text.includes('zyn ') || text.includes('philip morris') || text.includes('pmi us,') || text.includes('pmi us ')
        );
        if (pmiFalsePositive) return { article: a, topicHits: 0, countryHits: 0, score: -999 };
        const topicHits = spec.topics.filter(w => text.includes(w.toLowerCase())).length;
        const countryHits = (spec.countries || []).filter(w => text.includes(w.toLowerCase())).length;
        const boostHits = (spec.boost || []).filter(w => text.includes(w.toLowerCase())).length;
        const freshness = Math.max(0, 1 - ((Date.now() - new Date(a.publishedAt).getTime()) / 86_400_000) / 45);
        return { article: a, topicHits, countryHits, score: topicHits * 2 + countryHits * 1.2 + boostHits * 1.5 + freshness };
      })
      // 지표축 topic은 반드시 맞아야 한다. 국가/권역이 지정된 지표는 국가 alias도 반드시 맞아야 한다.
      .filter(x => x.topicHits >= 1 && (!spec.countries?.length || x.countryHits >= 1))
      .sort((a, b) => b.score - a.score || +new Date(b.article.publishedAt) - +new Date(a.article.publishedAt));
    const seen = new Set<string>();
    return scored.filter(({ article: a }) => {
      const key = `${a.link || ''}|${(a.titleKo || a.title || '').slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit).map(({ article: a }) => ({
      title: a.titleKo || a.title, link: a.link, publishedAt: a.publishedAt, sourceName: a.sourceName || a.feedName,
      summary: a.summaryKo || a.summary || undefined, tags: (a.tags && a.tags.length > 0) ? a.tags.slice(0, 3) : undefined,
    }));
  } catch {
    return [];
  }
}

function readFile(): IndicatorsFile {
  const now = Date.now();
  if (cache && now - cacheReadAt < CACHE_TTL_MS) return cache;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    cache = JSON.parse(raw);
    cacheReadAt = now;
  } catch {
    cache = { version: 'empty', generatedAt: new Date().toISOString(), indicators: [], observations: [] };
  }
  return cache!;
}

export function clearIndicatorCache() {
  cache = null;
  cacheReadAt = 0;
}

export function getIndicatorMeta(): { version: string; generatedAt: string; totalIndicators: number } {
  const f = readFile();
  return { version: f.version, generatedAt: f.generatedAt, totalIndicators: f.indicators.length, ...(f.indicatorRefresh ? { indicatorRefresh: f.indicatorRefresh } : {}) } as { version: string; generatedAt: string; totalIndicators: number };
}

/** 프론트에서 쓸 카드 목록: 카탈로그 + 최신 2개 관측치(전기 대비 계산용) 결합 */
export function getIndicatorCards(frequency?: IndicatorFrequency): IndicatorCard[] {
  const f = readFile();
  const byIndicator = new Map<string, IndicatorObservation[]>();
  for (const obs of f.observations) {
    const list = byIndicator.get(obs.indicatorId) || [];
    list.push(obs);
    byIndicator.set(obs.indicatorId, list);
  }
  for (const list of byIndicator.values()) {
    list.sort((a, b) => (b.period || '').localeCompare(a.period || ''));
  }

  const cards: IndicatorCard[] = f.indicators
    .filter(ind => !frequency || ind.frequency === frequency)
    .map(ind => {
      const obs = byIndicator.get(ind.id) || [];
      const latest = obs[0];
      const previous = obs[1];
      const intervalDays = latest && previous ? daysBetween(latest.period, previous.period) : null;
      const hasGap = intervalDays !== null && intervalDays > maxExpectedIntervalDays(ind.frequency);
      const pctChange = latest && previous && previous.value !== 0 && !hasGap
        ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100
        : null;
      const latestFresh = latest ? isFresh(latest.period, ind.frequency) : false;
      return {
        ...ind,
        latestValue: latest ? latest.value : null,
        latestPeriod: latest ? latest.period : null,
        previousPeriod: previous ? previous.period : null,
        previousValue: previous ? previous.value : null,
        pctChange: pctChange !== null ? Math.round(pctChange * 100) / 100 : null,
        dataStatus: latest ? (latestFresh && !hasGap ? 'ok' : 'stale') : 'insufficient',
        changeStatus: !latest || !previous ? 'insufficient' : hasGap ? 'gap' : 'ok',
        changeIntervalDays: intervalDays,
        dataWarning: hasGap ? `직전 관측치와 ${intervalDays}일 간격 — 누적 변동을 전기 대비로 표시하지 않음` : undefined,
        history: obs.slice(0, 8).reverse(), // 과거→최신 순, 스파크라인용
        relatedNews: getRelatedNews(ind.id),
      };
    });

  // EP 연관 지표를 우선 정렬, 그다음 데이터 있는 것 우선
  cards.sort((a, b) => {
    if (a.epRelevant !== b.epRelevant) return a.epRelevant ? -1 : 1;
    if ((a.dataStatus === 'ok') !== (b.dataStatus === 'ok')) return a.dataStatus === 'ok' ? -1 : 1;
    return a.nameKo.localeCompare(b.nameKo, 'ko');
  });
  return cards;
}

export function getIndicatorHistory(indicatorId: string): IndicatorObservation[] {
  const f = readFile();
  return f.observations
    .filter(o => o.indicatorId === indicatorId)
    .sort((a, b) => (a.period || '').localeCompare(b.period || ''));
}

export function getFrequencyCounts(): Record<IndicatorFrequency, number> {
  const f = readFile();
  const counts: Record<string, number> = { daily: 0, monthly: 0, quarterly: 0, yearly: 0 };
  for (const ind of f.indicators) counts[ind.frequency] = (counts[ind.frequency] || 0) + 1;
  return counts as Record<IndicatorFrequency, number>;
}

export type IndicatorDetailCard = IndicatorCard & { fullHistory: IndicatorObservation[] };

export function getIndicatorDetail(indicatorId: string): IndicatorDetailCard | null {
  const card = getIndicatorCards().find((item) => item.id === indicatorId);
  if (!card) return null;
  return { ...card, fullHistory: getIndicatorHistory(indicatorId) };
}

function detailGdpCountry(indicatorId: string) {
  if (indicatorId.includes('korea')) return 'korea';
  if (indicatorId.includes('japan')) return 'japan';
  if (indicatorId.includes('india')) return 'india';
  if (indicatorId.includes('china')) return 'china';
  if (indicatorId.includes('eurozone')) return 'eurozone';
  if (indicatorId.includes('_us') || indicatorId === 'gdp_current_usd') return 'us';
  return null;
}

export function getGdpCountryDetail(country: string): IndicatorDetailCard[] {
  return getIndicatorCards()
    .filter((item) => (item.id.startsWith('gdp_') || item.id === 'gdp_current_usd') && detailGdpCountry(item.id) === country)
    .map((item) => ({ ...item, fullHistory: getIndicatorHistory(item.id) }));
}

