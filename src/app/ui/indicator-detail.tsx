'use client';

import { useMemo, useState } from 'react';
import type { IndicatorCard, IndicatorFrequency, IndicatorObservation } from '@/lib/types';
import { displayArticleTitle, indicatorNameFor, sourceNameFor, t, type UiLang } from './format-utils';

type IndicatorProfile = 'pmi' | 'rate' | 'fx' | 'commodity' | 'production' | 'inflation' | 'growth' | 'gdp-level' | 'default';

type DetailSeries = IndicatorCard & {
  fullHistory: IndicatorObservation[];
  seriesLabel: string;
};

interface IndicatorDetailProps {
  title: string;
  subtitle: string;
  series: DetailSeries[];
  defaultSeriesId: string;
}

type StatItem = { label: string; value: string; note?: string };

function profileFor(indicator: IndicatorCard): IndicatorProfile {
  if (indicator.id.includes('pmi')) return 'pmi';
  if (indicator.id.startsWith('rate_')) return 'rate';
  if (indicator.id.startsWith('fx_')) return 'fx';
  if (indicator.id.startsWith('oil_')) return 'commodity';
  if (indicator.id.startsWith('industrial_production_')) return 'production';
  if (indicator.id.startsWith('cpi_')) return 'inflation';
  if (indicator.id.startsWith('gdp_qoq_') || /growth|yoy|qoq/i.test(indicator.unit)) return 'growth';
  if (indicator.id.startsWith('gdp_')) return 'gdp-level';
  return 'default';
}

function compactUnit(unit: string, lang: UiLang = 'ko') {
  if (/krw per usd/i.test(unit)) return t(lang, '원/USD', 'KRW/USD');
  if (/cny per usd/i.test(unit)) return t(lang, '위안/USD', 'CNY/USD');
  if (/usd\/bbl/i.test(unit)) return 'USD/bbl';
  if (/percent|growth|yoy|qoq/i.test(unit)) return '%';
  if (/points/i.test(unit)) return 'pt';
  return unit;
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ko-KR', { maximumFractionDigits });
}

function formatValue(value: number | null | undefined, unit: string, lang: UiLang = 'ko') {
  if (value == null) return '—';
  return `${formatNumber(value, Math.abs(value) < 10 ? 3 : 2)} ${compactUnit(unit, lang)}`;
}

