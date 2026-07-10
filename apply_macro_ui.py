#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise SystemExit(f'Missing required file: {rel}')
    return path.read_text(encoding='utf-8')


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    print(f'updated {rel}')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match for {label}, found {count}')
    return text.replace(old, new, 1)


SPARKLINE = r'''import type { IndicatorObservation } from '@/lib/types';

interface SparklineProps {
  history: IndicatorObservation[];
  width?: number;
  height?: number;
  className?: string;
}

function trendLabel(values: number[]) {
  if (values.length < 2) return '관측치 1개';
  const delta = values.at(-1)! - values[0];
  if (Math.abs(delta) < Number.EPSILON) return '보합 추세';
  return delta > 0 ? '상승 추세' : '하락 추세';
}

export default function Sparkline({ history, width = 104, height = 36, className = '' }: SparklineProps) {
  const values = history.map((item) => item.value).filter(Number.isFinite);
  const padding = 3;
  const drawableWidth = Math.max(1, width - padding * 2);
  const drawableHeight = Math.max(1, height - padding * 2);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const spread = max - min;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * drawableWidth;
    const y = spread === 0 ? height / 2 : padding + ((max - value) / spread) * drawableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const label = `최근 ${values.length}개 관측치, ${trendLabel(values)}`;

  return <svg
    className={`indicatorSparkline ${className}`.trim()}
    width={width}
    height={height}
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    {values.length === 0 ? <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} className="sparklineEmpty" />
      : values.length === 1 ? <circle cx={width / 2} cy={height / 2} r="2.5" className="sparklineDot" />
        : <>
          <polyline points={points} className="sparklineLine" />
          <circle
            cx={Number(points.split(' ').at(-1)!.split(',')[0])}
            cy={Number(points.split(' ').at(-1)!.split(',')[1])}
            r="2.25"
            className="sparklineDot"
          />
        </>}
  </svg>;
}
'''

