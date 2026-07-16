'use client';

import { categoryLabelFor, t, type UiLang } from '../format-utils';

export interface FeedCategoryTabsProps {
  categories: Array<{ id: string; label: string; color: string }>;
  selected: string[];
  counts: Array<{ category: string; count: number }>;
  totalCount: number;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  lang?: UiLang;
}

// 상단 가로형 카테고리 탭. 카테고리 이름/구성은 stats.categories를 그대로 쓰고
// 임의로 바꾸지 않는다. word-break로 글자 단위 줄바꿈이 나지 않도록 tabs 쪽
// CSS에서 white-space:nowrap을 이미 강제하고 있어 여기서는 마크업만 담당한다.
export default function FeedCategoryTabs({ categories, selected, counts, totalCount, onToggle, onSelectAll, lang = 'ko' }: FeedCategoryTabsProps) {
  return (
    <nav className="tabs feedCategoryTabs" aria-label={t(lang, '카테고리 필터', 'Category filter')}>
      <button type="button" className={!selected.length ? 'active' : ''} onClick={onSelectAll}>
        {t(lang, '전체', 'All')} <span>{totalCount}</span>
      </button>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          className={selected.includes(c.id) ? 'active' : ''}
          style={{ ['--chip' as string]: c.color }}
          onClick={() => onToggle(c.id)}
        >
          {categoryLabelFor(c.label, lang)} <span>{counts.find((x) => x.category === c.id)?.count || 0}</span>
        </button>
      ))}
    </nav>
  );
}
