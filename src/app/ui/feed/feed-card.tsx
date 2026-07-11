'use client';

import type { Article } from '@/lib/types';
import { cleanArticleTitle, resolveSummary, resolveTitles } from '../format-utils';
import { useDisplayTime } from './use-display-time';

export interface FeedCardProps {
  article: Article;
  categoryLabel: string;
  categoryColor: string;
  index: number;
}

// 일반 기사 카드. 카드 자체는 링크가 아닌 <article>이고, 실제 원문으로 나가는
// 앵커는 하단의 "원문 ↗" 하나뿐이라 중첩 링크가 생기지 않는다.
// 북마크 버튼은 관심 지표 저장 백엔드가 아직 없어(사이드바 "관심 지표" 참고)
// 준비 중 상태의 순수 시각적 버튼으로만 둔다 — 동작하지 않는데 되는 것처럼
// 보이게 하지 않기 위함.
export default function FeedCard({ article, categoryLabel, categoryColor, index }: FeedCardProps) {
  const { titleKo, titleEn } = resolveTitles(article);
  const cleanedTitle = cleanArticleTitle(titleKo, article.sourceName || article.feedName);
  const summary = resolveSummary(article, categoryLabel);
  const timeLabel = useDisplayTime(article.publishedAt);
  const sourceLabel = article.sourceName || article.feedName;
  const extraSources = (article.duplicateCount || 1) > 1 ? ` 외 ${(article.duplicateCount || 1) - 1}개 매체` : '';

  return (
    <article className="feedCard" style={{ ['--accent' as string]: categoryColor, ['--i' as string]: Math.min(index, 12) }}>
      <div className="feedCardTop">
        <span className="feedCardCat">{categoryLabel}</span>
        <time className="feedCardTime" dateTime={article.publishedAt}>{timeLabel}</time>
      </div>
      <h3 className="feedCardTitle">
        {cleanedTitle}
        {titleEn && <span className="feedCardTitleEn">{titleEn}</span>}
      </h3>
      <p className="feedCardSummary">{summary}</p>
      <div className="feedCardFooter">
        <div className="feedCardFooterLeft">
          <span className="feedCardSource">{sourceLabel}{extraSources}</span>
          <span className="feedCardScore" title="영향도 점수">Impact {Math.round(article.score || 0)}</span>
        </div>
        <div className="feedCardFooterRight">
          <button type="button" className="feedBookmarkBtn" disabled aria-label="관심 기사 저장(준비 중)" title="관심 기사 저장 기능은 준비 중입니다">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h12v18l-6-4.2L6 21V3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </button>
          <a href={article.link} target="_blank" rel="noreferrer" className="feedCardLink">원문 ↗</a>
        </div>
      </div>
    </article>
  );
}