INDICATOR_DETAIL = r'''\'use client\';

import { useMemo, useState } from 'react';
import type { IndicatorCard, IndicatorFrequency, IndicatorObservation } from '@/lib/types';

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

type RangeOption = { label: string; count: number | null };
type StatItem = { label: string; value: string; note?: string };

const RANGE_OPTIONS: Record<IndicatorFrequency, RangeOption[]> = {
  daily: [
    { label: '1M', count: 22 }, { label: '3M', count: 66 }, { label: '1Y', count: 252 }, { label: '전체', count: null },
  ],
  monthly: [
    { label: '1Y', count: 12 }, { label: '3Y', count: 36 }, { label: '5Y', count: 60 }, { label: '전체', count: null },
  ],
  quarterly: [
    { label: '2Y', count: 8 }, { label: '5Y', count: 20 }, { label: '10Y', count: 40 }, { label: '전체', count: null },
  ],
  yearly: [
    { label: '5Y', count: 5 }, { label: '10Y', count: 10 }, { label: '20Y', count: 20 }, { label: '전체', count: null },
  ],
};

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

function compactUnit(unit: string) {
  if (/krw per usd/i.test(unit)) return '원/USD';
  if (/cny per usd/i.test(unit)) return '위안/USD';
  if (/usd\/bbl/i.test(unit)) return 'USD/bbl';
  if (/percent|growth|yoy|qoq/i.test(unit)) return '%';
  if (/points/i.test(unit)) return 'pt';
  return unit;
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ko-KR', { maximumFractionDigits });
}

function formatValue(value: number | null | undefined, unit: string) {
  if (value == null) return '—';
  return `${formatNumber(value, Math.abs(value) < 10 ? 3 : 2)} ${compactUnit(unit)}`;
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
  return period.slice(0, 10);
}

function descriptions(indicator: IndicatorCard) {
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
  return copy[profile];
}

function buildStats(indicator: IndicatorCard, selected: IndicatorObservation[], full: IndicatorObservation[]): StatItem[] {
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
      { label: '직전 관측치', value: formatValue(previous, indicator.unit) },
      { label: '50 기준선 대비', value: latest == null ? '—' : `${latest >= 50 ? '+' : ''}${formatNumber(latest - 50)}p`, note: latest != null && latest >= 50 ? '확장 국면' : '수축 국면' },
      { label: '최근 3회 평균', value: formatValue(average(values.slice(-3)), indicator.unit) },
      { label: '선택 기간 확장', value: `${values.filter((value) => value >= 50).length}/${values.length}회` },
    ];
  }

  if (profile === 'rate') {
    return [
      { label: '직전 금리', value: formatValue(previous, indicator.unit) },
      { label: '전기 대비', value: delta == null ? '—' : `${delta >= 0 ? '+' : ''}${formatNumber(delta * 100, 1)}bp` },
      { label: '선택 기간 평균', value: formatValue(avg, indicator.unit) },
      { label: '관측값 범위', value: min == null || max == null ? '—' : `${formatNumber(min)}–${formatNumber(max)}%` },
    ];
  }

  if (profile === 'production' || profile === 'inflation') {
    const fullValues = full.map((item) => item.value);
    const yearAgo = fullValues.length >= 13 ? fullValues.at(-13) : null;
    const yoy = latest != null && yearAgo != null ? deltaPct(latest, yearAgo) : null;
    return [
      { label: '직전 관측치', value: formatValue(previous, indicator.unit) },
      { label: '전월 대비', value: deltaPct(latest, previous) == null ? '—' : `${deltaPct(latest, previous)! >= 0 ? '+' : ''}${formatNumber(deltaPct(latest, previous))}%` },
      { label: '전년 동월 대비', value: yoy == null ? '데이터 부족' : `${yoy >= 0 ? '+' : ''}${formatNumber(yoy)}%` },
      { label: '최근 3개월 평균', value: formatValue(average(values.slice(-3)), indicator.unit) },
    ];
  }

  if (profile === 'growth') {
    return [
      { label: '직전 성장률', value: formatValue(previous, indicator.unit) },
      { label: '전기 대비 변화폭', value: delta == null ? '—' : `${delta >= 0 ? '+' : ''}${formatNumber(delta)}p` },
      { label: '최근 4회 평균', value: formatValue(average(values.slice(-4)), indicator.unit) },
      { label: '선택 기간 성장', value: `${values.filter((value) => value > 0).length}/${values.length}회` },
    ];
  }

  const start = values[0];
  const startChange = deltaPct(latest, start);
  return [
    { label: '직전 관측치', value: formatValue(previous, indicator.unit) },
    { label: profile === 'fx' || profile === 'commodity' ? '전기 대비' : '기간 시작 대비', value: `${profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous) : startChange}` === 'null' ? '—' : `${(profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous)! : startChange!) >= 0 ? '+' : ''}${formatNumber(profile === 'fx' || profile === 'commodity' ? deltaPct(latest, previous) : startChange)}%` },
    { label: '선택 기간 평균', value: formatValue(avg, indicator.unit) },
    { label: '관측값 범위', value: min == null || max == null ? '—' : `${formatNumber(min)}–${formatNumber(max)} ${compactUnit(indicator.unit)}` },
  ];
}

function TrendChart({ indicator, observations }: { indicator: IndicatorCard; observations: IndicatorObservation[] }) {
  const values = observations.map((item) => item.value);
  if (values.length < 2) return <div className="detailChartEmpty">차트를 표시할 관측치가 부족합니다.</div>;

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
    <svg className="detailChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${indicator.nameKo} 선택 기간 추세 차트`}>
      <title>{indicator.nameKo} 선택 기간 추세</title>
      {gridValues.map((value) => <g key={value}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="detailGridLine" />
        <text x={left - 10} y={y(value) + 4} textAnchor="end" className="detailAxisLabel">{formatNumber(value)}</text>
      </g>)}
      {baseline != null && <g>
        <line x1={left} x2={width - right} y1={y(baseline)} y2={y(baseline)} className="detailBaseline" />
        <text x={width - right} y={y(baseline) - 7} textAnchor="end" className="detailBaselineLabel">{profile === 'pmi' ? '확장·수축 기준 50' : '성장 기준 0'}</text>
      </g>}
      <path d={path} className="detailTrendLine" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="5" className="detailTrendDot" />
      <text x={left} y={height - 14} className="detailAxisLabel">{formatPeriod(observations[0].period, indicator.frequency)}</text>
      <text x={width - right} y={height - 14} textAnchor="end" className="detailAxisLabel">{formatPeriod(latest.period, indicator.frequency)}</text>
    </svg>
  </div>;
}

export default function IndicatorDetail({ title, subtitle, series, defaultSeriesId }: IndicatorDetailProps) {
  const [seriesId, setSeriesId] = useState(defaultSeriesId);
  const active = series.find((item) => item.id === seriesId) || series[0];
  const options = RANGE_OPTIONS[active.frequency];
  const defaultRange = options[Math.min(1, options.length - 1)].label;
  const [rangeBySeries, setRangeBySeries] = useState<Record<string, string>>({});
  const rangeLabel = rangeBySeries[active.id] || defaultRange;
  const range = options.find((option) => option.label === rangeLabel) || options[0];
  const selected = useMemo(() => range.count == null ? active.fullHistory : active.fullHistory.slice(-range.count), [active, range.count]);
  const stats = useMemo(() => buildStats(active, selected, active.fullHistory), [active, selected]);
  const latest = active.latestValue;
  const previous = active.previousValue;
  const pointDelta = latest != null && previous != null ? latest - previous : null;
  const profile = profileFor(active);
  const change = profile === 'rate' && pointDelta != null
    ? pointDelta * 100
    : profile === 'pmi' || profile === 'growth' ? pointDelta : deltaPct(latest ?? undefined, previous ?? undefined);
  const changeSuffix = profile === 'rate' ? 'bp' : profile === 'pmi' || profile === 'growth' ? 'p' : '%';
  const copy = descriptions(active);

  return <>
    {series.length > 1 && <div className="detailSeriesTabs" role="tablist" aria-label="GDP 상세 시리즈">
      {series.map((item) => <button key={item.id} role="tab" aria-selected={item.id === active.id} className={item.id === active.id ? 'active' : ''} onClick={() => setSeriesId(item.id)}>{item.seriesLabel}</button>)}
    </div>}

    <section className="detailHero">
      <div>
        <span className="detailKicker">{subtitle}</span>
        <h1>{title}</h1>
        {series.length > 1 && <p className="detailSeriesName">{active.nameKo}</p>}
      </div>
      <div className="detailLeadValue">
        <strong>{formatNumber(latest, Math.abs(latest || 0) < 10 ? 3 : 2)}<small>{compactUnit(active.unit)}</small></strong>
        <span className={directionClass(change)}>{change == null ? '전기 데이터 없음' : `${change > 0 ? '▲' : change < 0 ? '▼' : '–'} ${formatNumber(Math.abs(change))}${changeSuffix}`}</span>
        <time>{formatPeriod(active.latestPeriod, active.frequency)} 기준</time>
      </div>
    </section>

    <section className="detailPanel detailChartPanel">
      <div className="detailPanelHead">
        <div><span>Trend</span><h2>추세</h2></div>
        <div className="detailRangeTabs">
          {options.map((option) => <button key={option.label} className={rangeLabel === option.label ? 'active' : ''} onClick={() => setRangeBySeries((current) => ({ ...current, [active.id]: option.label }))}>{option.label}</button>)}
        </div>
      </div>
      <TrendChart indicator={active} observations={selected} />
    </section>

    <section className="detailStatsGrid" aria-label="핵심 통계">
      {stats.map((stat) => <article key={stat.label}>
        <span>{stat.label}</span>
        <strong>{stat.value}</strong>
        {stat.note && <small>{stat.note}</small>}
      </article>)}
    </section>

    <div className="detailEditorialGrid">
      <section className="detailPanel detailCopy">
        <span className="detailSectionEyebrow">Overview</span>
        <h2>지표 개요</h2>
        <p>{copy.overview}</p>
        <h3>EP 산업 시사점</h3>
        <p>{copy.implication}</p>
      </section>

      <aside className="detailPanel detailNewsPanel">
        <span className="detailSectionEyebrow">Related</span>
        <h2>관련 콘텐츠</h2>
        {active.relatedNews.length ? <div className="detailNewsList">{active.relatedNews.map((news) => <a key={`${news.link}-${news.publishedAt}`} href={news.link} target="_blank" rel="noreferrer">
          <strong>{news.title}</strong>
          <span>{news.sourceName} · {news.publishedAt.slice(0, 10)}</span>
        </a>)}</div> : <p className="detailNoNews">현재 연결된 관련 뉴스가 없습니다.</p>}
      </aside>
    </div>

    <footer className="detailSource">
      <span>데이터 출처</span>
      {active.sourceUrl ? <a href={active.sourceUrl} target="_blank" rel="noreferrer">{active.sourceId} ↗</a> : <b>{active.sourceId}</b>}
      <small>단위: {active.unit} · 주기: {active.frequency}</small>
    </footer>
  </>;
}
'''.replace("\\'", "'")

