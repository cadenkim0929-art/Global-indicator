'use client';

import { useSyncExternalStore } from 'react';
import { relativeTimeKst, shortDate, type UiLang } from '../format-utils';

// 서버에서 렌더링될 때와 클라이언트 첫 렌더 시점의 "N분 전" 문구가 서로 달라지면
// React hydration mismatch 경고가 발생한다. useSyncExternalStore의 getServerSnapshot은
// 서버 렌더 + 클라이언트의 최초(하이드레이션) 렌더까지 항상 절대 날짜(shortDate)를
// 반환해 두 결과를 일치시키고, 하이드레이션이 끝난 뒤의 통상적인 리렌더부터는
// getSnapshot(상대 시간)으로 자연스럽게 전환된다. 시계가 똑딱거릴 필요는 없으므로
// subscribe는 아무 것도 구독하지 않는다.
const noopSubscribe = () => () => {};

export function useDisplayTime(publishedAt: string, lang: UiLang = 'ko') {
  return useSyncExternalStore(
    noopSubscribe,
    () => relativeTimeKst(publishedAt, lang),
    () => shortDate(publishedAt),
  );
}

