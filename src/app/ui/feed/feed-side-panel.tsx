'use client';

import type { Article } from '@/lib/types';
import { useDisplayTime } from './use-display-time';
import { categoryLabelFor, displayArticleTitle, t, type UiLang } from '../format-utils';

function BriefRow({ article, lang = 'ko' }: { article: Article; lang?: UiLang }) {
  const timeLabel = useDisplayTime(article.publishedAt);
  const title = displayArticleTitle(article, lang);
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
  lang?: UiLang;
}

export default function FeedSidePanel({
  briefItems, keywords, activeKeyword, onKeywordClick,
  categories, selectedCategories, onToggleCategory, onSelectAllCategories,
  periodPresets, days, customDays, onChangePeriod, onReset, resultCount, lang = 'ko',
}: FeedSidePanelProps) {
  return (
    <aside className="feedSidePanel" aria-label={t(lang, '오늘의 브리프 및 빠른 필터', 'Brief and quick filters')}>
      <section className="feedPanelBlock">
        <div className="feedPanelHead">
          <b>{t(lang, '오늘의 브리프', 'Today Brief')}</b>
          <a href="#feedArticles">{t(lang, '더보기 ›', 'More ›')}</a>
        </div>
        {briefItems.length === 0 ? <p className="feedPanelEmpty">{t(lang, '표시할 항목이 없습니다.', 'No items to show.')}</p> : (
          <ul className="feedBriefList">
            {briefItems.map((a) => <BriefRow key={a.id} article={a} lang={lang} />)}
          </ul>
        )}
      </section>

      <section className="feedPanelBlock">
        <div className="feedPanelHead"><b>{t(lang, '# 주목 키워드', '# Watch Keywords')}</b></div>
        {keywords.length === 0 ? <p className="feedPanelEmpty">{t(lang, '아직 집계된 키워드가 없습니다.', 'No keywords yet.')}</p> : (
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
          <b>{t(lang, '빠른 필터', 'Quick Filters')}</b>
          <button type="button" className="feedResetBtn" onClick={onReset} aria-label={t(lang, '필터 초기화', 'Reset filters')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5.5 15a8 8 0 1013-9.5L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            {t(lang, '초기화', 'Reset')}
          </button>
        </div>

        <div className="feedQuickFilterGroup">
          <span className="feedQuickFilterLabel">{t(lang, '주제', 'Topic')}</span>
          <div className="feedQuickChips">
            <button type="button" className={!selectedCategories.length ? 'active' : ''} onClick={onSelectAllCategories}>{t(lang, '전체', 'All')}</button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={selectedCategories.includes(c.id) ? 'active' : ''}
                onClick={() => onToggleCategory(c.id)}
              >
                {categoryLabelFor(c.label, lang)}
              </button>
            ))}
          </div>
        </div>

        <div className="feedQuickFilterGroup">
          <span className="feedQuickFilterLabel">{t(lang, '기간', 'Period')}</span>
          <div className="feedQuickChips">
            {periodPresets.map((p) => (
              <button
                key={p.days}
                type="button"
                className={!customDays && days === p.days ? 'active' : ''}
                onClick={() => onChangePeriod(p.days)}
              >
                {lang === 'en' ? (p.days === 1 ? 'Today' : p.days >= 365 ? 'All' : `Last ${p.days} days`) : p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="feedQuickFilterFooter">{t(lang, '적용 결과', 'Results')} <b>{resultCount.toLocaleString()}{t(lang, '건', '')}</b></div>
      </section>
    </aside>
  );
}