DETAIL_PAGE = r'''import Link from 'next/link';
import { notFound } from 'next/navigation';
import IndicatorDetail from '@/app/ui/indicator-detail';
import { getGdpCountryDetail, getIndicatorDetail } from '@/lib/indicator-store';

export const dynamic = 'force-dynamic';

const COUNTRY_LABELS: Record<string, string> = {
  us: '미국', korea: '한국', japan: '일본', china: '중국', eurozone: '유로존', india: '인도',
};

function seriesLabel(id: string) {
  if (id.startsWith('gdp_qoq_')) return id.includes('_te') ? '연간 성장률' : '성장률';
  if (id.startsWith('gdp_quarterly_')) return '분기 GDP';
  return '연간 GDP';
}

function seriesOrder(id: string) {
  if (id.startsWith('gdp_qoq_') && !id.includes('_te')) return 0;
  if (id.startsWith('gdp_quarterly_')) return 1;
  if (id.startsWith('gdp_qoq_')) return 2;
  return 3;
}

export default async function IndicatorDetailPage({ params }: { params: Promise<{ indicatorId: string }> }) {
  const { indicatorId } = await params;
  const country = indicatorId.startsWith('gdp-') ? indicatorId.slice(4) : null;

  if (country) {
    const bundle = getGdpCountryDetail(country);
    if (!bundle.length) notFound();
    const series = bundle
      .sort((a, b) => seriesOrder(a.id) - seriesOrder(b.id))
      .map((item) => ({ ...item, seriesLabel: seriesLabel(item.id) }));
    return <main className="detailPage">
      <header className="detailTopbar">
        <Link href="/?view=macro" className="detailBrand"><span>EP</span><b>Industry Monitor</b></Link>
        <Link href="/?view=macro" className="detailBack">← 매크로 지표</Link>
      </header>
      <IndicatorDetail
        title={`${COUNTRY_LABELS[country] || country} GDP`}
        subtitle="Global growth frame"
        series={series}
        defaultSeriesId={series[0].id}
      />
    </main>;
  }

  const indicator = getIndicatorDetail(indicatorId);
  if (!indicator) notFound();
  return <main className="detailPage">
    <header className="detailTopbar">
      <Link href="/?view=macro" className="detailBrand"><span>EP</span><b>Industry Monitor</b></Link>
      <Link href="/?view=macro" className="detailBack">← 매크로 지표</Link>
    </header>
    <IndicatorDetail
      title={indicator.nameKo}
      subtitle={`${indicator.category} · ${indicator.frequency}`}
      series={[{ ...indicator, seriesLabel: indicator.nameKo }]}
      defaultSeriesId={indicator.id}
    />
  </main>;
}
'''

