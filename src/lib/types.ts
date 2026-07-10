export type FeedCategory = string;

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  category: FeedCategory | string;
  enabled: boolean;
  sourceWorkflowNode: string;
}

export interface Article {
  id: string;
  feedId: string;
  feedName: string;
  category: string;
  title: string;
  titleKo?: string;
  titleEn?: string;
  link: string;
  summary: string;
  summaryKo?: string;
  contentSnippet?: string;
  publishedAt: string;
  collectedAt: string;
  source: string;
  sourceName?: string;
  language?: string;
  summaryStatus?: 'summary' | 'fallback';
  duplicateCount?: number;
  duplicateSources?: string[];
  score: number;
  tags: string[];
  rawId?: string;
}

export interface ArticleFilters {
  category?: string;
  query?: string;
  tag?: string;
  limit?: number;
  days?: number;
}

// [v1.0] Global Indicators 통합 — 매크로 경제지표 탭용 타입
export type IndicatorFrequency = 'daily' | 'monthly' | 'quarterly' | 'yearly';

export interface IndicatorCatalogItem {
  id: string;
  name: string;
  nameKo: string;
  frequency: IndicatorFrequency;
  category: string;
  unit: string;
  sourceId: string;
  sourceUrl: string;
  epRelevant: boolean;
}

export interface IndicatorObservation {
  indicatorId: string;
  period: string | null;
  value: number;
  observedAt: string;
}

export interface RelatedNewsItem {
  title: string;
  link: string;
  publishedAt: string;
  sourceName: string;
}

export interface IndicatorCard extends IndicatorCatalogItem {
  latestValue: number | null;
  latestPeriod: string | null;
  previousValue: number | null;
  pctChange: number | null;
  dataStatus: 'ok' | 'stale' | 'insufficient';
  history: IndicatorObservation[];
  relatedNews: RelatedNewsItem[];
}
