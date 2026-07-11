'use client';

import type { SortKey } from '../format-utils';
import { formatDate } from '../format-utils';

export interface FeedHeaderProps {
  lastCollectedAt: string | null;
  resultsCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

export default function FeedHeader({
  lastCollectedAt, resultsCount, query, onQueryChange, sort, onSortChange, advancedOpen, onToggleAdvanced,
}: FeedHeaderProps) {
  return (
    <header className="feedPageHeader">
      <div className="feedPageHeaderTitle">
        <span className="eyebrow">Live Intelligence Feed</span>
        <h1>산업 인사이트 피드</h1>
        <p>엔지니어링 플라스틱을 중심으로 매크로, 다운스트림 수요, 업계 동향, 정책 이슈까지 중요한 이슈를 선별해 제공합니다.</p>
        <span className="pageHeaderMeta">업데이트 {formatDate(lastCollectedAt)} · {resultsCount.toLocaleString()}건 표시</span>
      </div>
      <div className="feedHeaderTools">
        <label className="feedSearchWrap">
          <span className="srOnly">기사 검색</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" /><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input
            className="feedSearchInput"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="회사명·소재명 검색: PC, PA66, PEEK, LG Chem…"
          />
        </label>
        <select className="feedSortSelect" value={sort} onChange={(e) => onSortChange(e.target.value as SortKey)} aria-label="정렬 기준">
          <option value="latest">최신순</option>
          <option value="score">영향도순</option>
          <option value="category">카테고리순</option>
        </select>
        <button
          type="button"
          className={`feedFilterToggle ${advancedOpen ? 'active' : ''}`}
          onClick={onToggleAdvanced}
          aria-expanded={advancedOpen}
          aria-controls="feedAdvancedPanel"
          aria-label="고급 필터 열기/닫기"
          title="고급 필터 (언어, 최소 Impact)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );
}