STORE_APPEND = r'''

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
'''

DASH_RENDER = r'''  function renderIndicatorCard(ind: IndicatorCard) {
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
    const badge = indicatorImpactBadge(ind);
    const changeClass = ind.dataStatus === 'stale' ? 'stale' : isRateIndicator
      ? (rateUp ? 'up' : rateDown ? 'down' : '')
      : up ? 'up' : down ? 'down' : '';

    return <Link href={`/indicators/${ind.id}`} className="indicatorCard indicatorListCard" key={ind.id} aria-label={`${ind.nameKo} 상세 보기`}>
      <div className="indicatorListMain">
        <div className="indicatorHead">
          <span className="indicatorName">{ind.nameKo}</span>
          <span className={`epBadge ${badge.tone}`} title={badge.title}>{badge.label}</span>
        </div>
        <span className="indicatorListMeta">{ind.frequency.toUpperCase()} · {formatIndicatorPeriod(ind)}</span>
        {ind.dataStatus !== 'insufficient' ? <div className="indicatorValue">
          {formatIndicatorValue(ind.latestValue, ind.unit)}
          <span className="indicatorUnit">{ind.unit}</span>
        </div> : <div className="indicatorEmpty">데이터 수집 대기 중</div>}
      </div>
      <div className="indicatorListTrend">
        <Sparkline history={ind.history} />
        <span className={`indicatorChange ${changeClass}`}>{changeText}</span>
      </div>
      <span className="indicatorChevron" aria-hidden="true">›</span>
    </Link>;
  }
'''

