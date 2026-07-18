import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import feeds from '@/data/feeds.json';
import taxonomyData from '@/data/taxonomy.json';
import type { Article, ArticleFilters, FeedSource } from './types';

const TAXONOMY = taxonomyData as {
  categories: Array<{ id: string; label: string; order: number }>;
  tags: Array<{ id: string; category: string; keywords: string[]; label: string }>;
};

const parser = new Parser({
  timeout: 12000,
  // SEC EDGAR blocks generic/bot-like User-Agent values with 403.
  // Use an identifiable contact-style UA as recommended for SEC automated access.
  headers: { 'User-Agent': 'EP Industry Monitor qdong@lgchem.com' },
});

const DATA_DIR = path.join(process.cwd(), 'data');
const ARTICLES_PATH = path.join(DATA_DIR, 'articles.json');
const FILTER_DIAGNOSTICS_PATH = path.join(DATA_DIR, 'filter-diagnostics.json');

export const CATEGORY_META = [
  { id: 'new-materials', label: '🧪 신소재 & 제품 출시', color: '#49D7A9', keywords: ['launch','new product','grade','material','resin','compound','신제품','출시','소재','수지','グレード'] },
  { id: 'sustainability', label: '♻️ 지속가능성 & 순환경제', color: '#5CD47B', keywords: ['recycl','circular','sustainable','bio-based','biomass','carbon neutral','재활용','순환','바이오','친환경','リサイクル'] },
  { id: 'capacity', label: '🏭 생산능력 & 설비투자', color: '#F6C65B', keywords: ['capacity','plant','facility','expansion','capex','production','investment','증설','공장','설비','투자','생산능력'] },
  { id: 'ma-strategy', label: '🤝 M&A·파트너십 & 전략', color: '#B48CFF', keywords: ['acquisition','merger','m&a','partnership','joint venture','jv','strategy','인수','합병','파트너십','전략','제휴'] },
  { id: 'market-supply', label: '📊 시장 동향 & 공급망', color: '#7AA7FF', keywords: ['market','price','supply','demand','shortage','inventory','forecast','trend','시장','가격','수급','공급망','전망'] },
  { id: 'distribution-channel', label: '🌍 폴리머 유통채널', color: '#5E9CFF', keywords: ['distributor','distribution','channel','resin distributor','polymer distributor','plastics distribution','material database','유통','대리점','공급채널','소재 데이터베이스','ravago','nexeo','resinex','distrupol','plastribution','imcd','azelis','mitsubishi corporation','mitsui & co','itochu','marubeni','sumitomo corporation','toyota tsusho','sojitz','nagase','inabata','三菱商事','三井物産','伊藤忠','丸紅','住友商事','豊田通商','双日','長瀬産業','稲畑産業'] },
  { id: 'auto-mobility', label: '🚗 자동차 & 자율주행', color: '#FF9F6E', keywords: ['automotive','mobility','vehicle','lightweight','autonomous driving','self-driving','adas','lidar','robotaxi','자동차','모빌리티','경량화','자율주행','라이다'] },
  { id: 'electronics-emobility', label: '⚡ 전기·전자 & E-모빌리티', color: '#56D4FF', keywords: ['electronics','connector','pcb','electrical','전자','전기','커넥터'] },
  // [v1.0] n8n v5.6 이식: 미래 성장동력 응용처 전용 카테고리 (반도체/AI데이터센터/로봇/휴머노이드/ESS/의료기기).
  // 신설 전에는 이 콘텐츠가 electronics-emobility/auto-mobility에 흩어져 같은 사건이
  // 카테고리를 넘나드는 문제가 있었음(n8n 7/9 발행분에서 실제 관측).
  { id: 'semicon-ai-datacenter', label: '🖥️ 반도체 & AI데이터센터', color: '#8CE0FF', keywords: ['semiconductor packaging','advanced packaging','chip packaging','glass substrate','test socket','wafer carrier','ai data center','data center cooling','liquid cooling','immersion cooling','반도체 패키징','유리기판','테스트소켓','ai 데이터센터','액침냉각','에스폴리텍','espolytech'] },
  { id: 'robot-humanoid', label: '🤖 로봇 & 휴머노이드', color: '#C9A8FF', keywords: ['humanoid','humanoid robot','service robot','industrial robot','robot actuator','robot joint','collaborative robot','cobot','휴머노이드','서비스로봇','산업용로봇','협동로봇','로봇 액추에이터'] },
  { id: 'ess-battery', label: '🔋 ESS & 배터리', color: '#FFD666', keywords: ['energy storage system','battery enclosure','battery pack housing','thermal runaway','flame retardant compound','stationary storage','ev battery','에너지저장장치','배터리팩 하우징','열폭주','전기차 배터리'] },
  { id: 'medical-device', label: '💊 의료기기 & 헬스케어', color: '#FF9ECD', keywords: ['medical device','implant','drug delivery','medical grade','medical plastic','biocompatible','의료기기','임플란트','의료용 소재','생체적합성'] },
  { id: 'upstream', label: '🛢️ 원료 & 업스트림', color: '#D6A15B', keywords: ['caprolactam','bpa','bisphenol','naphtha','benzene','butadiene','mdi','tdi','monomer','원료','나프타','카프로락탐'] },
  { id: 'regulation', label: '📜 규제 & 컴플라이언스', color: '#A8B3C7', keywords: ['regulation','compliance','tariff','antidumping','epa','reach','tsca','lawsuit','fine','규제','관세','공정위','고발','제재','訴訟'] },
  { id: 'signals', label: '📡 공시 & 시그널', color: '#E8A63C', keywords: ['earnings','guidance','filing','contract','notice','disclosure','공시','실적','계약','발표','신호'] },
  { id: 'financial-risk', label: '🚨 재무리스크 & 구조조정', color: '#FF6B6B', keywords: ['insolvency','bankruptcy','default','liquidity','debt covenant','credit downgrade','restructuring','going concern','파산','부도','유동성','채무불이행','재무위험','구조조정','信用不安','債務不履行'] },
  // [v1.0] n8n v5.5 이식: 매크로/전방산업/주요국 통상규제. EP 수지명 없이도
  // 전방산업 경기·관세·CBAM 등 사업환경 신호로 진입(별도 게이트, 아래 macro 처리 참고).
  { id: 'macro-trade', label: '🌐 매크로 & 전방산업', color: '#7FE0D6', keywords: ['petrochemical','downstream demand','feedstock','naphtha','tariff','anti-dumping','cbam','carbon border','trade war','wto','석유화학','전방산업','경기전망','관세','반덤핑','탄소국경','통상마찰'] },
];

// [v0.3] CORE_REGEX가 'resin','polymer','compound','composite' 같은 범용 단어만으로
// 통과되던 문제 수정. BASF/Covestro 같은 대형 화학사는 향료·도료 등 EP와 무관한
// 보도자료에도 이런 범용 단어를 흔히 포함하므로, 범용 단어 단독으로는 게이트를
// 통과할 수 없게 하고 EP 특화 재료명/약어/전문기업명 중 하나를 반드시 요구한다.
const CORE_SPECIFIC = /(engineering plastics?|폴리카보네이트|폴리아미드|나일론\s?6\.?6|특수수지|엔지니어링\s?플라스틱|엔프라|工程塑料|改性塑料|特种工程塑料|特種工程塑料|聚酰胺|尼龙|尼龍|聚碳酸酯|聚甲醛|聚苯硫醚|液晶聚合物|复合材料|複合材料|樹脂複合|エンプラ|エンジニアリングプラスチック|樹脂複合|polycarbonate|polyamide|\bpa\s?6\/?6\b|\bpa\s?6\b|\bpbt\b|\bpom\b|\bpeek\b|\bpps\b|\bppa\b|\bpsu\b|\bpei\b|caprolactam|bisphenol|\bbpa\b|liquid crystal polymer|\blcp\b|covestro|celanese|envalior|syensqo|victrex|ems-chemie|ems-grivory|polyplastics|kingfa|金发科技|trinseo|sabic|lg\s?chem|lg화학|lotte\s?chem|롯데케미칼|sk\s?chemicals|kolon|코오롱|wanhua|万华化学|萬華化學|domo\s?chemicals|radicigroup|espolytech|에스폴리텍|biopolymers|ultrason|tinosorb|bemotrizinol|adapzo|carbon trust|\bbasf\b|pret\s?composites?|shanghai\s?pret|普利特|formosa\s?(plastics|chemicals)?|台塑|南亚塑胶|南亞塑膠|nan\s?ya\s?plastics?|chang\s?chun\s?(group|plastics)?|长春化工|長春化工|shinkong\s?synthetic\s?fibers?|新光合成纤维|新光合成纖維|far\s?eastern\s?new\s?century|远东新世纪|遠東新世紀|\bfenc\b|lcy\s?(chemical|group)?|李长荣化工|李長榮化工|polyrocks|聚石化学|聚石化學|nanjing\s?julong|南京聚隆|xiamen\s?lft|long\s?fiber\s?thermoplastic|dawn\s?polymer|shandong\s?dawn|道恩股份|山东道恩|山東道恩|ensinger|roechling|röchling|lehvoss|luvocom|mocom|albis|sirmax|biesterfeld|grupa\s?azoty|tarnamid|radicigroup|radici\s?group|domo\s?chemicals|ascend\s?performance\s?materials|avient|rtp\s?company|tekniplex|zeus\s?industrial\s?products|foster\s?(corporation|compounds)|putnam\s?plastics|polymer\s?resources|chase\s?plastics|m\.\s?holland|techmer\s?pm|aurora\s?plastics|star\s?plastics|ravago|nexeo\s?plastics|resinex|distrupol|omya\s?performance\s?polymer\s?distribution|plastribution|channel\s?prime\s?alliance|imcd|azelis|ul\s?prospector|specialchem|campusplastics|polymer\s?distributor|resin\s?distributor|plastics\s?distribution|engineering\s?plastics\s?distributor|樹脂商社|化学品専門商社)/i;
// [v1.0] n8n v5.6 이식: 미래 성장동력 응용처(로봇/휴머노이드/ESS/반도체패키징/AI데이터센터/
// 자율주행) 키워드. CORE_SPECIFIC에 있어야 EP 재료명과 결합됐을 때 확실히 게이트 통과.
const FUTURE_GROWTH_TERMS = /(humanoid|humanoid robot|service robot|industrial robot|robot actuator|robot joint|collaborative robot|cobot|autonomous driving|self-driving|lidar|adas|robotaxi|energy storage system|\bess\b|battery enclosure|battery pack housing|thermal runaway|flame retardant compound|semiconductor packaging|advanced packaging|chip packaging|glass substrate|test socket|wafer carrier|ai data center|data center cooling|immersion cooling|medical device|medical grade|biocompatible|휴머노이드|서비스로봇|산업용로봇|협동로봇|로봇 액추에이터|자율주행|라이다|에너지저장장치|배터리팩 하우징|열폭주|반도체 패키징|유리기판|테스트소켓|ai 데이터센터|액침냉각|의료기기|임플란트)/i;
const CORE_GENERIC = /(resin|compound|polymer|composite|plastics?|thermoplastic|chemical products?|수지|화합물|樹脂|プラスチック|ポリマー|化学品|素材)/i;
function hasCoreSignal(text: string) { return CORE_SPECIFIC.test(text) || CORE_GENERIC.test(text); }