function deltaPct(latest?: number, previous?: number) {
  if (latest == null || previous == null || previous === 0) return null;
  return ((latest - previous) / Math.abs(previous)) * 100;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function directionClass(value: number | null) {
  if (value == null || value === 0) return '';
  return value > 0 ? 'up' : 'down';
}

function formatPeriod(period: string | null, frequency: IndicatorFrequency) {
  if (!period) return '수집 전';
  if (frequency === 'yearly') return period.slice(0, 4);
  if (frequency === 'quarterly') {
    const year = period.slice(0, 4);
    const month = Number(period.slice(5, 7));
    return Number.isFinite(month) && month > 0 ? `${year}-Q${Math.floor((month - 1) / 3) + 1}` : period;
  }
  if (frequency === 'monthly') return period.slice(0, 7);
  return period.slice(0, 10);
}

function descriptions(indicator: IndicatorCard, lang: UiLang = 'ko') {
  const profile = profileFor(indicator);
  const copy = {
    pmi: {
      overview: '제조업 구매관리자의 신규 주문, 생산, 고용과 재고 판단을 집계한 선행성 경기지표입니다. 50을 넘으면 제조업 활동의 확장, 50 미만이면 수축을 뜻합니다.',
      implication: 'PMI의 신규 주문과 생산 방향은 자동차·전기전자·산업재용 엔지니어링 플라스틱의 단기 수요 회복 여부를 판단하는 데 유용합니다.',
    },
    rate: {
      overview: '시장 금리와 금융여건을 보여주는 지표입니다. 금리 변화는 기업의 자금조달 비용과 설비투자 의사결정에 영향을 줍니다.',
      implication: '금리 상승은 전방산업의 투자와 재고 확보를 제약할 수 있고, 하락은 자금조달 부담을 낮춰 중기 수요에 우호적으로 작용할 수 있습니다.',
    },
    fx: {
      overview: '주요 통화 간 교환가치를 나타내는 일간 시장지표입니다. 수입 원료비와 수출 채산성에 동시에 영향을 줍니다.',
      implication: '원화와 위안화의 방향은 EP 원료 조달비, 수출 가격 경쟁력, 지역별 마진을 함께 점검할 때 중요한 기준이 됩니다.',
    },
    commodity: {
      overview: '국제 원유 가격은 나프타와 석유화학 feedstock 비용의 선행 신호로 활용되는 대표적인 일간 원자재 지표입니다.',
      implication: '유가가 급등하면 원료비와 운송비 부담이 커질 수 있으며, 수요가 따라오지 못하면 EP 스프레드와 마진에 하방 압력이 생길 수 있습니다.',
    },
    production: {
      overview: '광공업과 제조업의 실제 생산활동을 지수화한 월간 실물경기 지표입니다. PMI보다 후행하지만 실제 생산 수준을 확인하는 데 유용합니다.',
      implication: '산업생산의 연속적인 개선은 자동차, 전기전자, 기계 등 EP 주요 전방산업의 소재 소비가 회복될 가능성을 높입니다.',
    },
    inflation: {
      overview: '소비자가 구매하는 상품과 서비스 가격의 변화를 지수로 나타낸 월간 물가지표입니다.',
      implication: '물가 압력은 금리, 임금, 물류비와 소비 여력에 영향을 주므로 EP 전방산업의 비용과 최종수요를 함께 판단하는 보조지표로 활용할 수 있습니다.',
    },
    growth: {
      overview: '경제활동의 증가 또는 감소 속도를 보여주는 성장률 지표입니다. 기준이 전분기 대비인지 전년 대비인지 단위와 지표명을 함께 확인해야 합니다.',
      implication: '성장률의 방향은 전방 제조업 수요의 큰 흐름을 보여줍니다. 단일 발표치보다 여러 분기의 평균과 연속성을 함께 보는 것이 중요합니다.',
    },
    'gdp-level': {
      overview: '국가 또는 권역에서 일정 기간 생산된 최종 재화와 서비스의 총가치를 보여주는 경제 규모 지표입니다.',
      implication: 'GDP 수준은 시장의 장기 규모를, 실질 GDP 추세는 전방수요의 방향을 보여줍니다. 통화와 명목·실질 기준이 다른 국가 간 절대값 직접 비교에는 주의가 필요합니다.',
    },
    default: {
      overview: '글로벌 경기와 EP 전방산업 환경을 판단하기 위해 추적하는 핵심 경제지표입니다.',
      implication: '최신값뿐 아니라 직전 관측치, 장기 평균, 관련 뉴스와 함께 해석해야 일시적 변동과 구조적 추세를 구분할 수 있습니다.',
    },
  } as const;
  if (lang === 'ko') return copy[profile];
  const en = {
    pmi: { overview: 'A forward-looking manufacturing cycle indicator based on purchasing managers’ views on new orders, production, employment and inventories. Readings above 50 indicate expansion; below 50 indicate contraction.', implication: 'New orders and production direction in PMI help judge short-term demand recovery for engineering plastics used in automotive, electronics and industrial goods.' },
    rate: { overview: 'A market-rate and financial-conditions indicator. Rate moves affect corporate funding costs and capital investment decisions.', implication: 'Higher rates can constrain downstream investment and inventory building, while lower rates can ease financing pressure and support medium-term demand.' },
    fx: { overview: 'A daily market indicator showing exchange value between major currencies. It affects imported feedstock costs and export profitability.', implication: 'KRW and CNY direction is important when reviewing EP feedstock procurement, export competitiveness and regional margins.' },
    commodity: { overview: 'International crude oil prices are daily commodity indicators used as leading signals for naphtha and petrochemical feedstock costs.', implication: 'A sharp oil-price rise can raise feedstock and logistics costs; if demand does not follow, EP spreads and margins can face pressure.' },
    production: { overview: 'A monthly real-economy indicator indexing actual mining and manufacturing production activity. It lags PMI but confirms production levels.', implication: 'Sustained improvement in industrial production can signal recovering material consumption in EP downstream sectors such as automotive, electronics and machinery.' },
    inflation: { overview: 'A monthly price indicator tracking changes in consumer goods and services.', implication: 'Inflation pressure affects rates, wages, logistics costs and consumer purchasing power, making it a useful companion signal for EP costs and end demand.' },
    growth: { overview: 'A growth-rate indicator showing the speed of economic expansion or contraction. Check whether the basis is QoQ or YoY together with the unit and indicator name.', implication: 'Growth direction shows broad downstream manufacturing demand. It is better to review multi-quarter averages and continuity than a single release.' },
    'gdp-level': { overview: 'An economic-scale indicator showing the total value of final goods and services produced in a country or region over a period.', implication: 'GDP level indicates long-term market scale, while real GDP trends show the direction of downstream demand. Be careful when comparing absolute values across countries with different currencies and nominal/real bases.' },
    default: { overview: 'A core economic indicator tracked to assess global conditions and the EP downstream environment.', implication: 'Interpret latest values together with prior observations, longer-term averages and related news to distinguish temporary moves from structural trends.' },
  } as const;
  return en[profile];
}

function buildStats(indicator: IndicatorCard, selected: IndicatorObservation[], full: IndicatorObservation[], lang: UiLang = 'ko'): StatItem[] {
  const values = selected.map((item) => item.value);
  const latest = values.at(-1);
  const previous = values.at(-2);
  const delta = latest != null && previous != null ? latest - previous : null;
  const avg = average(values);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const profile = profileFor(indicator);

  if (profile === 'pmi') {
    return [
      { label: t(lang, '직전 관측치', 'Previous observation'), value: formatValue(previous, indicator.unit, lang) },
      { label: t(lang, '50 기준선 대비', 'vs 50 baseline'), value: latest == null ? '—' : `${latest >= 50 ? '+' : ''}${formatNumber(latest - 50)}p`, note: latest != null && latest >= 50 ? t(lang, '확장 국면', 'Expansion') : t(lang, '수축 국면', 'Contraction') },
      { label: t(lang, '최근 3회 평균', 'Last 3 avg'), value: formatValue(average(values.slice(-3)), indicator.unit, lang) },
      { label: t(lang, '선택 기간 확장', 'Expansion count'), value: `${values.filter((value) => value >= 50).length}/${values.length}${t(lang, '회', '')}` },
    ];
  }

  if (profile === 'rate') {
    return [
      { label: t(lang, '직전 금리', 'Previous rate'), value: formatValue(previous, indicator.unit, lang) },
      { label: t(lang, '전기 대비', 'vs prior'), value: delta == null ? '—' : `${delta >= 0 ? '+' : ''}${formatNumber(delta * 100, 1)}bp` },
      { label: t(lang, '선택 기간 평균', 'Selected-period avg'), value: formatValue(avg, indicator.unit, lang) },
      { label: t(lang, '관측값 범위', 'Observation range'), value: min == null || max == null ? '—' : `${formatNumber(min)}–${formatNumber(max)}%` },
    ];
  }

  if (profile === 'production' || profile === 'inflation') {
    const fullValues = full.map((item) => item.value);
    const yearAgo = fullValues.length >= 13 ? fullValues.at(-13) : null;
    const yoy = latest != null && yearAgo != null ? deltaPct(latest, yearAgo) : null;
    return [
      { label: t(lang, '직전 관측치', 'Previous observation'), value: formatValue(previous, indicator.unit, lang) },
      { label: t(lang, '전월 대비', 'MoM'), value: deltaPct(latest, previous) == null ? '—' : `${deltaPct(latest, previous)! >= 0 ? '+' : ''}${formatNumber(deltaPct(latest, previous))}%` },
      { label: t(lang, '전년 동월 대비', 'YoY same month'), value: yoy == null ? t(lang, '데이터 부족', 'Insufficient data') : `${yoy >= 0 ? '+' : ''}${formatNumber(yoy)}%` },
      { label: t(lang, '최근 3개월 평균', 'Last 3-month avg'), value: formatValue(average(values.slice(-3)), indicator.unit, lang) },
    ];
  }

  if (profile === 'growth') {
    return [
      { label: t(lang, '직전 성장률', 'Previous growth'), value: formatValue(previous, indicator.unit, lang) },
      { label: t(lang, '전기 대비 변화폭', 'Change vs prior'), value: delta == null ? '—' : `${delta >= 0 ? '+' : ''}${formatNumber(delta)}p` },
      { label: t(lang, '최근 4회 평균', 'Last 4 avg'), value: formatValue(average(values.slice(-4)), indicator.unit, lang) },
      { label: t(lang, '선택 기간 성장', 'Positive growth count'), value: `${values.filter((value) => value > 0).length}/${values.length}${t(lang, '회', '')}` },
    ];
  }

  const start = values[0];
  const startChange = deltaPct(latest, start);
  return [
    { label: t(lang, '직전 관측치', 'Previous observation'), value: formatValue(previous, indicator.unit, lang) },
    { label: profile === 'fx' || profile === 'commodity' ? t(lang, '전기 대비', 'vs prior') : t(lang, '기간 시작 대비', 'vs period start'), value: `${profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous) : startChange}` === 'null' ? '—' : `${(profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous)! : startChange!) >= 0 ? '+' : ''}${formatNumber(profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous) : startChange)}%` },
    { label: t(lang, '선택 기간 평균', 'Selected-period avg'), value: formatValue(avg, indicator.unit, lang) },
    { label: t(lang, '관측값 범위', 'Observation range'), value: min == null || max == null ? '—' : `${formatNumber(min)}–${formatNumber(max)} ${compactUnit(indicator.unit)}` },
  ];
}

function TrendChart({ indicator, observations, lang = 'ko' }: { indicator: IndicatorCard; observations: IndicatorObservation[]; lang?: UiLang }) {
  const values = observations.map((item) => item.value);
  if (values.length < 2) return <div className="detailChartEmpty">{t(lang, '차트를 표시할 관측치가 부족합니다.', 'Not enough observations to display a chart.')}</div>;

  const profile = profileFor(indicator);
  const baseline = profile === 'pmi' ? 50 : profile === 'growth' ? 0 : null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (baseline != null) { min = Math.min(min, baseline); max = Math.max(max, baseline); }
  const rawSpread = max - min;
  const pad = rawSpread === 0 ? Math.max(Math.abs(max) * 0.04, 1) : rawSpread * 0.12;
  min -= pad; max += pad;

  const width = 760; const height = 300;
  const left = 58; const right = 24; const top = 24; const bottom = 44;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const x = (index: number) => left + (index / Math.max(1, values.length - 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / Math.max(Number.EPSILON, max - min)) * plotHeight;
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' ');
  const gridValues = Array.from({ length: 4 }, (_, index) => max - ((max - min) * index) / 3);
  const latest = observations.at(-1)!;

  return <div className="detailChartWrap">
    <svg className="detailChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${indicatorNameFor(indicator.id, indicator.nameKo, lang)} ${t(lang, '선택 기간 추세 차트', 'selected-period trend chart')}`}>
      <title>{indicatorNameFor(indicator.id, indicator.nameKo, lang)} {t(lang, '선택 기간 추세', 'selected-period trend')}</title>
      {gridValues.map((value) => <g key={value}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="detailGridLine" />
        <text x={left - 10} y={y(value) + 4} textAnchor="end" className="detailAxisLabel">{formatNumber(value)}</text>
      </g>)}
      {baseline != null && <g>
        <line x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} className="detailBaseline" />
        <text x={width - right} y={y(baseline) - 7} textAnchor="end" className="detailBaselineLabel">{profile === 'pmi' ? t(lang, '확장·수축 기준 50', 'Expansion/contraction baseline 50') : t(lang, '성장 기준 0', 'Growth baseline 0')}</text>
      </g>}
      <path d={path} className="detailTrendLine" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="5" className="detailTrendDot" />
      <text x={left} y={height - 14} className="detailAxisLabel">{formatPeriod(observations[0].period, indicator.frequency)}</text>
      <text x={width - right} y={height - 14} textAnchor="end" className="detailAxisLabel">{formatPeriod(latest.period, indicator.frequency)}</text>
    </svg>
  </div>;
}