CSS_APPEND = r'''

/* ── v4.13 매크로 지표 목록·상세 ───────────────────────────── */
.indicatorGrid{grid-template-columns:1fr;gap:10px}
.indicatorListCard{
  position:relative;display:grid;grid-template-columns:minmax(0,1fr) 150px 18px;
  align-items:center;gap:20px;padding:18px 20px;color:inherit;
  transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease;
}
.indicatorListCard:hover{border-color:color-mix(in srgb,var(--brand) 46%,var(--line));box-shadow:var(--shadow-lg);transform:translateY(-1px)}
.indicatorListMain{min-width:0;display:grid;gap:7px}
.indicatorListMeta{font:700 10.5px 'JetBrains Mono';letter-spacing:.05em;color:var(--muted-2);text-transform:uppercase}
.indicatorListTrend{display:grid;justify-items:end;gap:4px;color:var(--brand)}
.indicatorListTrend .indicatorChange{display:block;font-size:11.5px}
.indicatorChevron{font:400 28px/1 'Noto Sans KR';color:var(--muted-2);transition:transform .18s ease,color .18s ease}
.indicatorListCard:hover .indicatorChevron{transform:translateX(2px);color:var(--brand)}
.indicatorSparkline{display:block;overflow:visible;color:var(--brand)}
.sparklineLine{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.sparklineDot{fill:var(--surface);stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}
.sparklineEmpty{stroke:var(--line);stroke-width:1.5;stroke-dasharray:3 3}
.gdpCountryCard .indicatorSparkline{margin-left:auto}

.macroHighlightCard{
  margin:0 0 18px;padding:22px 24px;border-radius:var(--radius);
  border:1px solid color-mix(in srgb,var(--brand) 28%,var(--line));
  background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 8%,var(--surface)),var(--surface));
  box-shadow:var(--shadow-sm);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;
}
.macroHighlightLabel{display:block;margin-bottom:7px;font:800 10.5px 'JetBrains Mono';letter-spacing:.12em;text-transform:uppercase;color:var(--brand)}
.macroHighlightCard h2{margin:0;font:750 19px/1.45 'Noto Sans KR';letter-spacing:-.015em;color:var(--text)}
.macroHighlightCard p{margin:7px 0 0;font:600 12px 'Noto Sans KR';color:var(--muted)}
.macroHighlightActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.macroHighlightActions a{padding:9px 13px;border-radius:var(--radius-pill);font:700 12px 'Noto Sans KR';border:1px solid var(--line);background:var(--surface);color:var(--text-dim)}
.macroHighlightActions a:last-child{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 11%,var(--surface));color:var(--brand-dim)}

.detailPage{width:min(1120px,calc(100% - 36px));margin:0 auto;padding:26px 0 72px}
.detailTopbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:44px;padding-bottom:18px;border-bottom:1px solid var(--line-soft)}
.detailBrand{display:flex;align-items:center;gap:10px;font:750 14px 'Noto Sans KR';color:var(--text)}
.detailBrand span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,var(--brand-bright),var(--brand-dim));color:#FFF8EC;font-size:11px;box-shadow:0 6px 16px rgba(168,99,30,.2)}
.detailBack{font:700 12.5px 'Noto Sans KR';color:var(--brand)}
.detailSeriesTabs,.detailRangeTabs{display:flex;gap:7px;overflow-x:auto;scrollbar-width:thin}
.detailSeriesTabs{margin-bottom:18px;padding-bottom:2px}
.detailSeriesTabs button,.detailRangeTabs button{white-space:nowrap;padding:8px 13px;border-radius:var(--radius-pill);border:1px solid var(--line);background:var(--surface);color:var(--muted);font:700 12px 'Noto Sans KR'}
.detailSeriesTabs button.active,.detailRangeTabs button.active{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 12%,var(--surface));color:var(--brand-dim);box-shadow:inset 0 -2px 0 var(--brand)}
.detailHero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:24px}
.detailKicker,.detailSectionEyebrow{display:block;margin-bottom:8px;font:800 10.5px 'JetBrains Mono';letter-spacing:.13em;text-transform:uppercase;color:var(--brand)}
.detailHero h1{font-size:clamp(30px,5vw,50px)}
.detailSeriesName{margin:9px 0 0;color:var(--muted);font:600 13px 'Noto Sans KR'}
.detailLeadValue{display:grid;justify-items:end;gap:6px;text-align:right}
.detailLeadValue strong{font:800 clamp(30px,5vw,48px)/1 'Noto Sans KR';letter-spacing:-.035em;color:var(--text)}
.detailLeadValue strong small{margin-left:7px;font:600 12px 'Noto Sans KR';color:var(--muted)}
.detailLeadValue span{font:750 13px 'JetBrains Mono';color:var(--muted)}
.detailLeadValue span.up{color:#B5473A}.detailLeadValue span.down{color:#2E6B8A}
.detailLeadValue time{font:600 11px 'JetBrains Mono';color:var(--muted-2)}
.detailPanel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.detailChartPanel{padding:22px 24px 16px;margin-bottom:14px}
.detailPanelHead{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:12px}
.detailPanelHead span{font:800 9.5px 'JetBrains Mono';letter-spacing:.13em;text-transform:uppercase;color:var(--muted-2)}
.detailPanelHead h2,.detailCopy h2,.detailNewsPanel h2{margin:2px 0 0;font:800 20px 'Noto Sans KR';color:var(--text)}
.detailChartWrap{width:100%;overflow:hidden}
.detailChart{display:block;width:100%;height:auto;min-height:260px}
.detailGridLine{stroke:var(--line-soft);stroke-width:1;vector-effect:non-scaling-stroke}
.detailBaseline{stroke:color-mix(in srgb,var(--brand) 45%,var(--line));stroke-width:1.2;stroke-dasharray:5 5;vector-effect:non-scaling-stroke}
.detailBaselineLabel,.detailAxisLabel{font:600 10px 'JetBrains Mono';fill:var(--muted-2)}
.detailTrendLine{fill:none;stroke:var(--brand);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.detailTrendDot{fill:var(--surface);stroke:var(--brand);stroke-width:3;vector-effect:non-scaling-stroke}
.detailChartEmpty{display:grid;place-items:center;min-height:250px;color:var(--muted);font:600 13px 'Noto Sans KR'}
.detailStatsGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
.detailStatsGrid article{padding:17px 18px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface);box-shadow:var(--shadow-sm);display:grid;gap:6px}
.detailStatsGrid span{font:700 11px 'Noto Sans KR';color:var(--muted)}
.detailStatsGrid strong{font:800 18px/1.25 'Noto Sans KR';color:var(--text);overflow-wrap:anywhere}
.detailStatsGrid small{font:600 10.5px 'Noto Sans KR';color:var(--brand)}
.detailEditorialGrid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:14px}
.detailCopy,.detailNewsPanel{padding:24px 26px}
.detailCopy p{margin:11px 0 0;font:500 14px/1.8 'Noto Sans KR';color:var(--text-dim)}
.detailCopy h3{margin:24px 0 0;padding-top:20px;border-top:1px solid var(--line-soft);font:800 15px 'Noto Sans KR';color:var(--text)}
.detailNewsList{display:grid;margin-top:14px}
.detailNewsList a{display:grid;gap:6px;padding:13px 0;border-top:1px solid var(--line-soft)}
.detailNewsList a:first-child{border-top:0;padding-top:3px}
.detailNewsList strong{font:650 13px/1.5 'Noto Sans KR';color:var(--text-dim)}
.detailNewsList a:hover strong{color:var(--brand)}
.detailNewsList span,.detailNoNews{font:600 10.5px 'Noto Sans KR';color:var(--muted-2)}
.detailSource{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:14px 2px;color:var(--muted);font:600 11px 'Noto Sans KR'}
.detailSource>a{color:var(--brand);font-weight:800}.detailSource small{margin-left:auto;color:var(--muted-2)}

@media(max-width:760px){
  .indicatorListCard{grid-template-columns:minmax(0,1fr) auto;gap:12px}
  .indicatorListTrend{grid-column:1 / -1;grid-row:2;grid-template-columns:auto 1fr;justify-items:start;align-items:center;gap:12px}
  .indicatorChevron{position:absolute;right:18px;top:18px}
  .indicatorHead{padding-right:26px}
  .macroHighlightCard{grid-template-columns:1fr;padding:19px 20px}
  .macroHighlightActions{justify-content:flex-start}
  .detailPage{width:min(100% - 28px,1120px);padding-top:16px}
  .detailTopbar{margin-bottom:30px}
  .detailHero{grid-template-columns:1fr;align-items:start}
  .detailLeadValue{justify-items:start;text-align:left}
  .detailPanelHead{align-items:flex-start;flex-direction:column}
  .detailStatsGrid{grid-template-columns:1fr 1fr}
  .detailEditorialGrid{grid-template-columns:1fr}
  .detailSource small{width:100%;margin-left:0}
}
@media(max-width:430px){.detailStatsGrid{grid-template-columns:1fr}.detailChartPanel{padding:18px 14px 10px}.detailCopy,.detailNewsPanel{padding:21px 20px}}
'''