const EVENT_REGEX = /(launch|unveil|introduc|debut|develop|advanc|expansion|capacity|investment|acqui|partnership|merger|agreement|distribution|distribut|appointment|appoint|exclusive|portfolio|digital\s?commerce|transaction|complete[sd]?|regulation|tariff|antidumping|lawsuit|fine|recall|contract|price|supply|supplies|demand|shortage|plant|facility|factory|unit|compounding|recycling|split|reorganization|insolven|bankrupt|default|liquidity|covenant|downgrade|restructur|going\s?concern|files? for|adopt|selected for|chosen for|qualifies for|qualified for|names?\s+(?:new\s+)?|showcase|showcasing|exhibit|attend|award|recogniz|certification|certified|opens?|commission|inaugurat|출시|개발|증설|투자|인수|합병|제휴|거래|완료|규제|관세|고발|제재|계약|가격|수급|공장|설비|파산|부도|채무불이행|유동성|구조조정|회생절차|분할|조직개편|선적|출하|납품|공급|채택|선정|扩产|擴產|投产|投產|产能|產能|投资|投資|收购|收購|并购|併購|合作|协议|協議|开发|開發|推出|发布|發布|获批|獲批|专利|專利|涨价|漲價|价格|價格|供应|供應|短缺|工厂|工廠|基地|项目|項目|完了|発表|買収|提携|規制|販売|代理店|供給|拡大|契約|覚書|合意|設立)/i;

// [v5.39] 재무리스크 키워드 이식: 단순 bankruptcy/insolvency뿐 아니라
// liquidity crunch, covenant breach, default, going concern, refinancing stress 등
// 공급망 리스크로 이어지는 재무 이벤트를 별도 신호로 포착한다.
const FINANCIAL_RISK_REGEX = /(insolven(?:cy|t)?|bankrupt(?:cy)?|chapter\s?(?:11|7)|default(?:ed|s|ing)?|debt\s+default|payment\s+default|miss(?:ed|es)?\s+payment|liquidity\s+(?:crunch|crisis|shortfall|pressure|concern)|cash\s+(?:crunch|shortfall|burn)|going\s+concern|debt\s+covenant|covenant\s+(?:breach|violation|waiver)|credit\s+(?:downgrade|watch|negative)|refinanc(?:e|ing)\s+(?:risk|pressure|talks)|restructur(?:e|ing)|turnaround\s+plan|distress(?:ed)?|administration|liquidat(?:e|ion)|receivership|파산|부도|채무불이행|디폴트|유동성\s*(?:위기|우려|압박|부족)|자금난|현금\s*부족|계속기업\s*불확실|채무\s*약정|신용등급\s*강등|구조조정|워크아웃|회생절차|法的整理|破産|倒産|債務不履行|流動性(?:危機|不足|懸念)|信用不安|事業再生|私的整理)/i;
// [v0.3] 사건성 없는 IR 홍보문("전략을 제시했다", "입지를 강화하고 있다") 차단.
const IR_FLUFF_REGEX = /((outlines?|unveils?|presents?|sets out)\s+(its\s+)?[\w\s-]{0,30}?(strategy|outlook|vision|roadmap)\b|(strengthen(ing|s)?|solidif(y|ies|ying)|build(ing|s)?)\s+its\s+(position|leadership|presence)\b|as investors\s+(assess|monitor|eye|track|watch)|전략(을|를)\s*(제시|발표)(했|한다)|입지를\s*강화하고\s*있)/i;

