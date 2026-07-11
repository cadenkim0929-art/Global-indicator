'use client';

import type { Article } from '@/lib/types';
import { useDisplayTime } from './use-display-time';

function BriefRow({ article }: { article: Article }) {
  const timeLabel = useDisplayTime(article.publishedAt);
  const title = article.titleKo || article.title;
  return (
    <li className="feedBriefRow">
      <a href={article.link} target="_blank" rel="noreferrer">{title}</a>
      <time dateTime={article.publishedAt}>{timeLabel}</time>
    </li>
  );
}

export interface FeedSidePanelProps {
  briefItems: Article[];
  keywords: string[];
  activeKeyword: string;
  onKeywordClick: (tag: string) => void;
  categories: Array<{ id: string; label: string; color: string }>;
  selectedCategories: string[];
  onToggleCategory: (id: string) => void;
  onSelectAllCategories: () => void;
  periodPresets: Array<{ label: string; days: number }>;
  days: number;
  customDays: boolean;
  onChangePeriod: (days: number) => void;
  onReset: () => void;
  resultCount: number;
}

export default function FeedSidePanel({
  briefItems, keywords, activeKeyword, onKeywordClick,
  categories, selectedCategories, onToggleCategory, onSelectAllCategories,
  periodPresets, days, customDays, onChangePeriod, onReset, resultCount,
}: FeedSidePanelProps) {
  return (
    <aside className="feedSidePanel" aria-label="오늘의 브리프 및 빠른 필터">
      <section className="feedPanelBlock">
        <div className="feedPanelHead">
          <b>오늘의 브리프</b>
          <a href="#feedArticles">더보기 ›</a>
        </div>
        {briefItems.length === 0 ? <p className="feedPanelEmpty">표시할 항목이 없습니다.</p> : (
          <ul className="feedBriefList">
            {briefItems.map((a) => <BriefRow key={a.id} article={a} />)}
          </ul>
        )}
      </section>

      <section className="feedPanelBlock">
        <div className="feedPanelHead"><b># 주목 키워드</b></div>
        {keywords.length === 0 ? <p className="feedPanelEmpty">아직 집계된 키워드가 없습니다.</p> : (
          <div className="feedKeywordList">
            {keywords.map((k) => (
              <button
                key={k}
                type="button"
                className={`feedKeywordChip ${activeKeyword === k ? 'active' : ''}`}
                onClick={() => onKeywordClick(k)}
              >
                #{k}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="feedPanelBlock">
        <div className="feedPanelHead">
          <b>빠른 필터</b>
          <button type="button" className="feedResetBtn" onClick={onReset} aria-label="필터 초기화">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5.5 15a8 8 0 1013-9.5L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            초기화
          </button>
        </div>

        <div className="feedQuickFilterGroup">
          <span className="feedQuickFilterLabel">주제</span>
          <div className="feedQuickChips">
            <button type="button" className={!selectedCategories.length ? 'active' : ''} onClick={onSelectAllCategories}>전체</button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={selectedCategories.includes(c.id) ? 'active' : ''}
                onClick={() => onToggleCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="feedQuickFilterGroup">
          <span className="feedQuickFilterLabel">기간</span>
          <div className="feedQuickChips">
            {periodPresets.map((p) => (
              <button
                key={p.days}
                type="button"
                className={!customDays && days === p.days ? 'active' : ''}
                onClick={() => onChangePeriod(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="feedQuickFilterFooter">적용 결과 <b>{resultCount.toLocaleString()}건</b></div>
      </section>
    </aside>
  );
}
