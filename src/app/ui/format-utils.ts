import type { Article } from '@/lib/types';

export type PageKey = 'feed' | 'sources' | 'macro' | 'reports';
export type SortKey = 'latest' | 'score' | 'category';
export type UiLang = 'ko' | 'en';

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
export function relativeTimeKst(value: string, lang: UiLang = 'ko') {
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs)) return shortDate(value);
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return lang === 'en' ? 'just now' : '방금 전';
  if (diffMin < 60) return lang === 'en' ? `${diffMin} min ago` : `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return lang === 'en' ? `${diffHour}h ago` : `${diffHour}시간 전`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return lang === 'en' ? `${diffDay}d ago` : `${diffDay}일 전`;
  return shortDate(value);
}

function normalizeForCompare(s: string) {
  return s.toLowerCase().replace(/^\[매크로\]\s*/, '').replace(/[^\p{L}\p{N}]+/gu, '').trim();
}

function hasNonLatinPayload(s: string | undefined | null) {
  const payload = (s || '').replace(/^\[매크로\]\s*/, '').replace(/^\[Macro\]\s*/, '');
  return /[가-힣ぁ-ヿ一-龯]/.test(payload);
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
export function resolveSummary(article: Pick<Article, 'title' | 'summary' | 'summaryKo' | 'summaryEn'>, categoryLabel: string, lang: UiLang = 'ko') {
  const rawSummary = lang === 'en'
    ? (article.summaryEn || (!hasNonLatinPayload(article.summary) ? article.summary : ''))
    : (article.summaryKo || article.summary);
  const titleCore = article.title.replace(/\s[-–—|]\s.*$/, '').trim();
  const summaryCore = (rawSummary || '').replace(/\s[-–—|]\s.*$/, '').trim();
  const isMeaningful = !!rawSummary
    && normalizeForCompare(summaryCore) !== normalizeForCompare(titleCore)
    && !summaryCore.includes(titleCore.slice(0, 24));
  if (isMeaningful) return rawSummary!;
  return lang === 'en' ? `Related ${categoryLabelFor(categoryLabel, 'en')} update. Open the original article for details.` : `${categoryLabel} 관련 소식입니다. 원문에서 자세한 내용을 확인하세요.`;
}


export function displayArticleTitle(article: Pick<Article, 'title' | 'titleKo' | 'titleEn'>, lang: UiLang = 'ko') {
  const { titleKo, titleEn } = resolveTitles(article);
  if (lang === 'ko') return titleKo;
  const candidate = (titleEn || article.title || titleKo).replace(/^\[매크로\]/, '[Macro]');
  if (hasNonLatinPayload(candidate)) return 'Industry update — open original article for details';
  return candidate;
}

export function secondaryArticleTitle(article: Pick<Article, 'title' | 'titleKo' | 'titleEn'>, lang: UiLang = 'ko') {
  const { titleEn } = resolveTitles(article);
  if (lang === 'en') return null;
  return titleEn;
}

export function categoryLabelFor(label: string, lang: UiLang = 'ko') {
  if (lang === 'ko') return label;
  const cleaned = label.replace(/^\S+\s*/, '').trim();
  const map: Record<string, string> = {
    '전체': 'All',
    '원재료 & 가격': 'Feedstock & Prices',
    '가격/원가': 'Prices & Costs',
    '경쟁사 동향': 'Competitors',
    '소재·제품': 'Materials & Products',
    '소재/제품': 'Materials & Products',
    '수요산업': 'Downstream Demand',
    '정책·규제': 'Policy & Regulation',
    '기술·R&D': 'Technology & R&D',
    '통상·공급망': 'Trade & Supply Chain',
    '의료기기': 'Medical Devices',
    '재무리스크 & 구조조정': 'Financial Risk & Restructuring',
    '신소재 & 제품 출시': 'New Materials & Product Launches',
    '지속가능성 & 순환경제': 'Sustainability & Circular Economy',
    '생산능력 & 설비투자': 'Capacity & Investment',
    'M&A·파트너십 & 전략': 'M&A, Partnerships & Strategy',
    '시장 동향 & 공급망': 'Market Trends & Supply Chain',
    '폴리머 유통채널': 'Polymer Distribution Channels',
    '자동차 & 자율주행': 'Automotive & Mobility',
    '전기·전자 & E-모빌리티': 'Electronics & E-Mobility',
    '반도체 & AI데이터센터': 'Semiconductors & AI Data Centers',
    'ESS & 배터리': 'ESS & Batteries',
    '의료기기 & 헬스케어': 'Medical Devices & Healthcare',
    '원료 & 업스트림': 'Feedstock & Upstream',
    '규제 & 컴플라이언스': 'Regulation & Compliance',
    '공시 & 시그널': 'Disclosure & Signals',
  };
  return map[cleaned] || cleaned || label;
}

export function sourceNameFor(name: string | undefined | null, lang: UiLang = 'ko') {
  const raw = (name || '').trim();
  if (!raw || lang === 'ko') return raw;
  const aliases: Record<string, string> = {
    'GA_케미컬뉴스': 'Chemical News Korea',
    'GA_化学工業日報': 'The Chemical Daily',
    '新浪财经': 'Sina Finance',
    '新浪网': 'Sina',
    '연합뉴스': 'Yonhap News Agency',
    '네이트 뉴스': 'Nate News',
    '조선일보': 'Chosun Ilbo',
    '매일경제': 'Maeil Business Newspaper',
    '뉴시스': 'Newsis',
    '서울경제': 'Seoul Economic Daily',
    '뉴델리 경제': 'New Delhi Economy',
    '뉴데일리 경제': 'NewDaily Economy',
    '재경일보': 'Jaekyung Ilbo',
    '알파경제': 'Alpha Economy',
    '한국금융경제신문': 'Korea Financial Economy News',
    '브릿지경제': 'Bridge Economy',
    '공공뉴스': 'Public News',
    '투데이에너지': 'Today Energy',
    'Yahoo!ファイナンス': 'Yahoo! Finance Japan',
    '旭化成 エンプラ総合情報サイト': 'Asahi Kasei Engineering Plastics Portal',
    'ゴムタイムス': 'Rubber Times Japan',
    '京都新聞': 'Kyoto Shimbun',
    '日刊ケミカルニュース': 'Nikkan Chemical News',
    'トレーダーズ・ウェブ': 'Traders Web',
    '財聯社': 'Cailian Press',
    '财联社': 'Cailian Press',
  };
  return aliases[raw] || raw;
}

export function tagLabelFor(tag: string, lang: UiLang = 'ko') {
  const raw = (tag || '').trim();
  if (!raw || lang === 'ko') return raw;
  const aliases: Record<string, string> = {
    '관세/ATV': 'Tariffs/ATV',
    '관세': 'Tariffs',
    '반도체': 'Semiconductors',
    '신소재': 'New Materials',
    '규제': 'Regulation',
    '배터리': 'Batteries',
    '자동차': 'Automotive',
    '공급망': 'Supply Chain',
  };
  if (aliases[raw]) return aliases[raw];
  return /[가-힣ぁ-ヿ一-龯]/.test(raw) ? 'Topic' : raw;
}

export function t(lang: UiLang, ko: string, en: string) { return lang === 'en' ? en : ko; }

export function indicatorNameFor(id: string, nameKo: string, lang: UiLang = 'ko') {
  if (lang === 'ko') return nameKo;
  const explicit: Record<string, string> = {
    fx_usd_krw: 'USD/KRW Exchange Rate',
    fx_usd_cny: 'USD/CNY Exchange Rate',
    oil_brent: 'Brent Crude Oil',
    oil_wti: 'WTI Crude Oil',
    rate_us_10y: 'US 10-Year Treasury Yield',
    pmi_us: 'US Manufacturing PMI',
    pmi_china: 'China Manufacturing PMI',
    pmi_eurozone: 'Eurozone Manufacturing PMI',
    pmi_japan: 'Japan Manufacturing PMI',
    pmi_korea: 'Korea Manufacturing PMI',
    cpi_us: 'US CPI',
    cpi_korea: 'Korea CPI',
    cpi_china: 'China CPI',
    industrial_production_us: 'US Industrial Production',
    industrial_production_korea: 'Korea Industrial Production',
    industrial_production_china: 'China Industrial Production',
    industrial_production_japan: 'Japan Industrial Production',
    industrial_production_eurozone: 'Eurozone Industrial Production',
    gdp_current_usd: 'US Annual GDP',
    gdp_qoq_us: 'US GDP QoQ Growth',
    gdp_qoq_us_te: 'US Annual GDP Growth',
    gdp_quarterly_us: 'US Quarterly Real GDP',
    gdp_annual_korea: 'Korea Annual Nominal GDP',
    gdp_quarterly_korea: 'Korea Quarterly Real GDP',
    gdp_qoq_korea: 'Korea GDP QoQ Growth',
    gdp_qoq_korea_te: 'Korea Annual GDP Growth',
    gdp_annual_japan: 'Japan Annual Nominal GDP',
    gdp_quarterly_japan: 'Japan Quarterly Nominal GDP',
    gdp_qoq_japan: 'Japan GDP QoQ Growth',
    gdp_qoq_japan_te: 'Japan Annual GDP Growth',
    gdp_annual_china: 'China Annual Nominal GDP',
    gdp_quarterly_china: 'China Quarterly Nominal GDP',
    gdp_qoq_china_te: 'China Annual GDP Growth',
    gdp_annual_eurozone: 'Eurozone Annual Nominal GDP',
    gdp_quarterly_eurozone: 'Eurozone Quarterly Real GDP',
    gdp_qoq_eurozone_te: 'Eurozone Annual GDP Growth',
    gdp_annual_india: 'India Annual Nominal GDP',
    gdp_quarterly_india: 'India Quarterly Nominal GDP',
    gdp_qoq_india: 'India GDP QoQ Growth',
    gdp_qoq_india_te: 'India Annual GDP Growth',
  };
  if (explicit[id]) return explicit[id];
  const name = nameKo
    .replace(/미국/g, 'US').replace(/한국/g, 'Korea').replace(/일본/g, 'Japan')
    .replace(/중국/g, 'China').replace(/유로존/g, 'Eurozone').replace(/인도/g, 'India')
    .replace(/브렌트유 가격/g, 'Brent Crude Oil').replace(/WTI유 가격/g, 'WTI Crude Oil')
    .replace(/제조업/g, 'Manufacturing').replace(/환율/g, 'Exchange Rate').replace(/국채 10년 금리/g, '10-Year Treasury Yield')
    .replace(/산업생산지수/g, 'Industrial Production').replace(/물가/g, 'CPI')
    .replace(/분기 실질 GDP/g, 'Quarterly Real GDP').replace(/분기 명목 GDP/g, 'Quarterly Nominal GDP')
    .replace(/연간 명목 GDP/g, 'Annual Nominal GDP').replace(/연간 GDP 성장률/g, 'Annual GDP Growth')
    .replace(/분기 GDP 성장률/g, 'Quarterly GDP Growth')
    .replace(/명목 GDP/g, 'Nominal GDP').replace(/실질 GDP/g, 'Real GDP')
    .replace(/전분기 성장률/g, 'QoQ Growth').replace(/연간 성장률/g, 'Annual Growth').replace(/GDP 성장률/g, 'GDP Growth')
    .replace(/\(국가통계국\)/g, '(NBS)');
  return name.replace(/\s+/g, ' ').trim();
}

export function countryLabelFor(country: string, lang: UiLang = 'ko') {
  const ko: Record<string, string> = { us: '미국', korea: '한국', japan: '일본', china: '중국', eurozone: '유로존', india: '인도' };
  const en: Record<string, string> = { us: 'United States', korea: 'Korea', japan: 'Japan', china: 'China', eurozone: 'Eurozone', india: 'India' };
  return (lang === 'en' ? en : ko)[country] || country;
}

export function impactBadgeFor(id: string, label: string, title: string, lang: UiLang = 'ko') {
  if (lang === 'ko') return { label, title };
  const labelMap: Record<string, string> = { '원료': 'Feedstock', '수요': 'Demand', '거시': 'Macro', 'EP': 'EP' };
  const titleMap: Record<string, string> = {
    '원유·나프타·feedstock 원가 방향성': 'Oil, naphtha and feedstock cost direction',
    '전방 제조업·산업생산 수요 신호': 'Downstream manufacturing and industrial demand signal',
    '분기 GDP 기반 전방수요·경기 신호': 'Quarterly GDP-based demand and cycle signal',
    'EP 수출·원가·마진에 직접 영향이 큰 환율 지표': 'FX indicator directly linked to EP exports, cost and margin',
    'EP 산업과 직접 관련된 우선 지표': 'Priority indicator directly relevant to EP',
    '금리·물가·연간 GDP 등 거시 참고 지표': 'Macro reference indicator such as rates, CPI or annual GDP',
  };
  return { label: labelMap[label] || label, title: titleMap[title] || title };
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
