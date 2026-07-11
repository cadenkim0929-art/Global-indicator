'use client';

import type { Article } from '@/lib/types';
import { cleanArticleTitle, resolveSummary, resolveTitles } from '../format-utils';
import { useDisplayTime } from './use-display-time';

export interface FeedHeroProps {
  article: Article;
  categoryLabel: string;
  categoryColor: string;
}

// 대표 기사(오늘의 핵심 인사이트) 카드. 사진 자산이 없으므로 실제 지도/그래프가 아닌
// 순수 CSS/SVG 점 패턴 + 얇은 추세선으로 "글로벌 리서치" 톤만 은유적으로 표현한다.
// 카드 전체를 링크로 감싸지 않고, "원문 보기" 버튼만 실제 앵커로 둬서 중첩 링크를 피한다.
export default function FeedHero({ article, categoryLabel, categoryColor }: FeedHeroProps) {
  const { titleKo } = resolveTitles(article);
  const cleanedTitle = cleanArticleTitle(titleKo, article.sourceName || article.feedName);
  const summary = resolveSummary(article, categoryLabel);
  const timeLabel = useDisplayTime(article.publishedAt);
  const tags = (article.tags || []).filter(Boolean).slice(0, 3);

  return (
    <section className="feedHero" aria-labelledby="feedHeroHeading" style={{ ['--accent' as string]: categoryColor }}>
      <div className="feedHeroBg" aria-hidden="true">
        <svg viewBox="0 0 420 160" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="feedHeroDots" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1.3" cy="1.3" r="1.3" fill="currentColor" />
            </pattern>
          </defs>
          <rect x="120" y="0" width="300" height="160" fill="url(#feedHeroDots)" opacity=".5" />
          <polyline
            points="130,120 165,108 200,118 235,88 270,96 305,58 340,66 405,26"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55"
          />
        </svg>
      </div>
      <div className="feedHeroBody">
        <span className="feedHeroLabel">오늘의 핵심 인사이트</span>
        <h2 id="feedHeroHeading">{cleanedTitle}</h2>
        <p className="feedHeroSummary">{summary}</p>
        <div className="feedHeroMeta">
          <span className="feedHeroSource">{article.sourceName || article.feedName}</span>
          <time dateTime={article.publishedAt}>{timeLabel}</time>
          {tags.map((t) => <span key={t} className="feedHeroTag">#{t}</span>)}
        </div>
        <div className="feedHeroActions">
          <a href={article.link} target="_blank" rel="noreferrer" className="feedHeroCta">원문 보기 →</a>
        </div>
      </div>
    </section>
  );
}
