import type { Article } from '@/lib/types';

export type PageKey = 'feed' | 'sources' | 'macro';
export type SortKey = 'latest' | 'score' | 'category';

// [피드 리디자인] 날짜/텍스트 가공 유틸을 dashboard.tsx에서 분리 —
// 매크로 페이지와 피드 페이지(신규 컴포넌트들)가 동일 로직을 공유하기 위함.
// 원본 데이터(article.title/summary 등)는 절대 변형하지 않고, 표시 단계에서만 가공한다.

export function shortDate(value: string) {
  const d = new Date(value);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')}`;
}

export function formatDate(value: string | null) {
  if (!value) return '수집 전';
  const d = new Date(value);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')} KST`;
}

export function isTodayKst(value: string) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const published = new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000);
  return now.getUTCFullYear() === published.getUTCFullYear()
    && now.getUTCMonth() === published.getUTCMonth()
    && now.getUTCDate() === published.getUTCDate();
}

// 서버 렌더링 시점과 클라이언트 하이드레이션 시점의 "n분 전" 문구가 달라 hydration
// mismatch가 나는 것을 피하기 위해, 화면에서는 useDisplayTime(feed/use-display-time.ts)
// 훅을 통해 사용한다 — 이 함수를 컴포넌트에서 직접 호출하지 않는다.
export function relativeTimeKst(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return shortDate(value);
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return shortDate(value);
}

function normalizeForCompare(s: string) {
  return s.toLowerCase().replace(/^\[매크로\]\s*/, '').replace(/[^\p{L}\p{N}]+/gu, '').trim();
}

// [매크로] 같은 파이프라인 태그 접두어, 그리고 "제목 - 출처명"처럼 반복되는 꼬리표를
// 표시 단계에서만 제거한다. 원본 문자열(article.title)은 수정하지 않는다.
export function cleanArticleTitle(title: string, sourceName?: string) {
  let result = title.replace(/^\[매크로\]\s*/, '').trim();
  if (sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\s[-–—|]\\s${escaped}\\s*$`, 'i'), '').trim();
  }
  result = result.replace(/\s[-–—|]\s[A-Za-z0-9][A-Za-z0-9 .&'’/()-]{2,40}$/u, '').trim();
  return result;
}

export function resolveTitles(article: Pick<Article, 'title' | 'titleKo' | 'titleEn'>) {
  const titleKo = article.titleKo || article.title;
  const titleEn = article.titleEn && normalizeForCompare(article.titleEn) !== normalizeForCompare(titleKo) ? article.titleEn : null;
  return { titleKo, titleEn };
}

// 제목과 사실상 동일한 요약(번역 실패로 제목을 그대로 복붙한 경우 등)은 감추고,
// 대신 짧고 정직한 상태 문구로 대체한다 — 존재하지 않는 AI 요약을 지어내지 않는다.
export function resolveSummary(article: Pick<Article, 'title' | 'summary' | 'summaryKo'>, categoryLabel: string) {
  const rawSummary = article.summaryKo || article.summary;
  const titleCore = article.title.replace(/\s[-–—|]\s.*$/, '').trim();
  const summaryCore = (rawSummary || '').replace(/\s[-–—|]\s.*$/, '').trim();
  const isMeaningful = !!rawSummary
    && normalizeForCompare(summaryCore) !== normalizeForCompare(titleCore)
    && !summaryCore.includes(titleCore.slice(0, 24));
  return isMeaningful ? rawSummary! : `${categoryLabel} 관련 소식입니다. 원문에서 자세한 내용을 확인하세요.`;
}

// 대표 기사(히어로)·브리프 선정 기준: score 내림차순, 동점이면 최신순.
export function rankByScoreThenDate(list: Article[]) {
  return [...list].sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return +new Date(b.publishedAt) - +new Date(a.publishedAt);
  });
}

// 주목 키워드: stats.topTags를 우선 사용하고, 부족하면 현재 필터를 통과한 기사의
// tags 빈도로 보충한다. 빈 문자열/과도하게 긴 태그/중복은 제거.
export function buildKeywordList(
  topTags: Array<{ tag: string; count: number }> | undefined,
  articles: Article[],
  max = 10,
) {
  const isValid = (t: string) => t.length > 0 && t.length <= 14;
  const fromStats = Array.from(new Set((topTags || []).map((t) => t.tag.trim()).filter(isValid)));
  if (fromStats.length >= 4) return fromStats.slice(0, max);

  const freq = new Map<string, number>();
  articles.forEach((a) => (a.tags || []).forEach((raw) => {
    const t = raw.trim();
    if (!isValid(t)) return;
    freq.set(t, (freq.get(t) || 0) + 1);
  }));
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, max);
}
