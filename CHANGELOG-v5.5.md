# EP Industry Monitor v5.5 — Target Design Alignment

## 핵심 수정

- 목표 시안과 유사한 데스크톱 에디토리얼 대시보드 구조로 재배치
- 기간 탭을 헤더 우측으로 이동 (`지금 / 최근 / 장기`)
- 인사이트 히어로를 본문·차트·메타 3영역으로 정돈
- RSS 제목의 매체명 중복과 과도한 길이를 에디토리얼 방식으로 정리
- 기본 `지금` 화면을 주요 시장 지표 테이프 + 국가별 GDP 3×2 카드로 구성
- GDP 카드에 국가 플래그, 성장률, 분기/연간 GDP를 압축 표시
- 월간 지표 카드는 최소 폭을 보장해 제목의 부자연스러운 줄바꿈을 방지
- 1080px 이하에서 사이드바를 상단 내비게이션으로 전환
- Next.js `viewport` 메타를 명시해 모바일에서 데스크톱 화면이 축소 렌더링되던 문제 해결
- 한국어 제목에 `word-break: keep-all` 및 자연스러운 길이 제한 적용
- `?view=macro`를 서버 초기 상태로 처리해 첫 렌더 깜빡임 제거
- ESLint 대상에서 레거시 디버그 파일을 제외하고 변경 코드의 lint 오류 제거

## 검증

- `npm run build`: PASS
- `npm run lint`: PASS
- TypeScript: PASS
- 1536×900 desktop: 가로 overflow 없음
- 768×1024 tablet: 가로 overflow 없음
- 390×844 mobile: 가로 overflow 없음

## 변경 파일

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/ui/dashboard.tsx`
- `src/app/globals.css`
- `src/app/api/feeds/route.ts`
- `eslint.config.mjs`

## QA 이미지

- `qa/v55-target-alignment-desktop.png`
- `qa/v55-target-alignment-mobile.png`