def patch_dashboard() -> None:
    rel = 'src/app/ui/dashboard.tsx'
    text = read(rel)
    text = replace_once(text, "import { useMemo, useState } from 'react';\n", "import Link from 'next/link';\nimport { useEffect, useMemo, useState } from 'react';\nimport Sparkline from './indicator-sparkline';\n", 'dashboard imports')

    text = replace_once(text, "  const [page, setPage] = useState<PageKey>('feed');\n", "  const [page, setPage] = useState<PageKey>('feed');\n  useEffect(() => {\n    if (new URLSearchParams(window.location.search).get('view') === 'macro') setPage('macro');\n  }, []);\n", 'macro query entry')

    helper_anchor = "function sourceRegion(name: string) {"
    helper = r'''function isTodayKst(value: string) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const published = new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000);
  return now.getUTCFullYear() === published.getUTCFullYear()
    && now.getUTCMonth() === published.getUTCMonth()
    && now.getUTCDate() === published.getUTCDate();
}

'''
    if helper not in text:
        text = replace_once(text, helper_anchor, helper + helper_anchor, 'today helper')

    memo_anchor = "  }, [allIndicators]);\n\n  function renderIndicatorCard"
    memo = r'''  }, [allIndicators]);

  const macroHighlight = useMemo(() => {
    const seen = new Set<string>();
    return indicators
      .flatMap((indicator) => indicator.relatedNews.map((news) => ({ indicator, news })))
      .filter(({ news }) => {
        const key = news.link || news.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => +new Date(b.news.publishedAt) - +new Date(a.news.publishedAt))[0] || null;
  }, [indicators]);

  function renderIndicatorCard'''
    text = replace_once(text, memo_anchor, memo, 'macro highlight memo')

    start = text.find('  function renderIndicatorCard(')
    end = text.find('\n  function metricLine(', start)
    if start < 0 or end < 0:
        raise SystemExit('Could not locate renderIndicatorCard block')
    text = text[:start] + DASH_RENDER + text[end:]

    # Convert GDP card container to a link, remove inline news, add sparkline.
    text = replace_once(
        text,
        '    const newsSource = [group.quarterly, group.annual, group.quarterlyGrowth, group.annualGrowth]\n      .find((x) => x?.relatedNews && x.relatedNews.length > 0);\n',
        '',
        'GDP newsSource removal',
    )
    text = replace_once(
        text,
        '    return <div className="indicatorCard gdpCountryCard" key={`gdp-country-${group.country}`}>',
        '    return <Link href={`/indicators/gdp-${group.country}`} className="indicatorCard gdpCountryCard indicatorListCard" key={`gdp-country-${group.country}`} aria-label={`${GDP_COUNTRY_LABELS[group.country] || group.country} GDP 상세 보기`}>',
        'GDP card link open',
    )
    spark_anchor = '''      {lead !== null && <div className={`indicatorValue gdpGrowthLead ${gClass}`}>
        {lead.v > 0 ? '+' : ''}{lead.v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}<span className="indicatorUnit">{lead.suffix}</span>
      </div>}
'''
    spark_new = spark_anchor + '''      <Sparkline history={(lead?.ind || primary).history} className="gdpSparkline" />
'''
    text = replace_once(text, spark_anchor, spark_new, 'GDP sparkline')
    gdp_start = text.find('  function renderGdpCountryCard(')
    gdp_end = text.find('\n  return <main', gdp_start)
    if gdp_start < 0 or gdp_end < 0:
        raise SystemExit('Could not locate GDP render function')
    gdp = text[gdp_start:gdp_end]
    gdp = re.sub(r"\n      \{newsSource\?\.relatedNews[\s\S]*?\n      </div>\}", '', gdp, count=1)
    close_index = gdp.rfind('    </div>;')
    if close_index < 0:
        raise SystemExit('Could not locate GDP card closing tag')
    gdp = gdp[:close_index] + '    </Link>;' + gdp[close_index + len('    </div>;'):]
    text = text[:gdp_start] + gdp + text[gdp_end:]

    macro_start = text.find("      </> : page === 'macro' ? <>")
    loading_anchor = '        {indicatorLoading ?'
    insert_at = text.find(loading_anchor, macro_start)
    if macro_start < 0 or insert_at < 0:
        raise SystemExit('Could not locate macro loading block')
    highlight = r'''        {macroHighlight && <article className="macroHighlightCard">
          <div>
            <span className="macroHighlightLabel">{isTodayKst(macroHighlight.news.publishedAt) ? '오늘의 매크로 브리프' : '최근 매크로 브리프'}</span>
            <h2>{macroHighlight.news.title}</h2>
            <p>{macroHighlight.news.sourceName} · {shortDate(macroHighlight.news.publishedAt)} · {macroHighlight.indicator.nameKo}</p>
          </div>
          <div className="macroHighlightActions">
            <a href={macroHighlight.news.link} target="_blank" rel="noreferrer">뉴스 원문 ↗</a>
            <Link href={`/indicators/${macroHighlight.indicator.id}`}>지표 보기</Link>
          </div>
        </article>}
'''
    text = text[:insert_at] + highlight + text[insert_at:]
    write(rel, text)


def patch_store() -> None:
    rel = 'src/lib/indicator-store.ts'
    text = read(rel)
    if 'export function getIndicatorDetail(' not in text:
        text = text.rstrip() + STORE_APPEND + '\n'
    write(rel, text)


def patch_css() -> None:
    rel = 'src/app/globals.css'
    text = read(rel)
    marker = '/* ── v4.13 매크로 지표 목록·상세'
    if marker not in text:
        text = text.rstrip() + CSS_APPEND + '\n'
    write(rel, text)


write('src/app/ui/indicator-sparkline.tsx', SPARKLINE)
write('src/app/ui/indicator-detail.tsx', INDICATOR_DETAIL)
write('src/app/indicators/[indicatorId]/page.tsx', DETAIL_PAGE)
patch_dashboard()
patch_store()
patch_css()
print('Macro indicator UI implementation applied successfully.')