export default function IndicatorDetail({ subtitle, series, defaultSeriesId }: IndicatorDetailProps) {
  const [seriesId, setSeriesId] = useState(defaultSeriesId);
  const [uiLang, setUiLang] = useState<UiLang>(() => {
    if (typeof window === 'undefined') return 'ko';
    const saved = window.localStorage.getItem('ep-monitor-ui-lang');
    return saved === 'en' ? 'en' : 'ko';
  });
  function changeUiLang(next: UiLang) {
    setUiLang(next);
    window.localStorage.setItem('ep-monitor-ui-lang', next);
  }
  const active = series.find((item) => item.id === seriesId) || series[0];
  const selected = active.fullHistory;
  const stats = useMemo(() => buildStats(active, selected, active.fullHistory, uiLang), [active, selected, uiLang]);
  const latest = active.latestValue;
  const previous = active.previousValue;
  const pointDelta = latest != null && previous != null ? latest - previous : null;
  const profile = profileFor(active);
  const hasGap = active.changeStatus === 'gap';
  const change = hasGap ? null : profile === 'rate' && pointDelta != null
    ? pointDelta * 100
    : profile === 'pmi' || profile === 'growth' ? pointDelta : deltaPct(latest ?? undefined, previous ?? undefined);
  const changeSuffix = profile === 'rate' ? 'bp' : profile === 'pmi' || profile === 'growth' ? 'p' : '%';
  const copy = descriptions(active, uiLang);
  const displayTitle = indicatorNameFor(active.id, active.nameKo, uiLang);

  return <>
    <div className="detailLangToggle languageToggle" role="group" aria-label={t(uiLang, '표시 언어', 'Display language')}>
      <button type="button" className={uiLang === 'ko' ? 'active' : ''} onClick={() => changeUiLang('ko')}>한국어</button>
      <button type="button" className={uiLang === 'en' ? 'active' : ''} onClick={() => changeUiLang('en')}>English</button>
    </div>
    {series.length > 1 && <div className="detailSeriesTabs" role="tablist" aria-label={t(uiLang, 'GDP 상세 시리즈', 'GDP detail series')}>
      {series.map((item) => <button key={item.id} role="tab" aria-selected={item.id === active.id} className={item.id === active.id ? 'active' : ''} onClick={() => setSeriesId(item.id)}>{uiLang === 'en' ? indicatorNameFor(item.id, item.nameKo, uiLang) : item.seriesLabel}</button>)}
    </div>}

    <section className="detailHero">
      <div>
        <span className="detailKicker">{uiLang === 'en' ? subtitle.replace('매크로', 'Macro') : subtitle}</span>
        <h1>{displayTitle}</h1>
        {series.length > 1 && <p className="detailSeriesName">{indicatorNameFor(active.id, active.nameKo, uiLang)}</p>}
      </div>
      <div className="detailLeadValue">
        <strong>{formatNumber(latest, Math.abs(latest || 0) < 10 ? 3 : 2)}<small>{compactUnit(active.unit, uiLang)}</small></strong>
        <span className={directionClass(change)} title={active.dataWarning}>{hasGap ? t(uiLang, `갱신공백 ${active.changeIntervalDays}일`, `Gap ${active.changeIntervalDays}d`) : change == null ? t(uiLang, '전기 데이터 없음', 'No prior data') : `${change > 0 ? '▲' : change < 0 ? '▼' : '–'} ${formatNumber(Math.abs(change))}${changeSuffix}`}</span>
        <time>{formatPeriod(active.latestPeriod, active.frequency)} {t(uiLang, '기준', 'basis')}</time>
      </div>
    </section>

    {profile !== 'pmi' && <section className="detailPanel detailChartPanel">
      <div className="detailPanelHead">
        <div><span>Trend</span><h2>{t(uiLang, '추세', 'Trend')}</h2></div>
      </div>
      <TrendChart indicator={active} observations={selected} lang={uiLang} />
    </section>}

    <section className="detailStatsGrid" aria-label={t(uiLang, '핵심 통계', 'Key statistics')}>
      {stats.map((stat) => <article key={stat.label}>
        <span>{stat.label}</span>
        <strong>{stat.value}</strong>
        {stat.note && <small>{stat.note}</small>}
      </article>)}
    </section>

    <div className="detailEditorialGrid">
      <section className="detailPanel detailCopy">
        <span className="detailSectionEyebrow">Overview</span>
        <h2>{t(uiLang, '지표 개요', 'Indicator Overview')}</h2>
        <p>{copy.overview}</p>
        <h3>{t(uiLang, 'EP 산업 시사점', 'EP Industry Implications')}</h3>
        <p>{copy.implication}</p>
      </section>

      <aside className="detailPanel detailNewsPanel">
        <span className="detailSectionEyebrow">Related</span>
        <h2>{t(uiLang, '관련 콘텐츠', 'Related Content')}</h2>
        {active.relatedNews.length ? <div className="detailNewsList">{active.relatedNews.map((news) => <a key={`${news.link}-${news.publishedAt}`} href={news.link} target="_blank" rel="noreferrer">
          <strong>{displayArticleTitle(news, uiLang)}</strong>
          <span>{sourceNameFor(news.sourceName, uiLang)} · {news.publishedAt.slice(0, 10)}</span>
        </a>)}</div> : <p className="detailNoNews">{t(uiLang, '현재 연결된 관련 뉴스가 없습니다.', 'No related news is currently linked.')}</p>}
      </aside>
    </div>

    <footer className="detailSource">
      <span>{t(uiLang, '데이터 출처', 'Data source')}</span>
      {active.sourceUrl ? <a href={active.sourceUrl} target="_blank" rel="noreferrer">{active.sourceId} ↗</a> : <b>{active.sourceId}</b>}
      <small>{t(uiLang, '단위', 'Unit')}: {compactUnit(active.unit, uiLang)} · {t(uiLang, '주기', 'Frequency')}: {active.frequency}</small>
    </footer>
  </>;
}