// [v0.3] 도메인 KILL 목록 대폭 확장 — 기존 10개는 IndexBox·Spherical Insights 등
// 실사용 중 확인된 스팸 다수를 놓치고 있었음. n8n 파이프라인 검증 목록을 이식.
const KILL_DOMAINS = [
  // [v2.1] TradingView는 뉴스가 아니라 순수 주가지표(목표주가/PER 등) 스니펫만
  // 생성 — 회사명이 EP 기업과 겹치면(예: "Shaily Engineering Plastics") CORE
  // 게이트를 통과하지만 실제로는 산업 뉴스가 아님(실사용 데이터에서 2건 확인).
  'tradingview.com','marketsmojo.com',
  'fortunebusinessinsights.com','marketresearchfuture.com','researchandmarkets.com',
  'openpr.com','einnews.com','einpresswire.com','globenewswire.com','prnewswire.com',
  'reportlinker.com','verifiedmarketreports.com','marketwatch.com',
  'indexbox.io','sphericalinsights.com','menafn.com','issuewire.com','abnewswire.com',
  'prunderground.com','newsfilecorp.com','grandviewresearch.com','mordorintelligence.com',
  'marketsandmarkets.com','alliedmarketresearch.com','precedenceresearch.com','gminsights.com',
  'databridgemarketresearch.com','futuremarketinsights.com','transparencymarketresearch.com',
  'imarcgroup.com','skyquestt.com','snsinsider.com','straitsresearch.com','wiseguyreports.com',
  'htfmarketreport.com','htfmarketintelligence.com','360researchreports.com','absolutereports.com',
  'industryresearch.biz','marketresearchintellect.com','coherentmarketinsights.com',
  'polarismarketresearch.com','towardspackaging.com','towardsautomotive.com',
  'expertmarketresearch.com','zionmarketresearch.com','kbvresearch.com','whatech.com',
];
// [v0.3] 도메인이 아니라 본문에 리서치사 이름이 인용/재배포되는 경우까지 포착.
const RESEARCH_COMPANIES = [
  'marketsandmarkets','grand view research','mordor intelligence','technavio',
  'verified market research','allied market research','transparency market research',
  'future market insights','persistence market research','fact.mr','coherent market insights',
  'dataintelo','maximize market research','stratview research','spherical insights',
  'skyquest','straits research','indexbox','research and markets','reportlinker',
];
const TITLE_KILL_REGEX = /(market size|share, trends|market analysis|market growth driven|forecast\s*(to|203|202)|,\s*forecast\s*,|cagr|industry analysis|research report|시장\s*규모|시장\s*보고서|시장\s*전망\s*보고서|시장\s?조사\s?보고서|市場規模|分析レポート|調査レポート|무료 샘플|샘플 요청|press release distribution|students capture|honors\b|contracts for [a-z]+ \d{1,2}, \d{4}|pnas|市场规模|市场报告|市场研究报告|市场调研|调研报告|市场调查|行业调研|股价|股票|行情|主力资金|净卖出|净买入|业绩预告|業績預告|业绩说明会|業績說明會|法说会|法說會|財報|财报|中报|中報|年报|年報|研报|研報|买入评级|買入評級|目标价|目標價|涨停|漲停|跌停|stock price|share price|technical analysis|price to book|net profit jumps|q[1-4]\s+net profit|eps\b|dividend|intraday surge|hits day high|투자의견|목표가|주가)/i;
const KILL_PATTERNS = [
  /tradingview/i,
  // [v5.11] ICIS/Google News가 로그인 차단 페이지를 기사처럼 내보내는 경우
  // 예: "article - login - ICIS". 원문 접근이 막힌 placeholder라 정보 가치가 없어 원천 배제.
  /(^|\s|\[)(article|기사)\s*[-–—|:]\s*(login|로그인)\s*[-–—|:]/i,
  /\b(login|sign\s?in|subscribe|subscription required|access denied|paywall)\b\s*[-–—|:]\s*(icis|article)/i,
  /로그인\s*[-–—|:]\s*(icis|기사)/i,
  // [v5.49] Google News + ICIS는 로그인/권한 차단 페이지를 제목 없이 "- ICIS" 또는
  // 짧은 출처 suffix만으로 반복 배출한다. 본문도 없고 원문 접근이 막혀 매크로 레인 품질을
  // 떨어뜨리므로 ICIS placeholder는 수집/표시 양쪽에서 fail-closed 처리한다.
  /^\s*(\[(매크로|Macro)\]\s*)?[-–—|:]?\s*ICIS\s*$/i,
  /^\s*(\[(매크로|Macro)\]\s*)?[-–—|:]\s*ICIS\s*$/i,
  /[-–—|:]\s*ICIS\s*$/i,
  /news\.google\.com\/rss\/articles\/.*\bICIS\b/i,
  // [v5.20] FX 차트/기술적 분석 업데이트(Continuum Economics 등)는 산업 뉴스가 아니라
  // 단기 트레이딩 코멘트라 매크로 피드에서 제외. 예: "Chart USD/KRW Update: Consolidating... support".
  /\bchart\s+(usd\/krw|usdkrw|eur\/usd|usd\/jpy|usd\/cny)\s+update\b/i,
  /\b(usd\/krw|usdkrw)\b.{0,80}\b(consolidating|support|resistance|losses|breakout)\b/i,
  /차트\s*(usd\/krw|usdkrw|원\/달러|원달러)\s*업데이트/i,
  // [v5.22] Google News FX 검색어의 won이 스포츠 문장 "We Won Today"를 오탐한 사례 차단.
  // 예: "We Won Today - Kansas State University Athletics".
  /\bwe\s+won\s+today\b/i,
  /\b(kansas\s+state\s+university\s+athletics|university\s+athletics|college\s+athletics)\b/i,
  /\b(athletics|basketball|football|baseball|softball|soccer|track\s+and\s+field|volleyball|tennis|golf)\b.{0,80}\b(won|defeated|victory|game|match|season|tournament|championship)\b/i,
  /\b(jannik\s+sinner|wimbledon|u\.s\.\s+open|us\s+open|wyndham\s+clark|espn)\b.{0,100}\b(won|wimbledon|open|tournament|championship)\b/i,
  // [v5.25] FX won 검색어가 "won't" 같은 일반 문장까지 잡는 교육/대학입시 오탐 차단.
  // 예: "Reviving SAT requirements won’t fix California's university admissions problems".
  /\b(sat\s+requirements?|university\s+admissions?|college\s+admissions?|california'?s\s+university\s+admissions?|calmatters)\b/i,
  /(대학\s*입학|대학\s*입시|입학\s*요건|SAT\s*요건)/i,
  /\bopinion\b.{0,80}\b(sat|university|college|admissions?)\b/i,
  // [v2.2] "Untitled - United States Trade Representative (.gov)"처럼 제목
  // 자체가 빈 플레이스홀더인 경우 — 정보 가치가 전혀 없어 원천 배제.
  /^\[?(매크로|공시|커뮤니티)?\]?\s*untitled\s*[-–—|]/i,
  // [v1.4] 증권사 애널리스트 리포트/목표가 프리뷰 (예: "'2Q26 Preview: PE, PP 스프레드
  // 개선에 관심을 가질 시점' 목표가..." — 한국투자증권 등 증권사 리서치 요약).
  // 회사명 검색 피드가 이런 스탁 리서치 콘텐츠까지 주워오는 걸 확인(스크린샷).
  /\[리포트\s?브리핑\]/, /\d[qQ]\d{2}\s*preview/i, /목표가|가격\s?목표|price\s+target/i, /스프레드\s*개선/,
  /투자의견|매수의견|매도의견|적극\s*매수|장기적\s*회복\s*기대/, /증권사?\s*(리포트|리서치|분석)/,
  // [v5.12] Judal/주달류 종목 AI 투자분석 — 산업 뉴스가 아니라 가격대별 매수 권고라 원천 배제.
  /투자\s*분석\s*20\d{2}[.\-\s]\s*\d{1,2}[.\-\s]\s*\d{1,2}/, /investment\s+analysis\s+20\d{2}/i,
  /\d{3,6}\s*원\s*(이하|미만|아래)\s*(적극\s*)?(매수|분할\s*매수)/,
  // [v2.1] TradingView류 순수 주가지표 콘텐츠 — "OOO 예측 - 가격 목표 - N년 예측",
  // "수익 대비 가격"(forward P/E) 등. 도메인 킬과 별개로 텍스트 패턴으로도 방어.
  /수익\s?대비\s?가격|price\s+to\s+earnings\s+forward|forward\s+p\/?e\b|\bp\/e\s+forward\b/i,
  // [v5.13] ad-hoc-news.de 등에서 회사명+소재 키워드를 끼워 넣은 종목/주식 해설 기사 배제.
  /\b[A-Z][A-Za-z0-9-]{2,}(?:\s+[A-Z][A-Za-z0-9-]{2,}){0,2}\s+stock\s+(reflects|stays|remains|is|looks|trades|gains|falls|drops|rises|surges|slumps)\b/i,
  /\b(stock|shares?)\b.{0,80}\b(specialty polymers?|manufacturing demand|supported by|focus amid|sink|fall|profit|earnings|revenue|investors?|ftse)\b/i,
  /\b(earnings|profits?|revenue|impairment)\b.{0,80}\b(slump|fall|sink|softens?|investors?|shares?|stock|buying opportunity)\b/i,
  /\b(care chemicals|personal care|fragrance ingredients?|fungicide|cosmetics?|longevity)\b/i,
  /\b(campaign|brand\s+campaign|celebrat(?:e|es|ing)\s+the\s+people|behind\s+everyday\s+products?|i\s+helped\s+make\s+this)\b/i,
  /\b(international\s+exhibition\s+on\s+plastics\s+and\s+rubber\s+industries|about\s+chinaplas|why\s+visit\s+chinaplas|facts\s+&\s+figures|video\s+gallery|exhibitors\s+list|virtual\s+exhibition|cps\+\s+points\s+activities)\b/i,
  /\b(chinaplas)\b.{0,80}\b(about|why\s+visit|facts\s+&\s+figures|home|video\s+gallery|exhibitors\s+list|virtual\s+exhibition|cps\+\s+points)\b/i,
  /\b(seeking\s+alpha|return\s+potential|stock\s+in\s+focus|\([A-Z]{2,5}Y?\)\s*[-–—]?\s*seeking\s+alpha)\b/i,
  /\b(obituary|funeral\s+home|legacy\s+obituary)\b/i,
  /\b(clinical\s+cost|pharma\s+input\s+price|dietary\s+supplement\s+industries)\b/i,
  /(動意株|トレーダーズ・ウェブ|ウエルスアドバイザー|Yahoo!ファイナンス)/i,
  /(工作機械|車販売|自動車販売|米販売|がん|癌|水素|希土類|レアアース|食品素材|食材|中古ＩＴ機器|Champion|販売権およびライセンス権|契約管理|Hubble mini|ログミーFinance|バイオメタン|硫酸販売)/i,
  /\b(machine tools?|car sales|vehicle sales|hydrogen|rare earth|food ingredients?|cancer radiation|biodiesel solutions|mobile device distribution|used mobile device|it hardware distributor|hardware distributor|lego building|clean ammonia|ammonia project|komatsu distributor|steel establishes|steel distributor)\b/i,
  /(주식|주가).{0,60}(특수\s*폴리머|제조\s*수요|수요에 의해|초점을 반영|유지)/,
  // [v5.23] 한국어 증시 마감/종가 해설 기사 배제. 회사명·업황이 있어도 주가 마감분석은 산업 뉴스가 아님.
  /\[(마감\s*분석|종가\s*분석|장마감\s*분석)\]/,
  /(전\s*거래일\s*대비|장\s*마감\s*기준).{0,80}(하락|상승|거래를\s*마감|원에\s*거래)/,
  /(장중|장\s*중|거래\s*중).{0,40}(하락세|약세|강세|상승세)/,
  /전\s*거래일\s*대비\s*[\d,]+\s*원\s*\([+-]?\d+(?:\.\d+)?%\)/,
  /(업황\s*(둔화|부진|악화)|경기\s*둔화).{0,80}(장중|약세|하락세|주가|전\s*거래일)/,
  /\d{1,3}\s*만\s*원선\s*(위협|붕괴|돌파|회복)/,
  /closing\s+analysis.{0,80}(won\s+level|trading|shares?|stock)/i,
  /\d{1,3},?\d{3}\s*won\s+level.{0,80}(threatened|support|break)/i,
  // [v5.26] KOSPI/증시지수 약세장·투매 해설은 산업 뉴스가 아니라 금융시장 코멘트라 제외.
  /\b(kospi|korean\s+stocks?|south\s+korea'?s\s+kospi)\b.{0,100}\b(bear\s+market|selloff|sell-off|stock\s+market|equities)\b/i,
  /(코스피|한국\s*증시|국내\s*증시).{0,80}(약세장|투매|급락|하락장|매도세)/,
  /\d{5,6}\s*(예측|forecast)\s*[-—–]\s*가격\s?목표/i,
  // [v2.1] "composite-helmet weight"처럼 일반 composite 키워드가 방탄장비 등
  // EP와 무관한 산업까지 잡던 문제 — 방탄/전투장비 콘텐츠 원천 배제.
  /ballistic\s+helmet|body\s+armor|방탄\s?헬멧|전투\s?헬멧/i,
  // [v1.5] 한국 증권사 리포트만 잡던 패턴이 중국 증권앱(富途牛牛 등) 발
  // 영문 번역 콘텐츠는 놓침 — "Research Insights | X maintains Buy rating on Y" 류
  // 스탁 애널리스트 리서치 콘텐츠를 언어 불문 포착.
  /research insights?\s*\|/i, /maintains?\s+["']?(a\s+)?(strong\s+)?(buy|sell|hold|outperform|underperform|accumulate)["']?\s+rating/i,
  /(buy|sell|hold|outperform)\s+rating\s+on\b/i,
  /(投资意见|买入评级|卖出评级|维持.{0,6}评级|研究报告|富途牛牛|东方财富|同花顺)/,
  /department of war/i, /national bpa honors/i, /students capture/i, /market size/i, /fortune business insights/i,
  // [v1.0] n8n v5.4 이식: 명시적 '기부/자선' 단어 없이도 CSR성 기사인 경우
  // (예: "쌀 30톤을 지원") — 숫자+톤/원 단위 + 지원/기탁/전달 패턴으로 포착.
  /\d+\s*(톤|억\s?원|만\s?원)\s*(을|를)?\s*(지원|기탁|전달|후원)/,
  /(취약계층|불우이웃|성금|기탁|후원금|사랑의 열매|나눔한마당)/,
  // [v1.6] "사랑의 집수리"(사랑의 열매와 다른 표현) 같은 복지관/독거노인 봉사활동
  // 콘텐츠가 회사명만으로 CORE 게이트를 통과하던 문제 — 노인복지관 협력/주거환경
  // 개선 등 CSR 어휘를 더 폭넓게 포착.
  /(노인복지관|주거환경\s*개선|사랑의\s*집수리|복지관\s*추천|독거\s*노인|홀몸\s*어르신)/,
  // [v1.6] "[위클리오늘] 한국마사회, 롯데케미칼, 설화수 소식(7.8)"처럼 서로 무관한
  // 여러 회사를 한 기사에 묶은 주간 동정 다이제스트 포맷 — 이런 번들링 자체가
  // 특정 기업의 실제 EP 뉴스가 아니라는 강한 신호(진짜 단독 뉴스라면 이렇게
  // 무관 기업들과 묶일 이유가 없음).
  /\[위클리오늘\]|\[주간\s?동정\]|\[今週のニュース\]/,
  // [v1.0] n8n v5.12 이식: EP 기업의 컨슈머 세탁/섬유케어 제품(엔지니어링 플라스틱과
  // 무관)이 회사명만으로 CORE 게이트를 통과하던 문제 — 5회 연속 실행에서 카테고리가
  // 매번 다르게 나와 콘텐츠 자체가 부적합하다고 판단, 원천 배제.
  /(soil release|stain removal|fabric care|laundry care|cold-wash|cold wash|detergent)/i,
  /(토양\s?방출|얼룩\s?제거|섬유유연|세탁\s?케어)/,
  // [v1.0] n8n v5.10/v5.12 이식: 형용사를 하나씩 쫓아가는 대신 리포트 스팸의
  // 상투적 마무리 문구로 포착("...offers insights into market trends, key
  // players, and future prospects" 류). title이 아닌 전체 text에서 검사해야
  // 실제로 잡힘 — 이 문구는 대개 설명(description) 쪽에 옴.
  /report.{0,60}(offers?|provides?|providing|offering).{0,30}insights?.{0,30}(into|on).{0,30}(market trends|industry trends)/i,
  /(comprehensive|detailed|extensive|in-depth|specialized)\s+(analysis\s+)?report.{0,60}(has been released|released|published)/i,
  /key players.{0,20},?\s*(and\s+)?future prospects/i,
];
const SOURCE_NAME_OVERRIDES: Record<string, string> = {
  'GA_케미컬뉴스': '케미컬뉴스', 'GA_PlasticsToday': 'PlasticsToday', 'GA_化学工業日報': '화학공업일보', 'GA_Auto_Lightweight': '자동차 경량화',
};

export function getFeeds(): FeedSource[] { return feeds as FeedSource[]; }

// [v1.4] Google News 검색 쿼리 피드(회사명 검색)는 일치 키워드를 <b>태그로
// 강조해서 RSS에 그대로 내려줌 — summary는 태그를 제거하고 있었지만 title은
// 빠뜨려서 "<b>Sabic</b>"처럼 원문 그대로 노출되고 있었음(스크린샷으로 확인).
// HTML 엔티티(&#39; 등)도 디코딩 안 되고 있었음 — 둘 다 여기서 한 번에 처리.
function sanitizeText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
function ensureStore() { fs.mkdirSync(DATA_DIR, { recursive: true }); if (!fs.existsSync(ARTICLES_PATH)) fs.writeFileSync(ARTICLES_PATH, '[]', 'utf8'); }
export function readRawArticles(): Article[] { ensureStore(); try { return JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf8')) as Article[]; } catch { return []; } }
export function writeArticles(articles: Article[]) { ensureStore(); const sorted = [...articles].sort((a,b)=>+new Date(b.publishedAt||b.collectedAt)-+new Date(a.publishedAt||a.collectedAt)); const tmp = `${ARTICLES_PATH}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(sorted,null,2),'utf8'); fs.renameSync(tmp, ARTICLES_PATH); clearNewsStoreCache(); }

// [v1.3] 한/영 제목 병기 — Gemini 없이 무료 번역으로 처리.
// 비공식 Google Translate 엔드포인트(API 키 불필요, 다수 오픈소스 도구가 사용하는 방식)를
// 사용. 공식 SLA가 없는 무료 엔드포인트이므로 실패 시 원문만 표시(장애 시에도 안전).
async function translateText(text: string, targetLang: 'ko' | 'en'): Promise<string | null> {
  if (!text || !text.trim()) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    // 응답 형태: [[["번역문","원문",null,null,...], ...], ...]
    const translated = Array.isArray(data?.[0]) ? data[0].map((seg: unknown[]) => seg?.[0]).join('') : null;
    return translated && translated.trim() ? translated.trim() : null;
  } catch {
    return null; // 타임아웃/네트워크 실패 시 원문만 표시 — 절대 렌더링을 막지 않음
  }
}

// 화면에 노출될 소수의 기사에 대해서만 번역하고, 원본 저장소에 캐싱해 재요청 시
// 다시 번역하지 않도록 한다(무료 엔드포인트 호출량 최소화 + 응답 속도 확보).
export async function enrichWithTranslations(articles: Article[], options: { maxTranslate?: number } = {}): Promise<Article[]> {
  // [v1.5] sanitizeText 도입 이전에 캐시된 titleKo/titleEn엔 <b> 태그가 그대로
  // 남아있음 — 캐시 존재 여부만 보고 건너뛰면 이 오염된 캐시가 영구 보존됨
  // (스크린샷에서 확인: SABIC/롯데케미칼 부제에 <b>Sabic</b> 그대로 노출).
  // 캐시에 태그가 남아있으면 "미완료"로 간주해 재번역하도록 조건 추가.
  const hasTag = (s?: string) => !!s && /<[a-z]/i.test(s);
  // [v5.31] 중문 원문 소스 확장 대응: 제목뿐 아니라 요약도 한국어로 캐싱한다.
  // 단, 화면/API 응답 대상 기사에 대해서만 처리하여 번역 호출량을 제한한다.
  // 실패 시 원문 fallback — 번역 장애가 뉴스 수집/렌더링을 막지 않도록 한다.
  const needsSummaryKo = (a: Article) => !!a.summary && detectLanguage(a.summary) !== 'ko' && (!a.summaryKo || hasTag(a.summaryKo));
  const maxTranslate = options.maxTranslate ?? 40;
  const translationPriority = (a: Article) => {
    const lang = detectLanguage(`${a.title || ''} ${a.summary || ''}`);
    // [v5.55] 초기 SSR은 성능 때문에 maxTranslate를 낮게 잡는다. 이때 영문 기사보다
    // 중·일문 원문 노출이 더 눈에 띄므로 CJK 기사를 먼저 번역한다.
    if (lang === 'zh' || lang === 'ja') return 0;
    if (lang === 'de') return 1;
    return 2;
  };
  const need = articles
    .filter(a => !a.titleKo || !a.titleEn || hasTag(a.titleKo) || hasTag(a.titleEn) || needsSummaryKo(a))
    .sort((a, b) => translationPriority(a) - translationPriority(b))
    .slice(0, maxTranslate);
  if (need.length === 0) return articles;

  const raw = readRawArticles();
  const rawById = new Map(raw.map(a => [a.id, a]));
  let changed = false;

  await Promise.all(need.map(async (a) => {
    // [v2.3] "[매크로] "/"[공시] "/"[커뮤니티] " 태그 자체가 한글이라, 언어감지가
    // 실제로는 영문인 기사도 태그 때문에 무조건 'ko'로 오판하고 있었음 — 그 결과
    // 이미 영어인 본문을 다시 "번역"하다가 번역기가 태그 속 단어만 뜬금없이
    // 오역하는 사고 발생(실사용 데이터에서 확인: "[매크로]"→"[매진]").
    // 태그를 떼어내고 본문만으로 언어감지/번역한 뒤 다시 붙인다.
    const TAG_RE = /^(\[(?:매크로|공시|커뮤니티)\]\s*)/;
    const tagMatch = a.title.match(TAG_RE);
    const tag = tagMatch ? tagMatch[1] : '';
    const bare = tagMatch ? a.title.slice(tag.length) : a.title;
    const lang = detectLanguage(bare);
    if (lang === 'ko') {
      if (!a.titleKo || hasTag(a.titleKo)) a.titleKo = a.title;
      if (!a.titleEn || hasTag(a.titleEn)) a.titleEn = tag + ((await translateText(bare, 'en')) || bare);
    } else {
      if (!a.titleEn || hasTag(a.titleEn)) a.titleEn = a.title;
      if (!a.titleKo || hasTag(a.titleKo)) a.titleKo = tag + ((await translateText(bare, 'ko')) || bare);
    }
    if (needsSummaryKo(a)) {
      const cleanSummary = sanitizeText(a.summary).slice(0, 280);
      a.summaryKo = (await translateText(cleanSummary, 'ko')) || cleanSummary;
    }
    // [v1.3 버그수정] processedArticles()가 병합 시 id를 재해싱하므로, 원본
    // raw 배열 조회는 반드시 rawId(재해싱 이전 원본 id)로 해야 함 — a.id로
    // 조회하면 항상 실패해 캐싱이 무력화됨.
    const rawArt = rawById.get(a.rawId || a.id);
    if (rawArt) { rawArt.titleKo = a.titleKo; rawArt.titleEn = a.titleEn; rawArt.summaryKo = a.summaryKo; changed = true; }
  }));

  if (changed) { try { writeArticles(raw); } catch { /* 캐싱 실패해도 이번 응답엔 영향 없음 */ } }
  return articles;
}
function articleId(link: string, title: string) { return crypto.createHash('sha256').update(`${link||''}|${title||''}`).digest('hex').slice(0,20); }
function domainOf(link: string) { try { return new URL(link).hostname.replace(/^www\./,''); } catch { return ''; } }
function normalizedSourceUrl(link: string) {
  try {
    const u = new URL(link);
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_|ref|source|output|guccounter)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return `${u.hostname.replace(/^www\./,'')}${u.pathname.replace(/\/$/,'')}${u.search}`.toLowerCase();
  } catch { return (link || '').trim().toLowerCase(); }
}
function rawDedupKeyFor(title: string, link: string) {
  const wire = wireCopyKey(title);
  if (wire && wire.length >= 24) return `wire:${wire}`;
  const url = normalizedSourceUrl(link);
  return url ? `url:${url}` : '';
}
function buildRawDedupIndex(articles: Article[]) {
  const keys = new Set<string>();
  for (const a of articles) {
    const url = normalizedSourceUrl(a.link || '');
    if (url) keys.add(`url:${url}`);
    const wire = wireCopyKey(a.title || '');
    if (wire && wire.length >= 24) keys.add(`wire:${wire}`);
  }
  return keys;
}
function extractPublisherFromTitle(title: string) {
  const parts = title.split(/\s[-–—|]\s|\|\s*/).map(p => p.trim()).filter(Boolean);
  const tail = parts.at(-1) || '';
  if (parts.length >= 2 && tail.length <= 28 && !/^(update|updated|breaking)$/i.test(tail)) return tail.replace(/^[-–—|\s]+/,'').trim();
  return '';
}
export function displaySourceName(feedName: string, link?: string, source?: string, title?: string) {
  const fromTitle = title ? extractPublisherFromTitle(title) : '';
  if (fromTitle) return fromTitle;
  if (SOURCE_NAME_OVERRIDES[feedName]) return SOURCE_NAME_OVERRIDES[feedName];
  const d = link ? domainOf(link) : '';
  if (d) return d.replace(/\.(com|co\.kr|net|org|jp|kr)$/,'');
  return (source || feedName).replace(/^GA_/,'').replace(/_/g,' ');
}
function normalizeTitle(title: string) {
  return title.toLowerCase()
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/[-–—|].*$/g,' ')
    .replace(/["'“”‘’\[\](),.?!:;·]/g,' ')
    .replace(/\b(단독|속보|update|updated|reuters|ap)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}
function signature(title: string, publishedAt?: string) {
  const date = publishedAt ? new Date(publishedAt).toISOString().slice(0, 10) : '';
  const norm = normalizeTitle(title);
  const ko = norm.match(/[가-힣A-Za-z0-9]+/g) || [];
  return `${date}|${ko.filter(w => w.length > 1).slice(0, 8).join(' ')}`;
}
function extractTags(text: string): string[] { const lower=text.toLowerCase(); return TAXONOMY.tags.filter(t=>t.keywords.some(kw=>lower.includes(kw.toLowerCase()))).map(t=>t.id); }
function classifyArticle(text: string, fallback?: string) {
  const lower = text.toLowerCase();
  if (FINANCIAL_RISK_REGEX.test(text)) return 'financial-risk';
  if (/\bchinaplas\b/i.test(text)) return 'signals';
  if (/(regulation|compliance|tariff|antidumping|lawsuit|fine|공정위|중기부|검찰|고발|제재|규제|관세)/i.test(text)) return 'regulation';
  if (/(caprolactam|bpa|bisphenol|naphtha|benzene|butadiene|mdi|tdi|monomer|원료|나프타|카프로락탐)/i.test(text)) return 'upstream';
  // [v1.0] n8n v5.6/v5.7 이식: 미래 성장동력 응용처는 electronics-emobility/
  // auto-mobility의 범용 키워드 스코어링에 묻히기 전에 우선 판정.
  // (n8n에서 에스폴리텍 AI데이터센터 기사가 매번 다른 카테고리로 흩어지던 문제의
  // 근본 대응 — "이 응용처면 무조건 이 카테고리" 우선순위를 코드로 고정)
  if (/(medical device|implant|drug delivery|biocompatible|의료기기|임플란트)/i.test(text)) return 'medical-device';
  if (/(semiconductor packaging|advanced packaging|chip packaging|glass substrate|test socket|wafer carrier|ai data center|data center cooling|immersion cooling|반도체 패키징|유리기판|테스트소켓|ai 데이터센터|액침냉각|espolytech|에스폴리텍)/i.test(text)) return 'semicon-ai-datacenter';
  if (/(humanoid|service robot|industrial robot|robot actuator|robot joint|collaborative robot|cobot|휴머노이드|서비스로봇|산업용로봇|협동로봇|로봇 액추에이터)/i.test(text)) return 'robot-humanoid';
  if (/(energy storage system|\bess\b|battery enclosure|battery pack housing|thermal runaway|stationary storage|에너지저장장치|배터리팩 하우징|열폭주)/i.test(text)) return 'ess-battery';
  let best = CATEGORY_META[4], score = -1;
  for (const cat of CATEGORY_META) { const s = cat.keywords.reduce((n,kw)=> n + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0); if (s > score) { score=s; best=cat; } }
  // [v0.3] '응용 산업' 폴백이 항상 auto-mobility로 떨어지던 문제 수정.
  // 의료/전자/포장 등 다른 응용분야 기사가 전부 자동차 카테고리로 잘못 들어갔음.
  // 폴백은 어디까지나 최후 수단이므로, 키워드 스코어가 조금이라도 있으면(>0이 아니라도
  // 동점 후보 중) 가장 그럴듯한 응용분야를 텍스트에서 한 번 더 얕게 판별한다.
  if (score <= 0 && fallback) {
    if (/규제|무역/.test(fallback)) return 'regulation';
    if (/원료/.test(fallback)) return 'upstream';
    if (/기업/.test(fallback)) return 'signals';
    if (/응용/.test(fallback)) {
      if (/(electronic|semiconductor|connector|pcb|전자|반도체|커넥터)/i.test(lower)) return 'electronics-emobility';
      if (/(automotive|vehicle|ev|경량화|자동차|전기차|autonomous|자율주행)/i.test(lower)) return 'auto-mobility';
      return 'market-supply'; // 의료/포장/건설 등 세부 카테고리 없는 응용분야의 중립적 기본값
    }
  }
  return best.id;
}
function scoreArticle(text: string, category: string) {
  // [v1.7] 매크로 레인 기사는 EP 재료명이 없는 게 정상(그래서 CORE 게이트를
  // 우회하도록 설계했음)인데, 스코어링은 여전히 EP 전용 로직을 타서 "Impact 0"
  // 으로 나오고 있었음(스크린샷에서 확인: H2 OUTLOOK 기사 Impact 0).
  // 매크로 관련성 자체를 반영하는 별도 스코어링으로 분리.
  if (category === 'macro-trade') {
    const lower = text.toLowerCase();
    let score = 40; // 매크로 게이트 통과 자체가 기본 관련성을 의미하므로 EP뉴스 하한선 근처로 시작
    if (/tariff|anti-dumping|antidumping|cbam|carbon border|wto dispute|관세|반덤핑|탄소국경/i.test(lower)) score += 20;
    if (/petrochemical|chemical industry|석유화학/i.test(lower)) score += 15;
    if (/outlook|forecast|전망/i.test(lower)) score += 10;
    return Math.min(100, score);
  }
  const lower=text.toLowerCase(); let score=0; if (hasCoreSignal(text)) score+=35; if (EVENT_REGEX.test(text)) score+=30; if (/(lg chem|lotte|sk chemicals|kolon|basf|sabino|covestro|dupont|한국엔지니어링플라스틱)/i.test(text)) score+=15; if (category==='regulation') score+=10; if (category==='financial-risk') score+=14; if (category==='capacity'||category==='ma-strategy'||category==='distribution-channel') score+=8; if (FUTURE_GROWTH_TERMS.test(text)) score+=10; if (FINANCIAL_RISK_REGEX.test(text)) score+=16; if (/(price|가격|수급|shortage|tariff|관세)/i.test(lower)) score+=8; return Math.min(100, Math.max(0, score));
}
export const DEFAULT_LOOKBACK_DAYS = 90;
// [v1.3] 저장 시점(수집) 하한 — 사용자가 조절하는 '표시 기간'과는 다른 개념.
// 넉넉하게 잡아 데이터 손실을 막고, 실제 표시 범위는 읽기 시점에 필터링한다.
// [v2.9] 중국/대만계 EP 경쟁사(PRET, Nanjing Julong, Formosa/Nan Ya 등)는
// Google News 색인량이 적고 유효 산업 뉴스가 6~24개월 전 기사로 남아 있는 경우가 많다.
// 저장 하한을 2년으로 늘려 검색 모드(730d lookback)에서 회수 가능하게 한다.
// 기본 피드 표시 기간(DEFAULT_LOOKBACK_DAYS=90)은 그대로라 일반 화면 노이즈는 늘리지 않음.
const STORAGE_LOOKBACK_DAYS = 730;
export function isWithinDays(publishedAt: string, days: number): boolean { const dt=new Date(publishedAt).getTime(); return !isNaN(dt) && dt >= Date.now()-days*24*3600*1000; }
export function isWithin7Days(publishedAt: string): boolean { return isWithinDays(publishedAt, 7); }
function killed(title: string, link: string, summary='') {
  const d = domainOf(link);
  const text = `${title} ${summary} ${link}`;
  const lower = text.toLowerCase();
  if (/\bicis\b/i.test(text)) return true;
  return KILL_DOMAINS.some(k => d.includes(k))
    || TITLE_KILL_REGEX.test(title)
    || KILL_PATTERNS.some(r => r.test(text))
    || RESEARCH_COMPANIES.some(c => lower.includes(c))
    || IR_FLUFF_REGEX.test(title);
}
function pruneKilledRawArticles(articles: Article[]) {
  return articles.filter((a) => !killed(a.title || '', a.link || '', `${a.summary || ''} ${a.sourceName || ''} ${a.feedName || ''} ${a.source || ''}`));
}
// [v2.8] passesGates 로직 정리:
//  - hasCoreSignal: EP 재료명/기업명/미래성장 키워드 중 하나라도 있으면 true
//  - EVENT_REGEX: EP 산업 사건성 키워드
//  - AND 조건 + IR_FLUFF_FILTER로 사건성 없는 IR 홍보문만 걸러냄
//  - 핵심: "회사가 언급된 EP 산업 기사"는 회사와 사건 유무에 따라 유연하게 통과
//  - IR_FLUFF는 제목에 집중(본문에 marketing 표현이 많으면误殺가 많음)
function passesGates(text: string) {
  if (IR_FLUFF_REGEX.test(text)) return false;
  return hasCoreSignal(text) && EVENT_REGEX.test(text);
}

// [v1.0] n8n v5.5/v5.7 이식: 매크로/전방산업/통상규제 전용 게이트.
// EP 수지명을 요구하지 않음(전방산업 경기·관세·CBAM 기사는 특정 수지를 언급하지 않는
// 게 정상) — 대신 매크로 관련성 키워드로 판별. feeds.json에서 category:'macro'로
// 태그된 피드에서만 이 게이트를 사용하고, 일반 뉴스는 기존 passesGates() 그대로 적용.
const MACRO_TERMS = [
  'petrochemical','polymer industry','chemical industry','downstream demand',
  'feedstock','naphtha','crude oil price','brent crude','wti crude','automotive production','ev demand',
  'electronics demand','construction outlook','manufacturing pmi','purchasing managers index','factory activity',
  'gdp growth','economic growth','gross domestic product','industrial production','factory output','manufacturing output',
  'cpi','inflation','consumer prices','central bank','interest rate','treasury yield','federal reserve','fomc',
  'exchange rate','yuan','won','dollar index','overcapacity','capacity utilization','reshoring','decoupling','supply chain resilience',
  'chemical cycle','petrochemical margin','cracker',
  '석유화학','전방산업','경기전망','경기 전망','제조업 경기','제조업 PMI','구매관리자지수','자동차 생산','전기차 수요',
  '건설경기','건설 경기','수출 증가율','수출 동향','경상수지','가동률','공급과잉','산업기상도','산업 전망','경제성장률','국내총생산','산업생산','소비자물가','물가','인플레이션','환율','원화','위안화','국채금리','연준',
  'tariff','anti-dumping','antidumping','countervailing duty','trade war',
  'export control','sanctions','cbam','carbon border','carbon tax','wto dispute',
  'trade remedy','import duty','trade barrier',
  '관세','반덤핑','상계관세','통상마찰','무역장벽','탄소국경','수출통제','제재','수입규제',
];
const MACRO_STOCK_NOISE = /((shares?|stocks?|화학주|관련주)\s*(들)?\s*(이|가|은|는)?\s*(surge|soar|jump|rall|plunge|slump|급등|급락|치솟)|surge.{0,15}%|급등.{0,10}%|stock price|주가|목표가|투자의견)/i;
function passesMacroGate(text: string) {
  if (MACRO_STOCK_NOISE.test(text)) return false;
  const lower = text.toLowerCase();
  return MACRO_TERMS.some(t => lower.includes(t));
}
function normalizeArticle(a: Article, days: number = DEFAULT_LOOKBACK_DAYS): Article | null {
  const title = sanitizeText(a.title || ''); const summary = sanitizeText(a.summary || a.contentSnippet || '');
  const link = (a.link || '').trim(); const publishedAt = a.publishedAt || a.collectedAt || new Date().toISOString();
  const text = `${title} ${summary} ${a.feedName} ${a.source}`;
  // [v1.0] 매크로 레인 피드는 EP CORE 게이트 대신 매크로 관련성 게이트를 사용.
  const isMacro = getFeeds().find(f => f.id === a.feedId)?.category === 'macro' || title.startsWith('[매크로]');
  if (!isWithinDays(publishedAt, days)) return null;
  // [v2.2] 표시 시점 재검증(normalizeArticle)에서 매크로 레인이 killed()를
  // 아예 건너뛰고 있었음 — 수집 시점(fetchOne)엔 공통 적용되지만, 이미 저장된
  // 매크로 기사를 다시 표시할 땐 검증이 안 돼 새 킬패턴이 소급 적용되지 않는
  // 문제였음("Untitled" 플레이스홀더 기사가 계속 남아있던 진짜 원인).
  if (isMacro) {
    if (killed(title, link, summary) || MACRO_STOCK_NOISE.test(text) || !passesMacroGate(text)) return null;
  } else {
    if (killed(title, link, summary) || !passesGates(text)) return null;
  }
  const displayTitle = isMacro && !title.startsWith('[매크로]') ? `[매크로] ${title}` : title;
  const category = isMacro ? 'macro-trade' : classifyArticle(text, a.category);
  const collectedScore = Number.isFinite(a.score) ? a.score : 0;
  const calculatedScore = scoreArticle(text, category);
  const score = Math.max(collectedScore, calculatedScore);
  return { ...a, title: displayTitle, summary: summary.slice(0,800), contentSnippet: summary.slice(0,300), publishedAt: new Date(publishedAt).toISOString(), category, score, tags: a.tags?.length ? a.tags : extractTags(text), sourceName: displaySourceName(a.feedName, link, a.source, title), language: detectLanguage(`${title} ${summary}`), summaryStatus: a.summaryKo || summary ? 'summary' : 'fallback' };
}
function detectLanguage(text: string) { if (/[가-힣]/.test(text)) return 'ko'; if (/[ぁ-ゟ゠-ヿ]/.test(text)) return 'ja'; if (/[\u4e00-\u9fff]/.test(text)) return 'zh'; if (/[äöüß]/i.test(text)) return 'de'; return 'en'; }
function titleTokens(title: string) {
  const stop = new Set(['요청','고발','중기부','검찰고발','거래','지위','남용','경쟁사','경쟁','업체','차단','막아','우월적','뉴스','단독','투자','발표','확대','재개','결정','계약','진행','수주','매출','실적','기업','산업','시장','업계','성장','계획','전략','announced','expansion','investment','launch','development','plan']);
  return new Set((normalizeTitle(title).match(/[가-힣A-Za-z0-9]+/g) || []).filter(w => w.length > 1 && !stop.has(w)));
}
// [v5.33] 검색 모드는 recall 확보를 위해 raw 기사 기반으로 조회하지만,
// GlobeNewswire/Yahoo Finance/BusinessWire 재배포처럼 제목 본문이 완전히 같은 wire copy까지
// 중복 노출되면 사용성이 떨어진다. 출처 suffix와 market-report 상투어 차이는 제거하되,
// 회사명/숫자/소재명은 보존한 canonical key를 3단계 dedup 안전망에서 공유한다.
// Stage 1: 수집 저장 전 rawDedupKeyFor(), Stage 2: 기본 피드 similarTitle(), Stage 3: 검색 dedupeSearchWireCopies().
function wireCopyKey(title: string) {
  return sanitizeText(title).toLowerCase()
    .replace(/\s+[-–—|]\s+(globenewswire|yahoo finance( singapore| korea)?|business wire|pr newswire|accesswire|newsfile|benzinga|[^-–—|]{2,40})\s*$/i, ' ')
    .replace(/["'“”‘’\[\](),.?!:;·]/g, ' ')
    .replace(/\b(globenewswire|yahoo finance( singapore| korea)?|business wire|pr newswire|accesswire|newsfile|benzinga)\b/g, ' ')
    .replace(/\b(to reach|reaches|reach|by|worth|valued at|market|services?|industry|global|report)\b/g, ' ')
    .replace(/\b(usd|us\$|\$)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dedupeSearchWireCopies(articles: Article[]) {
  const byKey = new Map<string, Article>();
  for (const a of articles) {
    const key = wireCopyKey(a.title);
    if (!key || key.length < 24) { byKey.set(`${a.id}:${key}`, a); continue; }
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, a); continue; }
    const better = ((a.score || 0) > (existing.score || 0)) ||
      ((a.score || 0) === (existing.score || 0) && (a.summary || '').length > (existing.summary || '').length);
    if (better) byKey.set(key, { ...a, duplicateCount: (existing.duplicateCount || 1) + 1, duplicateSources: Array.from(new Set([...(existing.duplicateSources || [existing.sourceName || existing.feedName]), a.sourceName || a.feedName])) });
    else byKey.set(key, { ...existing, duplicateCount: (existing.duplicateCount || 1) + 1, duplicateSources: Array.from(new Set([...(existing.duplicateSources || [existing.sourceName || existing.feedName]), a.sourceName || a.feedName])) });
  }
  return Array.from(byKey.values());
}
// [v0.3] 기존 코드는 두 제목이 모두 '엔지니어링플라스틱'을 포함하면 무조건 같은
// 기사로 간주했음(하드코딩). 이 단어는 우리 산업 전반의 핵심 용어라 서로 다른
// 사건(예: A사 증설 vs B사 신제품)까지 전부 하나로 합쳐버리는 위험한 규칙이었음.
// → 제거하고, "같은 사건유형 + 같은 핵심회사" 조건일 때만 관대한 토큰겹침 기준을
// 적용하도록 대체. 회사가 다르면(둘 다 회사명이 있는데 서로 다르면) 절대 병합 안 함.
const EVENT_CLASS_PATTERNS: Array<[string, RegExp]> = [
  ['financial-risk', FINANCIAL_RISK_REGEX],
  ['deal', /(licens|partnership|파트너십|제휴|alliance|deal|agreement|계약|jv|joint venture|합작)/i],
  ['acquisition', /(acqui|인수|매입|takeover|합병|merger)/i],
  ['price', /(price|가격|인상|인하|hike)/i],
  // [v1.4] 'invest'가 'investigate/investigation' 안에 부분 문자열로 우연히
  // 포함되어, SABIC 조사 기사들이 'capacity'(투자/증설)로 오분류되고 있었음
  // (실제 발생 확인: eventClass가 둘 다 'capacity'로 나와 우연히 합쳐지고,
  // 'inquiry'를 쓴 세 번째 기사만 정확한 'regulatory'로 분류돼 따로 남음).
  // 단어 경계로 investigate/investigation과 확실히 구분.
  ['capacity', /(expand|증설|capacity|plant|공장|가동|commission|facility|투자|\binvest(ment|ing|ed|s)?\b)/i],
  // [v0.3] 규제/제재/고발 사건 클래스 추가. 한국어는 조사가 붙어("거래상","남용한")
  // 정지어 목록의 정확 매칭을 피해가므로 토큰겹침 경로가 실패하기 쉬움 — 이 클래스가
  // 그 경우의 안전망 역할을 함(같은 회사 + 규제성 사건이면 표현이 달라도 병합).
  // [v1.4] 'inquiry'/'probe' 동의어 누락으로 SABIC PFAS 조사 중복이 안 합쳐지던 문제
  // (한쪽 매체는 'investigation', 다른 쪽은 'criminal inquiry'로 표현 — 실제 스크린샷에서 확인)
  ['regulatory', /(고발|기소|제재|조사|위반|남용|antidumping|tariff|lawsuit|fine|investigat|inquiry|probe|indict)/i],
  // [v1.0] n8n v5.11 이식: '제품출시/공급개시' 클래스가 아예 없어서 에스폴리텍
  // AI데이터센터 기사·Syensqo 제품출시 기사가 안전망에 걸릴 자격 자체가 없었음
  // (n8n 7/9 발행분에서 같은 사건이 3~4번 반복 노출되는 것으로 실제 확인된 버그).
  ['launch', /(launch|unveil|introduc|debut|confirm(ed|s)?\s+(the\s+)?mass production|commenc(e|ed|es)\s+(the\s+)?supply|출시|선보|공개|공급을?\s*(확정|개시|시작|본격화))/i],
];
// [v2.3] "파트너십을 통한 설비 구축"처럼 한 기사가 여러 성격(deal+capacity 등)을
// 동시에 갖는 경우, 기존 eventClass()는 배열의 첫 매치만 반환해 두 기사가 서로
// 다른 단일 클래스로 갈려 병합에 실패했음(Deepak Chem Tech HyCO 공장 건 실제 확인:
// 한쪽은 "plant" 때문에 capacity로, 다른 쪽은 "agreement" 때문에 deal로 분류).
// 매치되는 모든 클래스를 모아두고, 교집합 여부로 판정하도록 변경.
function eventClasses(t: string): string[] {
  return EVENT_CLASS_PATTERNS.filter(([, rx]) => rx.test(t)).map(([name]) => name);
}
// [v2.4] 구조적 버그 수정: coreCompaniesIn()이 "매치된 원본 키워드 문자열"을
// 그대로 반환했음 — 같은 회사를 서로 다른 별칭으로 쓴 두 기사(예: "LG Chem" vs
// "LG화학", "Deepak Chem Tech" vs 모회사명 "Deepak Nitrite Subsidiary")는
// 매치되는 문자열 자체가 달라서 similarTitle의 교집합 판정이 항상 실패했음
// (Deepak Chem Tech HyCO 공장 건에서 실제 확인 — 회사명을 추가해도 병합 안 됨).
// 별칭을 그룹으로 묶어 대표명(canonical name)으로 정규화하도록 재구성.
const COMPANY_ALIAS_GROUPS: Record<string, string[]> = {
  'covestro': ['covestro', '코베스트로'],
  'leuna': ['leuna'],
  'syensqo': ['syensqo'],
  'bucci': ['bucci'],
  'sabic': ['sabic'],
  'basf': ['basf'],
  'celanese': ['celanese'],
  'envalior': ['envalior'],
  'victrex': ['victrex'],
  'ems-chemie': ['ems-chemie', 'ems-grivory'],
  'omya': ['omya'],
  'lg chem': ['lg chem', 'lg화학'],
  'lotte': ['lotte', '롯데'],
  'kolon': ['kolon', '코오롱'],
  'arkema': ['arkema'],
  'wanhua': ['wanhua'],
  'kingfa': ['kingfa'],
  'trinseo': ['trinseo'],
  'toray': ['toray'],
  'teijin': ['teijin'],
  'vencorex': ['vencorex'],
  '한국엔지니어링플라스틱': ['한국엔지니어링플라스틱'],
  'solvay': ['solvay'],
  'evonik': ['evonik'],
  'lanxess': ['lanxess'],
  'espolytech': ['espolytech', '에스폴리텍'],
  'amkor': ['amkor', '앰코'],
  // [v2.3] Deepak Chem Tech HyCO 공장 계약 건 — 자회사/모회사 표기가 갈리는
  // 실제 사례(발표→체결 단계별로 다른 매체가 각각 다른 이름을 씀).
  'deepak chem tech': ['deepak chem tech', 'deepak chem', 'deepak nitrite'],
};
function coreCompaniesIn(t: string): string[] {
  const s = t.toLowerCase();
  const found: string[] = [];
  for (const [canonical, aliases] of Object.entries(COMPANY_ALIAS_GROUPS)) {
    if (aliases.some(alias => s.includes(alias))) found.push(canonical);
  }
  return found;
}

function similarTitle(a: string, b: string) {
  // [v5.36] 기본 피드 병합에도 wire-copy canonical key를 적용한다.
  // v5.33은 검색 모드 dedup만 고쳤기 때문에, 기본 EP 피드에서는
  // GlobeNewswire/Yahoo Finance Singapore/Yahoo Finance UK 같은 재배포본이
  // 3개 카드로 남을 수 있었다. 제목 내부 하이픈(Implant-Grade)은 보존하고
  // 끝의 source suffix만 제거한 key가 같으면 같은 wire copy로 병합한다.
  const wa = wireCopyKey(a), wb = wireCopyKey(b);
  if (wa && wb && wa.length >= 24 && wa === wb) return true;
  const A = titleTokens(a), B = titleTokens(b);
  const inter = [...A].filter(x => B.has(x)).length;
  const minSize = Math.min(A.size, B.size) || 1;
  if (inter >= 4 && inter / minSize >= 0.6) return true;
  // 완화 기준: 같은 사건유형이면서 언급된 핵심회사가 겹칠 때만 (표현이 크게 달라도 포착)
  // [v2.3] 단일 클래스 일치(===) 대신 교집합으로 판정 — "파트너십으로 설비 구축"처럼
  // 한 기사가 여러 성격을 동시에 가질 때, 다른 기사가 그중 하나만 매치해도 인정.
  const easSet = new Set(eventClasses(a)), ebs = eventClasses(b);
  const shared = ebs.filter(c => easSet.has(c));
  if (!shared.length) return false;
  const ca = coreCompaniesIn(a), cb = coreCompaniesIn(b);
  if (ca.length && cb.length && ca.some(c => cb.includes(c))) return true;
  // [v1.0] n8n v5.4 이식: 파산 사건에서 법인명 표기가 갈리는 경우
  // ("Chemie: Polyamid GmbH" ↔ "LEUNA-Polyamid") 대응. 파산은 희귀한 사건이라
  // 같은 산업재료어(폴리아미드)를 공유하면 회사명이 달라도 동일 사건으로 간주해도
  // 안전함(insolvency 클래스에서만 적용되므로 일반 뉴스 오병합 위험 없음).
  if (shared.includes('financial-risk')) {
    const materialShare = /polyamid|폴리아미드/i.test(a) && /polyamid|폴리아미드/i.test(b);
    if (materialShare) return true;
  }
  // regulatory 사건에서만 "한국엔지니어링플라스틱" ↔ "엔지니어링플라스틱"(회사명 축약)을
  // 동일 주체로 취급. 사건유형 게이트가 이미 걸려 있어 원래의 하드코딩 버그처럼
  // 무관한 EP 기사까지 병합될 위험은 없음(고발/제재성 기사끼리만 비교됨).
  if (shared.includes('regulatory')) {
    const norm = (t: string) => t.toLowerCase().includes('엔지니어링플라스틱');
    if (norm(a) && norm(b)) return true;
  }
  return false;
}
// [v1.0] n8n v5.11 이식: 매크로 레인의 반복 서베이(산업기상도류) 대응.
// "반도체 '맑음'/석유화학 '비'" 같은 날씨 비유 vs "긍정적/부진" 평문 서술처럼
// 표현이 완전히 달라도 핵심 주제어 3개 이상을 공유하면 동일 사건으로 간주.
const MACRO_TOPIC_TOKENS = ['반도체','석유화학','하반기','디스플레이','자동차','기계','산업전망','산업기상도'];
function macroTopicSimilar(a: string, b: string) {
  if (!a.includes('[매크로]') || !b.includes('[매크로]')) return false;
  const ta = MACRO_TOPIC_TOKENS.filter(t => a.includes(t));
  const tb = MACRO_TOPIC_TOKENS.filter(t => b.includes(t));
  return ta.filter(t => tb.includes(t)).length >= 3;
}

let processedCache: { days: number; mtimeMs: number; articles: Article[] } | null = null;
function articlesStoreMtimeMs() {
  try { return fs.statSync(ARTICLES_PATH).mtimeMs; } catch { return 0; }
}
export function clearNewsStoreCache() { processedCache = null; }
export function processedArticles(days: number = DEFAULT_LOOKBACK_DAYS): Article[] {
  const mtimeMs = articlesStoreMtimeMs();
  if (processedCache && processedCache.days === days && processedCache.mtimeMs === mtimeMs) return processedCache.articles;
  const groups: Article[][] = [];
  // [v5.41] Cold-start performance: the old grouping path used groups.find(...)
  // for every article, which became O(n²) once raw storage grew past 1.5k rows.
  // Maintain lightweight indexes and compare only plausible candidate groups.
  const wireIndex = new Map<string, Set<Article[]>>();
  const macroIndex = new Map<string, Set<Article[]>>();
  const eventCompanyIndex = new Map<string, Set<Article[]>>();
  const tokenIndex = new Map<string, Set<Article[]>>();
  const add = (map: Map<string, Set<Article[]>>, key: string, group: Article[]) => {
    if (!key) return;
    const set = map.get(key) || new Set<Article[]>();
    set.add(group); map.set(key, set);
  };
  const macroKey = (title: string) => {
    if (!title.includes('[매크로]')) return '';
    const hits = MACRO_TOPIC_TOKENS.filter(t => title.includes(t)).sort();
    return hits.length >= 3 ? hits.join('|') : '';
  };
  const eventCompanyKeys = (title: string) => {
    const ev = eventClasses(title);
    const co = coreCompaniesIn(title);
    const keys: string[] = [];
    for (const e of ev) for (const c of co) keys.push(`${e}:${c}`);
    return keys;
  };
  const usefulBucketTokens = (title: string) => Array.from(titleTokens(title))
    .filter(t => t.length >= 5 && !/^(plastics?|plastic|polymer|resin|chemical|materials?|market|industry|global|distribution|distributor|company|group|news|price|supply|demand)$/i.test(t))
    .slice(0, 5);
  const registerGroup = (group: Article[], article: Article) => {
    const w = wireCopyKey(article.title); if (w && w.length >= 24) add(wireIndex, w, group);
    add(macroIndex, macroKey(article.title), group);
    for (const key of eventCompanyKeys(article.title)) add(eventCompanyIndex, key, group);
    for (const t of usefulBucketTokens(article.title)) add(tokenIndex, t, group);
  };
  for (const raw of readRawArticles()) {
    const n = normalizeArticle(raw, days); if (!n) continue;
    const candidates = new Set<Article[]>();
    const w = wireCopyKey(n.title); if (w && w.length >= 24) wireIndex.get(w)?.forEach(g => candidates.add(g));
    const mk = macroKey(n.title); if (mk) macroIndex.get(mk)?.forEach(g => candidates.add(g));
    for (const key of eventCompanyKeys(n.title)) eventCompanyIndex.get(key)?.forEach(g => candidates.add(g));
    for (const t of usefulBucketTokens(n.title)) tokenIndex.get(t)?.forEach(g => candidates.add(g));
    const group = Array.from(candidates).find(g => similarTitle(g[0].title, n.title) || macroTopicSimilar(g[0].title, n.title));
    if (group) { group.push(n); registerGroup(group, n); }
    else { const ng = [n]; groups.push(ng); registerGroup(ng, n); }
  }
  const merged: Article[] = [];
  // [v2.7] 병합 그룹의 "대표 기사"를 순수 스코어로만 뽑다 보니, 같은 사건이라도
  // 국가명 등 구체 정보가 있는 버전보다 "Strategic Acquisitions"류 밋밋한
  // 상투어만 있는 버전이 대표로 뽑히는 경우 발견(실사용 확인: Covestro의
  // Vencorex 태국 인수 건 — "Covestro acquires Vencorex sites in Thailand, US"가
  // 있는데도 "Covestro Expands Global Production with Strategic Acquisitions"가
  // 대표로 뽑혀 화면에서 국가명이 통째로 사라짐). 구체성 보너스를 정렬 기준에 추가.
  const COUNTRY_HINTS = /\b(thailand|vietnam|malaysia|singapore|indonesia|china|korea|japan|germany|france|italy|india|brazil|mexico|europe|usa?|u\.s\.?)\b/i;
  const VAGUE_MARKERS = /\b(strategic acquisitions?|global production|growth opportunities|market position|capabilities|its portfolio)\b/i;
  function specificityBonus(title: string): number {
    let bonus = 0;
    if (COUNTRY_HINTS.test(title)) bonus += 12;
    if (/\d/.test(title)) bonus += 4; // 구체적 수치(생산량, 금액 등) 포함
    if (VAGUE_MARKERS.test(title) && !COUNTRY_HINTS.test(title)) bonus -= 10; // 밋밋한 상투어만 있고 구체정보 없으면 페널티
    return bonus;
  }
  function sourcePriority(item: Article): number {
    const source = `${item.sourceName || ''} ${item.feedName || ''} ${item.link || ''}`.toLowerCase();
    if (/globenewswire|businesswire|business wire|prnewswire|pr newswire|accesswire|newsfile/.test(source)) return 18;
    if (/yahoo finance|benzinga|marketwatch/.test(source)) return -8;
    return 0;
  }
  for (const items of groups) {
    items.sort((a,b)=> ((b.score + specificityBonus(b.title) + sourcePriority(b)) - (a.score + specificityBonus(a.title) + sourcePriority(a))) || ((b.summary||'').length-(a.summary||'').length));
    const primary = { ...items[0] };
    primary.duplicateCount = items.length;
    primary.duplicateSources = Array.from(new Set(items.map(i=>i.sourceName || displaySourceName(i.feedName, i.link, i.source, i.title))));
    // [v1.3 버그수정] 아래에서 id를 재해싱하면 원본 raw 배열의 id와 달라져서
    // enrichWithTranslations의 캐시 조회가 항상 실패하고 있었음(매 요청마다
    // 무료 번역 API를 재호출) — 재해싱 전 원본 id를 rawId로 보존.
    primary.rawId = items[0].id;
    primary.id = crypto.createHash('sha256').update(signature(primary.title, primary.publishedAt)||primary.id).digest('hex').slice(0,20);
    merged.push(primary);
  }
  const sorted = merged.sort((a,b)=>+new Date(b.publishedAt)-+new Date(a.publishedAt));
  processedCache = { days, mtimeMs, articles: sorted };
  return sorted;
}
export function readArticles(): Article[] { return processedArticles(); }

export async function collectFeeds(options?: { maxFeeds?: number; category?: string; balanced?: boolean; perCategory?: number; concurrency?: number }) {
  const allEnabledFeeds = getFeeds().filter((f: FeedSource) => f.enabled && (!options?.category || f.category === options.category));
  const enabledFeeds = options?.maxFeeds ? allEnabledFeeds.slice(0, options.maxFeeds) : allEnabledFeeds;
  const existing = readRawArticles(); const byId = new Map(existing.map((a: Article)=>[a.id,a])); const rawDedupIndex = buildRawDedupIndex(existing);
  const errors: Array<{feed:string; message:string}> = []; let fetchedItems=0, inserted=0, duplicateFiltered=0, oldFiltered=0, killedFiltered=0, gateFiltered=0;
  type FilterSample = { feedId: string; feedName: string; category: string; reason: string; title: string; link: string; summary: string; publishedAt: string; hasCore?: boolean; hasEvent?: boolean; isMacro?: boolean };
  const diagnostics: { oldFilteredSamples: FilterSample[]; killedSamples: FilterSample[]; duplicateFilteredSamples: FilterSample[]; gateFilteredSamples: FilterSample[] } = { oldFilteredSamples: [], killedSamples: [], duplicateFilteredSamples: [], gateFilteredSamples: [] };
  function pushSample(bucket: FilterSample[], sample: FilterSample) { if (bucket.length < 160) bucket.push(sample); }
  const startedAt = Date.now();

  // [v0.4] 103개 피드를 순차 처리하면 최악의 경우 20분 가까이 걸리고, 중간에
  // 타임아웃/중단되면 이미 가져온 결과까지 전부 유실됨(끝나야만 1번 저장하던 구조).
  // → 동시성 제한 병렬 처리 + 배치마다 즉시 저장으로 변경. 어느 시점에 끊겨도
  // 그때까지 수집된 결과는 이미 디스크에 남아 있음.
  const CONCURRENCY = options?.concurrency ?? 8;
  async function fetchOne(feed: FeedSource) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const isMacro = feed.category === 'macro';
      for (const item of parsed.items.slice(0, 20)) {
        const title=sanitizeText(item.title||'제목 없음'); const link=(item.link||item.guid||'').trim(); const summary=sanitizeText(item.contentSnippet||item.summary||item.content||''); const publishedAt=item.isoDate||item.pubDate||new Date().toISOString(); const id=articleId(link,title); fetchedItems++;
        if (byId.has(id)) continue; if (!isWithinDays(publishedAt, STORAGE_LOOKBACK_DAYS)) { oldFiltered++; pushSample(diagnostics.oldFilteredSamples, { feedId: feed.id, feedName: feed.name, category: String(feed.category), reason: 'older_than_storage_lookback', title, link, summary: summary.slice(0, 260), publishedAt, isMacro }); continue; }
        const rawDedupKey = rawDedupKeyFor(title, link);
        if (rawDedupKey && rawDedupIndex.has(rawDedupKey)) { duplicateFiltered++; pushSample(diagnostics.duplicateFilteredSamples, { feedId: feed.id, feedName: feed.name, category: String(feed.category), reason: rawDedupKey.startsWith('wire:') ? 'duplicate_wire_copy_stage1' : 'duplicate_url_stage1', title, link, summary: summary.slice(0, 260), publishedAt, isMacro }); continue; }
        const text=`${title} ${summary} ${feed.name}`;
        const hasCore = hasCoreSignal(text);
        const hasEvent = EVENT_REGEX.test(text);
        // [v1.0] 매크로 레인: EP CORE 게이트 대신 매크로 관련성 게이트 사용, 도메인/스팸
        // 킬은 공통 적용(리서치 스팸은 매크로 레인에도 흘러들 수 있으므로).
        if (killed(title,link,summary)) { killedFiltered++; pushSample(diagnostics.killedSamples, { feedId: feed.id, feedName: feed.name, category: String(feed.category), reason: 'killed_pattern_or_domain', title, link, summary: summary.slice(0, 260), publishedAt, hasCore, hasEvent, isMacro }); continue; }
        if (isMacro) { if (!passesMacroGate(text)) { gateFiltered++; pushSample(diagnostics.gateFilteredSamples, { feedId: feed.id, feedName: feed.name, category: String(feed.category), reason: 'macro_gate_failed', title, link, summary: summary.slice(0, 260), publishedAt, hasCore, hasEvent, isMacro }); continue; } }
        else if (!passesGates(text)) { gateFiltered++; pushSample(diagnostics.gateFilteredSamples, { feedId: feed.id, feedName: feed.name, category: String(feed.category), reason: !hasCore ? 'missing_core_signal' : !hasEvent ? 'missing_event_signal' : 'gate_failed_other', title, link, summary: summary.slice(0, 260), publishedAt, hasCore, hasEvent, isMacro }); continue; }
        const displayTitle = isMacro ? `[매크로] ${title}` : title;
        const category = isMacro ? 'macro-trade' : classifyArticle(text, feed.category);
        const article: Article = { id, feedId: feed.id, feedName: feed.name, category, title: displayTitle, link, summary: summary.slice(0,800), contentSnippet: summary.slice(0,300), publishedAt: new Date(publishedAt).toISOString(), collectedAt: new Date().toISOString(), source: parsed.title || feed.name, sourceName: displaySourceName(feed.name, link, parsed.title, title), language: detectLanguage(`${title} ${summary}`), summaryStatus: summary ? 'summary' : 'fallback', score: scoreArticle(text, category), tags: extractTags(text) };
        byId.set(id, article); if (rawDedupKey) rawDedupIndex.add(rawDedupKey); const normalizedUrlKey = normalizedSourceUrl(link); if (normalizedUrlKey) rawDedupIndex.add(`url:${normalizedUrlKey}`); inserted++;
      }
    } catch (error) {
      errors.push({ feed: feed.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (let i = 0; i < enabledFeeds.length; i += CONCURRENCY) {
    const batch = enabledFeeds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(fetchOne));
    writeArticles(pruneKilledRawArticles(Array.from(byId.values())).slice(0, 5000)); // 배치마다 즉시 반영
  }

  const durationMs = Date.now() - startedAt;
  const diagnosticsPayload = {
    collectedAt: new Date().toISOString(),
    feedsTried: enabledFeeds.length,
    fetchedItems,
    inserted,
    duplicateFiltered,
    oldFiltered,
    killedFiltered,
    gateFiltered,
    errors: errors.slice(0, 20),
    ...diagnostics,
  };
  try { fs.writeFileSync(FILTER_DIAGNOSTICS_PATH, JSON.stringify(diagnosticsPayload, null, 2), 'utf8'); } catch { /* diagnostics should never block collection */ }
  return { feedsTried: enabledFeeds.length, fetchedItems, inserted, totalArticles: byId.size, filteredArticles: processedArticles().length, duplicateFiltered, oldFiltered, killedFiltered, gateFiltered, errors, durationMs, concurrency: CONCURRENCY, diagnosticsPath: FILTER_DIAGNOSTICS_PATH };
}
export function queryArticles(filters: ArticleFilters = {}) {
  const q = filters.query?.trim().toLowerCase();
  // Search mode should favor recall over dedup compactness. The normal feed uses
  // processedArticles() to merge similar wire copies, but company/material search
  // (BASF, Covestro, PA66...) must be able to surface all relevant good items,
  // including articles that would otherwise be hidden behind a merged primary.
  let articles = q
    ? readRawArticles().map((a) => normalizeArticle(a, filters.days ?? DEFAULT_LOOKBACK_DAYS)).filter((a): a is Article => Boolean(a))
    : processedArticles(filters.days ?? DEFAULT_LOOKBACK_DAYS);
  if (filters.category && filters.category !== '전체') articles = articles.filter((a) => a.category === filters.category);
  if (filters.tag) articles = articles.filter((a) => a.tags.includes(filters.tag!));
  if (q) {
    articles = articles.filter((a) => `${a.title} ${a.titleKo || ''} ${a.summary} ${a.summaryKo || ''} ${a.tags.join(' ')}`.toLowerCase().includes(q));
    articles = dedupeSearchWireCopies(articles);
    articles = articles.sort((a, b) => (b.score || 0) - (a.score || 0) || +new Date(b.publishedAt) - +new Date(a.publishedAt));
  }
  articles = articles.filter((a) => !killed(a.title || '', a.link || '', `${a.summary || ''} ${a.sourceName || ''} ${a.feedName || ''} ${a.source || ''}`));
  return articles.slice(0, filters.limit ?? 200);
}
export function getStats(days: number = DEFAULT_LOOKBACK_DAYS) { const raw=readRawArticles(); const articles=processedArticles(days); const feedsList=getFeeds(); const cats=['전체', ...CATEGORY_META.map(c=>c.id)]; const counts=cats.map(category=>({ category, label: category==='전체'?'전체':CATEGORY_META.find(c=>c.id===category)?.label || category, count: category==='전체'?articles.length:articles.filter(a=>a.category===category).length, feeds: category==='전체'?feedsList.length:feedsList.length })); const lastCollectedAt=raw.map(a=>a.collectedAt).sort().at(-1)||null; const topTags=Object.entries(articles.flatMap(a=>a.tags).reduce<Record<string,number>>((acc,tag)=>{acc[tag]=(acc[tag]||0)+1; return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([tag,count])=>({tag,count})); return { totalArticles: raw.length, filteredArticles: articles.length, totalFeeds: feedsList.length, counts, lastCollectedAt, topTags, categories: CATEGORY_META, lookbackDays: days }; }
