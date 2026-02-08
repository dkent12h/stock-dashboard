import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Wallet,
  Bell,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ArrowUpRight,
  ShieldCheck,
  Layers,
  Coins,
  Activity,
  ChevronRight,
  Clock,
  Globe,
  BellRing,
  LineChart as LineChartIcon,
  AreaChart,
  ExternalLink,
  Wifi,
  WifiOff,
  Database,
  LayoutDashboard,
  AlertCircle,
  BarChart3,
  Settings,
  MessageSquare,
  X,
  Save
} from 'lucide-react';

// --- 전역 설정 및 투자 데이터 ---
const FINNHUB_API_KEY = "d6431npr01ql6dj204agd6431npr01ql6dj204b0";
const INITIAL_LIQUIDITY = 360000000;
const INVEST_UNIT = 5000000;

// 3배 레버리지 헌법 적용: Banned 처리
const TARGET_CONFIG = {
  'CORE': { label: '우량/눌림', strategy: 'DIP', maxRsi: 70 },
  // 레버리지 종목별 진입 가이드 (전일 종가 기준 하락률)
  'LEVERAGE_RULES': {
    'NVDL': { tiers: [{ label: '1차', drop: 0.06 }, { label: '2차', drop: 0.13 }] },
    'TSLL': { tiers: [{ label: '1차', drop: 0.09 }, { label: '2차', drop: 0.16 }] },
    'SOXL': { tiers: [{ label: '1차', drop: 0.07 }, { label: '2차', drop: 0.14 }] },
    'TQQQ': { tiers: [{ label: '1차', drop: 0.05 }, { label: '2차', drop: 0.11 }] }
  }
};

const MARKET_INDICES = [
  { id: 'K200F', name: '코스피 200 선물', symbol: 'KRW=X', base: 365.5, color: 'text-rose-400', stroke: '#fb7185' }, // 대용: KRW=X (환율) 혹은 ^KS200 (지수). 선물 데이터 ES=F 처럼 매핑
  { id: 'NDX', name: '나스닥 100 선물', symbol: 'NQ=F', base: 18250.0, color: 'text-indigo-400', stroke: '#818cf8' },
  { id: 'SPXF', name: 'S&P 500 선물', symbol: 'ES=F', base: 5120.0, color: 'text-emerald-400', stroke: '#34d399' }
];

const SYMBOLS = {
  // 우량주: 삼성전자, SK하이닉스 (눌림목 매수)
  CORE: [
    { symbol: '005930.KS', name: '삼성전자', ma20: 71500, type: 'CORE', targetQty: 500 },
    { symbol: '000660.KS', name: 'SK하이닉스', ma20: 188500, type: 'CORE', targetQty: 50 },
    { symbol: 'NVDA', name: 'NVDA', ma20: 130.2, type: 'CORE' }, // NVDA도 CORE로 분류 가능하지만 성향상 레버리지와 비슷, 여기선 CORE 유지
    { symbol: 'ARM', name: 'ARM', ma20: 138.5, type: 'CORE' }
  ],
  // 레버리지 (SOXL, TQQQ는 3배이므로 경고 배지 부착 예정)
  LEVERAGE: [
    { symbol: 'SOXL', name: 'SOXL', type: 'LEVERAGE' },
    { symbol: 'TQQQ', name: 'TQQQ', type: 'LEVERAGE' },
    { symbol: 'NVDL', name: 'NVDL', type: 'LEVERAGE' }, // 2X
    { symbol: 'TSLL', name: 'TSLL', type: 'LEVERAGE' }  // 2X
  ]
};

// K방산 코드 수정: Tiger -> PLUS(ARIRANG)으로 변경하여 데이터 확보 우선
const SECTOR_LIST = [
  { symbol: '487240.KS', name: 'Kodex AI전력핵심설비', code: '487240' },
  { symbol: '305720.KS', name: 'Kodex 2차전지산업', code: '305720' },
  { symbol: '445290.KS', name: 'Kodex 로봇액티브', code: '445290' },
  { symbol: '466940.KS', name: 'Tiger 은행고배당플러스TOP10', code: '466940' },
  { symbol: '0115D0.KS', name: 'Kodex K조선TOP10', code: '0115D0' },
  { symbol: '463250.KS', name: 'Tiger K방산&우주', code: '463250' },
  { symbol: '364970.KS', name: 'Tiger 바이오TOP10', code: '364970' },
  { symbol: '0091P0.KS', name: 'Tiger 코리아원자력', code: '0091P0' }
];

// --- 초기값 ---
const INITIAL_STOCKS = [...SYMBOLS.CORE, ...SYMBOLS.LEVERAGE].map(s => ({
  ...s, price: 0, prevClose: 0, change: 0, isSimulated: true, rsi: 0
}));
const INITIAL_SECTORS = SECTOR_LIST.map(s => ({
  ...s, price: 0, change: 0, isSimulated: true
}));
const INITIAL_INDICES = MARKET_INDICES.map(idx => ({
  ...idx, current: idx.base, change: 0, history: [idx.base]
}));

// 단순 이동평균(SMA) 계산 함수 (클라이언트 측 계산용)
const calculateSimpleMA = (history, period = 20) => {
  if (!history || history.length < period) return 0;
  // history는 { time, price } 배열이라고 가정 (또는 단순 숫자 배열 호환)
  const prices = history.map(h => h.price || h);
  const slice = prices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
};

// CORS Proxy URL 생성 헬퍼 (Vercel 배포 시, vercel.json rewrites 사용)
const getYahooUrl = (path) => {
  return `/yahoo${path}`;
};

// --- 차트 컴포넌트 ---
function MiniChart({ data, stroke, width = 200, height = 80 }) { // 높이 확보 (60 -> 80)
  if (!data || data.length < 2) return <div className="h-[80px] bg-slate-900/20 animate-pulse rounded-lg" />;

  // 데이터 형식 확인 (객체 배열 vs 숫자 배열)
  const isObject = typeof data[0] === 'object';
  const prices = isObject ? data.map(d => d.price) : data.filter(v => typeof v === 'number');
  const times = isObject ? data.map(d => d.time) : [];

  if (prices.length < 2) return <div className="h-[80px] bg-slate-900/20 animate-pulse rounded-lg" />;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const chartHeight = height - 20; // 텍스트 영역 확보

  const points = prices.map((val, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = chartHeight - ((val - min) / range) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" points={points} />
      {/* X축 시간 라벨 (시작, 중간, 끝) */}
      {isObject && times.length > 0 && (
        <>
          {[0, Math.floor(times.length / 2), times.length - 1].map((idx, i) => {
            const date = new Date(times[idx] * 1000);
            const label = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            const x = (idx / (times.length - 1)) * width;
            const anchor = i === 0 ? 'start' : (i === 2 ? 'end' : 'middle');
            return (
              <text key={i} x={x} y={height - 2} textAnchor={anchor} fontSize="9" fill="#64748b" fontWeight="bold">
                {label}
              </text>
            );
          })}
        </>
      )}
    </svg>
  );
}

export default function App() {
  // 상태 관리
  const [stocks, setStocks] = useState(INITIAL_STOCKS);
  const [indices, setIndices] = useState(INITIAL_INDICES);
  const [sectors, setSectors] = useState(INITIAL_SECTORS);
  const [currentTab, setCurrentTab] = useState('LEVERAGE');
  const [alerts, setAlerts] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [notifPermission, setNotifPermission] = useState('default');
  const [marketStatus, setMarketStatus] = useState({ us: 'Closed', kr: 'Closed' });
  const [apiStatus, setApiStatus] = useState('connecting');

  // 텔레그램 설정 상태
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [telegramConfig, setTelegramConfig] = useState({
    botToken: localStorage.getItem('stock_dashboard_tg_token') || '',
    chatId: localStorage.getItem('stock_dashboard_tg_chatid') || ''
  });

  // 설정 저장
  const saveTelegramConfig = (token, chatId) => {
    setTelegramConfig({ botToken: token, chatId });
    localStorage.setItem('stock_dashboard_tg_token', token);
    localStorage.setItem('stock_dashboard_tg_chatid', chatId);
    setIsSettingsOpen(false);
    triggerAlert('System', '텔레그램 설정이 저장되었습니다.');
  };

  // 무한 업데이트 방지를 위한 Refs
  const stocksRef = useRef(INITIAL_STOCKS);
  const sectorsRef = useRef(INITIAL_SECTORS);
  const indicesRef = useRef(INITIAL_INDICES);
  const marketStatusRef = useRef({ us: 'Closed', kr: 'Closed' });
  const notifPermissionRef = useRef('default');

  // 상태 동기화 Refs
  useEffect(() => { stocksRef.current = stocks; }, [stocks]);
  useEffect(() => { sectorsRef.current = sectors; }, [sectors]);
  useEffect(() => { indicesRef.current = indices; }, [indices]);
  useEffect(() => { marketStatusRef.current = marketStatus; }, [marketStatus]);
  useEffect(() => { notifPermissionRef.current = notifPermission; }, [notifPermission]);

  // 알림 권한 초기 설정
  useEffect(() => {
    if ("Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestPermission = () => {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(setNotifPermission);
  };

  // 시장 상태 업데이트 (주말/공휴일 반영)
  const updateMarketStatus = useCallback(() => {
    const now = new Date();

    // 한국 시간 (KST)
    const krNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const krDay = krNow.getDay();
    const krHour = krNow.getHours();
    const krMin = krNow.getMinutes();
    const krTotalMin = krHour * 60 + krMin;

    // 미국 시간 (EST/EDT)
    const usNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const usDay = usNow.getDay();
    const usHour = usNow.getHours();
    const usMin = usNow.getMinutes();
    const usTotalMin = usHour * 60 + usMin;

    let krStatus = 'Closed';
    if (krDay >= 1 && krDay <= 5) {
      if (krTotalMin >= 480 && krTotalMin < 530) krStatus = 'NXT-Pre';
      else if (krTotalMin >= 540 && krTotalMin <= 930) krStatus = 'Regular';
      else if (krTotalMin > 930 && krTotalMin <= 1200) krStatus = 'NXT-After';
    }

    let usStatus = 'Closed';
    if (usDay >= 1 && usDay <= 5) {
      if (usTotalMin >= 240 && usTotalMin < 570) usStatus = 'Pre-market';
      else if (usTotalMin >= 570 && usTotalMin <= 960) usStatus = 'Open';
      else if (usTotalMin > 960 && usTotalMin <= 1200) usStatus = 'After-market';
    }

    setMarketStatus({ kr: krStatus, us: usStatus });
  }, []);

  // 알림 소리 재생 (Base64 인코딩된 짧은 비프음)의 오디오 컨텍스트
  const playAlertSound = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5); // A4로 떨어짐

      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio play failed", e);
    }
  }, []);

  // 텔레그램 메시지 전송
  const sendTelegramMessage = useCallback(async (msg) => {
    const { botToken, chatId } = telegramConfig;
    if (!botToken || !chatId) return;

    try {
      // 프록시 경로 사용 (/telegram -> https://api.telegram.org)
      await fetch(`/telegram/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: 'HTML' // HTML 모드 사용 가능
        }),
      });
    } catch (e) {
      console.error('Telegram send failed', e);
    }
  }, [telegramConfig]);

  // 알림 발생 (중복 방지)
  const triggerAlert = useCallback((symbol, msg) => {
    const id = `${symbol}-${msg.split(' ')[0]}-${Math.floor(Date.now() / 600000)}`;
    setAlerts(prev => {
      if (prev.some(a => a.id === id)) return prev;

      // 소리 재생
      playAlertSound();

      // 브라우저 알림
      if (notifPermissionRef.current === "granted") {
        new Notification(`[Alpha 3.6B] ${symbol}`, { body: msg });
      }

      // 텔레그램 전송
      sendTelegramMessage(`🚨 <b>[${symbol}]</b>\n${msg}`);

      return [{ id, symbol, msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 8);
    });
  }, [playAlertSound, sendTelegramMessage]);

  // 야후 파이낸스 가격 추출 (로컬 프록시 사용)
  const fetchYahooPrice = async (symbol) => {
    try {
      // getYahooUrl 헬퍼 사용하여 CORS 우회
      const url = getYahooUrl(`/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`);
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Yahoo Finance API failed for ${symbol}: ${response.status}`);
        return null;
      }

      const resData = await response.json();

      // 원본 응답 구조 사용 (더 이상 parsedData.contents 불필요)
      if (!resData?.chart?.result?.[0]) return null;

      const result = resData.chart.result[0];
      const meta = result.meta;
      const quotes = result.indicators?.quote?.[0];
      const closePrices = quotes?.close || [];

      // 1. Meta 데이터에서 가장 최신 가격(Post/Pre/Regular) 확인
      let currentPrice = meta.regularMarketPrice || 0;
      let marketState = 'Regular';

      // 더 확실한 방법: 타임스탬프 비교 및 장 상태에 따른 강제 선택
      const regularTime = meta.regularMarketTime || 0;
      const postTime = meta.postMarketTime || 0;
      const preTime = meta.preMarketTime || 0;

      // 현재 시간을 기준으로 장외인지 판단 (간단하게 post/pre 가격이 존재하면 그것을 선호)
      // 사용자의 요청: "이외 시간에는 장외기준가로 실시간 반영"
      // 따라서 PostMarketPrice가 있고 0이 아니면, Regular보다 우선순위를 높게 둠 (장 마감 후니까)

      if (meta.postMarketPrice && meta.postMarketPrice > 0) {
        currentPrice = meta.postMarketPrice;
        marketState = 'Post-Market';
      } else if (meta.preMarketPrice && meta.preMarketPrice > 0) { // 프리마켓 우선 (장 시작 전)
        // 단, Post가 없고 Pre만 있는 경우 혹은 Pre가 더 최신인 경우
        // Yahoo 데이터 특성상 Pre가 있으면 Pre를 보여주는게 맞음 (장전)
        currentPrice = meta.preMarketPrice;
        marketState = 'Pre-Market';
      } else {
        currentPrice = meta.regularMarketPrice;
        marketState = 'Regular';
      }

      // 백업: 차트 데이터 마지막 값
      if (!currentPrice || currentPrice === 0) {
        // 만약 위에서 가격을 못 찾았다면, 차트 배열의 마지막 값 사용 (백업)
        for (let i = closePrices.length - 1; i >= 0; i--) {
          if (typeof closePrices[i] === 'number' && closePrices[i] > 0) {
            currentPrice = closePrices[i];
            marketState = 'Chart-Last'; // 차트 배열에서 가져온 경우
            break;
          }
        }
      }

      const prevClose = meta.previousClose || currentPrice;


      // 3. 차트용 히스토리 데이터 추출 (시간 포함)
      const timestamps = resData.chart.result[0].timestamp || [];
      const history = [];

      // 가격 데이터와 타임스탬프를 매핑
      if (closePrices.length > 0 && timestamps.length > 0) {
        // 데이터 개수가 다를 수 있으므로 더 짧은 길이 기준
        const len = Math.min(closePrices.length, timestamps.length);
        for (let i = 0; i < len; i++) {
          if (typeof closePrices[i] === 'number' && closePrices[i] !== null) {
            history.push({ time: timestamps[i], price: closePrices[i] });
          }
        }
      } else {
        // 실패 시 숫자만이라도 넣음 (백업)
        closePrices.forEach(p => typeof p === 'number' && history.push({ time: Date.now() / 1000, price: p }));
      }

      return {
        price: currentPrice,
        regularClose: meta.regularMarketPrice,
        postPrice: meta.postMarketPrice,
        prePrice: meta.preMarketPrice,
        change: meta.regularMarketChangePercent || 0,
        postPrice: meta.postMarketPrice,
        prePrice: meta.preMarketPrice,
        prevClose: prevClose,
        change: prevClose !== 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0,
        isSimulated: false,
        marketState: marketState,
        history: history // 차트 데이터 반환
      };
    } catch (e) {
      return null;
    }
  };

  // 일봉 데이터 기반 지표 계산 (MA20, RSI)
  const fetchDailyStats = async (symbol) => {
    try {
      // 넉넉하게 2년치 일봉 데이터 요청 (RSI 정확도 극대화 및 정규장 데이터만 사용)
      const url = getYahooUrl(`/v8/finance/chart/${symbol}?interval=1d&range=2y&includePrePost=false`);
      const response = await fetch(url);
      const resData = await response.json();
      const result = resData?.chart?.result?.[0];
      const closePrices = result?.indicators?.quote?.[0]?.close || [];
      const adjClosePrices = result?.indicators?.adjclose?.[0]?.adjclose || [];

      // 수정 종가(Adj Close)가 있으면 우선 사용 (가장 정확함)
      const targetPrices = (adjClosePrices.length > 0 && adjClosePrices.some(p => p !== null)) ? adjClosePrices : closePrices;

      // 유효한 숫자 데이터만 필터링 (0 이하 제외)
      let validPrices = targetPrices.filter(p => typeof p === 'number' && p > 0);

      // [한국 주식 보정] 차트 데이터에 오늘 날짜가 아직 안 들어왔을 경우 (지연 시세 등)
      // 메타 데이터의 현재가를 강제로 추가하여 "실시간 MA20" 근사치 계산
      if (symbol.includes('.KS')) {
        const meta = result?.meta;
        const timestamps = result?.timestamp || [];
        const lastTime = timestamps[timestamps.length - 1];

        // 오늘 자정 (한국 시간 고려해야 하지만 대략적으로 UTC 기준 비교)
        // 86400초(1일) 이내 데이터가 없으면 오늘 데이터 누락으로 간주
        const now = Math.floor(Date.now() / 1000);
        if (meta?.regularMarketPrice > 0 && (!lastTime || (now - lastTime > 40000))) { // 장중인데 10시간 이상 차이나면
          validPrices = [...validPrices, meta.regularMarketPrice];
        }
      }



      // 데이터가 20개 미만이면 계산 불가
      if (validPrices.length < 20) return null;

      // 최근 20일치 평균 계산 (가장 최근 데이터 포함)
      const last20 = validPrices.slice(-20);
      const ma20 = last20.reduce((a, b) => a + b, 0) / 20;

      // RSI(14) 계산
      const rsi = calculateRSI(validPrices, 14);
      return { ma20, rsi: Math.round(rsi) };
    } catch (e) {
      console.error('MA20 Fetch Error:', symbol, e);
      return null;
    }
  };

  // 증권사 목표가(Target Price) 데이터 가져오기
  const fetchTargetPrice = async (symbol) => {
    try {
      // quoteSummary API 사용 (financialData 모듈)
      const url = getYahooUrl(`/v10/finance/quoteSummary/${symbol}?modules=financialData`);
      const response = await fetch(url);
      const data = await response.json();
      const finData = data?.quoteSummary?.result?.[0]?.financialData;

      if (finData && finData.targetMeanPrice?.raw) {
        return {
          high: finData.targetHighPrice?.raw,
          low: finData.targetLowPrice?.raw,
          mean: finData.targetMeanPrice?.raw,
          rec: finData.recommendationKey // 'buy', 'strong_buy', 'hold' 등
        };
      }
      return null;
    } catch (e) {
      // console.error('Target Price Fetch Error:', symbol, e); // 조용히 실패
      return null;
    }
  };

  // RSI(14) 계산 함수
  const calculateRSI = (prices, period = 14) => {
    if (prices.length < period + 1) return 50; // 데이터 부족 시 중립

    let gains = 0;
    let losses = 0;

    // 초기 평균
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // 2. 이후 데이터로 스무딩 (Wilder's Smoothing)
    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period; // (이전 평균 * 13 + 현재 상승분) / 14
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period; // diff는 음수이므로 -diff
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  // 매수 신호 체크 (Constitution V2.0)
  // [추세] 20일선 위 & 상향? (상향 각도는 MA20 최근 3일 추세로 약식 판단)
  // [힘] ALPHA: 전일 고가 돌파? / CORE: 20일선 터치?
  // [과열] RSI 70 이하?
  // [지뢰] 실적발표 3일 전? (API 한계로 생략 가능, 수동 확인 필요 메시지)
  const checkBuySignal = (stock, data, ma20) => {
    if (stock.banned || stock.type === 'WATCH') return; // 금지 품목 및 WATCH는 매수 신호 없음

    const currentPrice = data.price;
    const rsi = data.rsi || 50; // RSI 계산 필요
    const high = data.high || 0; // 전일 고가 필요 (API에서 가져와야 함)

    // 1. 과열 체크
    if (rsi > 70) return;

    // 2. 추세 체크 (20일선 위에 있는가?)
    // CORE는 "터치(눌림목)"이므로 20일선 근처여야 함 (예: MA20 * 0.98 ~ 1.02)
    // ALPHA는 "돌파"이므로 20일선 위에 있어야 함
    if (ma20 > 0) {
      // 정규장, Post, Pre 가격 모두 체크
      const pricesToCheck = [
        { p: data.price, label: '정규장' },
        { p: data.postPrice, label: 'After' },
        { p: data.prePrice, label: 'Pre' }
      ].filter(item => item.p > 0 && typeof item.p === 'number');

      // 중복 알림 방지용 플래그
      let alertTriggered = false;

      for (const { p, label } of pricesToCheck) {
        if (alertTriggered) break; // 하나라도 걸리면 종료

        const dist = (p - ma20) / ma20;

        if (stock.type === 'CORE') {
          // 눌림목: 20일선 부근 (-2% ~ +2%) 이면서 RSI가 낮을 때
          if (dist > -0.02 && dist < 0.02) {
            triggerAlert(stock.name, `✨ [CORE/${label}] 20일선 눌림목 터치 (MA20: ${ma20.toFixed(0)}, ${label}: ${p.toFixed(0)})`);
            alertTriggered = true;
          }
        } else if (stock.type === 'LEVERAGE') {
          // 돌파: 20일선 위에 있고, 전일 고가를 돌파했는가?
          if (dist > 0 && dist < 0.05 && apiStatus === 'connected') {
            if (data.change > 0) {
              triggerAlert(stock.name, `🚀 [LEV/${label}] 20일선 위 상승세 (${label}: ${p.toFixed(2)})`);
              alertTriggered = true;
            }
          }
        }
      }
    }
  };

  // [순환매 전략] 섹터 감시 함수
  const checkSectorRotation = (sectorName, price, ma20, rsi, change) => {
    if (!ma20 || price === 0) return;

    const dist = (price - ma20) / ma20; // 20일선 이격도

    // 1. 매도(익절) 전략: 과열
    if (rsi > 70) {
      // 이미 보유 중이라면 3-3-4 분할 매도 신호
      if (marketStatusRef.current.kr !== 'Closed' && change > 0) {
        triggerAlert(sectorName, `🔥 [순환매/매도] ${sectorName} 과열 (RSI ${rsi.toFixed(0)})! 수익 확정 고려`);
      }
    }

    // 2. 매수(길목) 전략: 20일선 근처 횡보 or 갓 돌파 (소외된 섹터 발굴)
    // RSI가 과열되지 않았고(60이하), 20일선 부근(-2% ~ +3%)에 있을 때
    if (rsi > 35 && rsi < 60 && dist > -0.02 && dist < 0.03) {
      // 특히 오늘 상승하면서 20일선을 뚫고 올라가는 모양새면 강력 추천
      if (change > 0 && price > ma20) {
        triggerAlert(sectorName, `🔄 [순환매/길목] ${sectorName} 20일선 돌파 초입! (RSI ${rsi.toFixed(0)}) 관찰 요망`);
      }
    }
  };

  const fetchPrices = useCallback(async () => {
    const currentMarket = marketStatusRef.current;
    const isKrOpen = currentMarket.kr !== 'Closed';
    const isUsOpen = currentMarket.us !== 'Closed';

    // 1. 지수 업데이트 (개장 시에만 변동)
    // 1. 지수(선물) 업데이트 - 실시간 API 연동
    const indexResults = await Promise.all(indicesRef.current.map(async (idx) => {
      const symbol = MARKET_INDICES.find(m => m.id === idx.id)?.symbol;
      if (!symbol) return idx;

      const data = await fetchYahooPrice(symbol);
      if (data) {
        return {
          ...idx,
          current: data.price,
          change: data.change,
          history: data.history && data.history.length > 0 ? data.history : idx.history // 실제 차트 데이터 적용
        };
      }
      return idx;
    }));
    setIndices(indexResults);


    // 2. 주식 데이터 페칭
    const allStockSymbols = [...SYMBOLS.CORE, ...SYMBOLS.LEVERAGE];
    const stockResults = await Promise.all(allStockSymbols.map(async (s) => {
      let data = null;
      // 항상 데이터를 가져옴
      data = await fetchYahooPrice(s.symbol);

      if (data && data.price > 0) {
        // RSI 계산 (history 데이터 활용)
        const prices = data.history.map(h => h.price);
        const rsi = calculateRSI(prices);

        // 데이터 객체에 병합
        const enrichedData = { ...s, ...data, rsi };

        // 매수 신호 체크 (MA20 데이터가 있을 때만)
        if (s.ma20) {
          checkBuySignal(s, enrichedData, s.ma20);
        }

        // 손절/익절 자동 감시 (3-3-4 전략은 보유 평단가가 있어야 하므로, 여기서는 "추세 이탈 경고"만 수행)
        if (!s.banned && s.type !== 'WATCH' && s.ma20 && data.price < s.ma20) {
          // 추세 이탈! (종가 기준이어야 하지만 실시간 경고)
          if (marketStatusRef.current.us === 'Open' || marketStatusRef.current.kr !== 'Closed') {
            triggerAlert(s.name, `⚠️ [${s.type}] 20일선 이탈! 추세 붕괴 위험`);
          }
        }

        if (s.banned) {
          // 금지 품목인데 상승하면? (포모 방지용 메시지 안 띄움, 조용히 관망)
        }

        return enrichedData;
      } else {
        const existing = stocksRef.current.find(st => st.symbol === s.symbol);
        return { ...s, ...existing, isSimulated: true };
      }
    }));
    setStocks(stockResults);

    // 3. 섹터 데이터 페칭 (RSI, MA20 계산 포함)
    const sectorResults = await Promise.all(SECTOR_LIST.map(async (s) => {
      const data = await fetchYahooPrice(s.symbol);
      let marketState = 'Closed';
      let rsi = 50;
      let ma20 = 0;
      let price = 0;
      let change = 0;
      let history = [];

      if (data) {
        price = data.price;
        change = data.change;
        marketState = data.marketState;
        history = data.history;
        // history 데이터를 이용해 RSI 및 MA20 직접 계산
        // 일봉 데이터로 지표(RSI, MA20) 계산/페칭
        const stats = await fetchDailyStats(s.symbol);
        if (stats) {
          ma20 = stats.ma20 || 0;
          rsi = stats.rsi || 50;
        }

        // 순환매 감시
        checkSectorRotation(s.name, price, ma20, rsi, change);
      }

      return {
        ...s,
        price,
        change,
        prevClose: data ? data.prevClose : 0,
        isSimulated: false,
        marketState,
        rsi,
        ma20,
        history: history
      };
    }));
    setSectors(sectorResults);

    setApiStatus('connected');
    setLastUpdate(new Date().toLocaleTimeString());
  }, [triggerAlert, telegramConfig]);

  // 주기적 실행 (Ref를 사용하여 종속성 루프 차단)
  const fetchPricesRef = useRef(fetchPrices);
  const updateMarketStatusRef = useRef(updateMarketStatus);
  useEffect(() => {
    fetchPricesRef.current = fetchPrices;
    updateMarketStatusRef.current = updateMarketStatus;
  }, [fetchPrices, updateMarketStatus]);

  useEffect(() => {
    // 1. 초기 실행: 시장 상태 및 가격 업데이트
    updateMarketStatusRef.current();
    fetchPricesRef.current();

    // 2. 초기 실행: 지표(MA20, RSI) 업데이트 (1회성)
    const updateIndicators = async () => {
      const allSymbols = [...SYMBOLS.CORE, ...SYMBOLS.LEVERAGE];
      const statsPromises = allSymbols.map(async (s) => {
        const stats = await fetchDailyStats(s.symbol);
        return { symbol: s.symbol, ...stats };
      });

      const results = await Promise.all(statsPromises);

      setStocks(prev => prev.map(stock => {
        const res = results.find(r => r.symbol === stock.symbol);
        return res ? { ...stock, ma20: res.ma20, rsi: res.rsi } : stock;
      }));
    };
    updateIndicators();

    // 3. 초기 실행: 목표가(Target Price) 업데이트 (1회성)
    const updateTargetPrices = async () => {
      const allSymbols = [...SYMBOLS.CORE, ...SYMBOLS.LEVERAGE];
      const promises = allSymbols.map(async (s) => {
        const target = await fetchTargetPrice(s.symbol);
        return { symbol: s.symbol, target };
      });
      const results = await Promise.all(promises);

      setStocks(prev => prev.map(stock => {
        const res = results.find(r => r.symbol === stock.symbol);
        return res && res.target ? { ...stock, target: res.target } : stock;
      }));
    };
    updateTargetPrices();

    // 3. 주기적 실행: 가격 및 시장 상태 (45초)
    const interval = setInterval(() => {
      updateMarketStatusRef.current();
      fetchPricesRef.current();
    }, 45000);
    return () => clearInterval(interval);
  }, []); // 의존성 배열을 비워 루프를 완전히 차단

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* --- Header --- */}
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 mb-12 border-b border-slate-900 pb-10">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-indigo-400">
              <LayoutDashboard className="w-10 h-10" />
              <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-blue-400 to-emerald-400 tracking-tighter uppercase">
                Kim Hyun-woo Alpha 3.6B
              </h1>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
                <Globe className="w-3 h-3 text-blue-400" />
                US: <span className={marketStatus.us !== 'Closed' ? 'text-emerald-400' : 'text-amber-400'}>{marketStatus.us}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
                <Globe className="w-3 h-3 text-rose-400" />
                KR(NXT): <span className={marketStatus.kr !== 'Closed' ? 'text-emerald-400 font-black' : 'text-slate-500'}>{marketStatus.kr}</span>
              </div>
              <div className={`flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-full border border-slate-800 ${apiStatus === 'connected' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                {apiStatus === 'connected' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                ENGINE: {apiStatus.toUpperCase()}
              </div>
              <button onClick={requestPermission} className="flex items-center gap-2 text-[10px] font-bold bg-indigo-600/20 text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors">
                <BellRing className="w-3 h-3" /> Push Alerts: {notifPermission === 'granted' ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => setIsSettingsOpen(true)}
                className={`flex items-center gap-2 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-colors ${telegramConfig.botToken ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                <Settings className="w-3 h-3" /> {telegramConfig.botToken ? 'Telegram ON' : 'Setup Telegram'}
              </button>
            </div>
          </div>

          {/* 텔레그램 설정 모달 */}
          {isSettingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="absolute top-4 right-4 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>

                <h3 className="text-lg font-black text-white flex items-center gap-2 mb-4">
                  <MessageSquare className="w-5 h-5 text-blue-400" /> Telegram Setup
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Bot Token</label>
                    <input
                      type="text"
                      placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                      defaultValue={telegramConfig.botToken}
                      id="tg-token-input"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">BotFather에게서 받은 토큰을 입력하세요.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Chat ID</label>
                    <input
                      type="text"
                      placeholder="-100123456789"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                      defaultValue={telegramConfig.chatId}
                      id="tg-chatid-input"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">메시지를 받을 채팅방의 ID (user_infobot 등을 통해 확인)</p>
                  </div>

                  <button
                    onClick={() => {
                      const token = document.getElementById('tg-token-input').value;
                      const chatid = document.getElementById('tg-chatid-input').value;
                      saveTelegramConfig(token, chatid);
                    }}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" /> Save Configuration
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl px-8 py-5 flex items-center gap-5 backdrop-blur-xl">
            <div className="p-3 bg-emerald-500/10 rounded-2xl">
              <Wallet className="text-emerald-400 w-7 h-7" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Total Net Liquidity</p>
              <p className="text-2xl font-mono font-black text-white leading-none">
                {INITIAL_LIQUIDITY.toLocaleString()} <span className="text-sm text-slate-500 font-normal">KRW</span>
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          <aside className="lg:col-span-1 space-y-8">
            <div className="bg-slate-900/30 border border-slate-800/50 rounded-[2.5rem] p-8 backdrop-blur-sm relative overflow-hidden">
              <h2 className="text-xs font-black mb-8 flex items-center gap-2 text-indigo-400 uppercase tracking-[0.3em]">
                <Zap className="w-4 h-4 fill-current" /> Tactical Signals
              </h2>
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar text-sm">
                {alerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 opacity-30 text-center">
                    <Activity className="w-8 h-8 mb-2" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">Scanning Markets...</p>
                  </div>
                ) : (
                  alerts.map(alert => (
                    <div key={alert.id} className="bg-[#0f172a]/80 border-l-4 border-indigo-500 p-5 rounded-r-2xl animate-in slide-in-from-left-4">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Signal</span>
                        <span className="text-[9px] text-slate-600 font-mono">{alert.time}</span>
                      </div>
                      <p className="font-bold text-slate-100 leading-snug">{alert.symbol}: {alert.msg}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="bg-indigo-600/5 border border-indigo-500/10 rounded-3xl p-6">
              <h3 className="text-xs font-black text-indigo-400 mb-3 flex items-center gap-2 uppercase tracking-widest">
                <BarChart3 className="w-4 h-4" /> NXT & YF Ready
              </h3>
              <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                휴장 시에는 마지막 가격을 고정(Fixed)하여 불필요한 변동을 방지합니다. NXT 야간 거래 시간대에는 실제 체결 데이터 배열을 파싱하여 실시간성을 확보합니다.
              </p>
            </div>
          </aside>

          <main className="lg:col-span-3 space-y-10">
            <div className="flex flex-wrap gap-2 bg-slate-900/40 p-1.5 rounded-2xl border border-slate-800/50 w-fit backdrop-blur-md">
              {[
                { id: 'INDEX', label: '시장 지수', icon: LineChartIcon },
                { id: 'LEVERAGE', label: '레버리지', icon: Layers },
                { id: 'CORE', label: '반도체 CORE', icon: ShieldCheck },
                { id: 'SECTOR', label: '국내 8대 섹터', icon: Coins }
              ].map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setCurrentTab(tab.id)}
                    className={`px-6 py-3 rounded-xl text-sm font-black transition-all duration-300 flex items-center gap-2 ${currentTab === tab.id ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/30' : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    <Icon className="w-4 h-4" /> {tab.label}
                  </button>
                );
              })}
            </div>

            <div className={`grid gap-8 ${currentTab === 'SECTOR' ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
              {(currentTab === 'INDEX') && indices.map(idx => <IndexCard key={idx.id} idx={idx} />)}

              {(currentTab === 'LEVERAGE') && stocks.filter(s => s.type === 'LEVERAGE').map(stock => <StockCard key={stock.symbol} stock={stock} status={marketStatus} />)}

              {(currentTab === 'CORE') && stocks.filter(s => s.type === 'CORE').map(stock => <StockCard key={stock.symbol} stock={stock} status={marketStatus} />)}


              {(currentTab === 'SECTOR') && (
                <>
                  {sectors.map(sector => <SectorCard key={sector.code} sector={sector} status={marketStatus} />)}

                  <div className="col-span-full mt-6 mb-2 p-5 bg-slate-950/40 border border-slate-800/60 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6 backdrop-blur-sm order-last shadow-lg">
                    <div className="flex items-center gap-4">
                      <div className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.2em] border-r border-slate-700 pr-4 py-1">Rotation Strategy</div>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                        <span className="text-xs font-bold text-slate-300">길목 선취매</span>
                        <span className="text-[10px] text-slate-500 font-mono">(RSI 40~60 & 20MA Supp)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pr-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                      <span className="text-xs font-bold text-slate-300">과열 익절</span>
                      <span className="text-[10px] text-slate-500 font-mono">(RSI 70+ or +20%)</span>
                    </div>
                  </div>
                </>
              )}


            </div>
          </main>
        </div>
      </div>
      <NotificationButton />
    </div>
  );
}

function IndexCard({ idx }) {
  if (!idx) return null; // 데이터 없으면 렌더링 안 함

  // 최근 72시간 데이터만 필터링 (주말 고려)
  const now = Date.now() / 1000;
  const recentHistory = idx.history && Array.isArray(idx.history)
    ? idx.history.filter(h => h.time > now - (72 * 60 * 60)) // 3일
    : [];

  // 데이터가 아예 없으면 원본이라도 사용 (안전장치)
  const displayHistory = recentHistory.length > 0 ? recentHistory : (idx.history || []);
  const lastTime = displayHistory.length > 0 ? displayHistory[displayHistory.length - 1].time : null;

  const currentVal = idx.price || 0;
  const changeVal = idx.change || 0;

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-[2.5rem] p-8 transition-all hover:border-indigo-500/50 group shadow-lg">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-black tracking-tighter text-white group-hover:text-indigo-400 transition-colors uppercase leading-tight">{idx.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Real-time</span>
            {lastTime && (
              <span className="text-[10px] text-indigo-400 font-mono font-black bg-indigo-500/10 px-1.5 py-0.5 rounded">
                {new Date(lastTime * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
          </div>
        </div>
        <div className={`text-right font-mono font-black ${changeVal >= 0 ? 'text-rose-500' : 'text-indigo-400'}`}>
          <div className="text-2xl tracking-tighter">{currentVal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
          <div className="text-sm flex items-center justify-end gap-1">
            {changeVal >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(changeVal).toFixed(2)}%
          </div>


        </div>
      </div>

      <div className="mt-8 flex items-center justify-center bg-slate-950/40 rounded-3xl p-6 py-8 border border-slate-800/30">
        <MiniChart data={displayHistory} stroke={idx.stroke} width={220} height={80} />
      </div>
    </div>
  );
}

function StockCard({ stock, status }) {
  const isLeverage = stock?.type === 'LEVERAGE';
  const config = isLeverage ? TARGET_CONFIG[stock?.name] : null;
  const isUs = !stock?.symbol?.includes('.KS');

  const price = stock?.price || 0;
  const change = stock?.change || 0;
  const prevClose = stock?.prevClose || 0;

  // 레버리지 진입 가이드 (NVDL, TSLL 등)
  const leverageRule = TARGET_CONFIG.LEVERAGE_RULES[stock?.name];

  // 시그널 상태 판단
  let signal = null;
  // 1. 매수 시그널
  if (stock.ma20 && price > 0) {
    const dist = (price - stock.ma20) / stock.ma20;
    const rsi = stock.rsi || 50;

    if (stock.type === 'CORE' && Math.abs(dist) < 0.02 && rsi < 70) {
      signal = { type: 'BUY', label: 'DIP ENTRY', color: 'emerald' };
    } else if (stock.type === 'LEVERAGE' && dist > 0 && dist < 0.05 && change > 0 && rsi < 70) {
      signal = { type: 'BUY', label: 'BREAKOUT', color: 'blue' };
    }
    // 2. 매도/위험 시그널
    if (price < stock.ma20) {
      signal = { type: 'SELL', label: 'TREND BROKEN', color: 'rose' };
    }
    // 3. 과열 시그널
    if (rsi > 70) {
      signal = { type: 'WARN', label: 'OVERBOUGHT', color: 'amber' };
    }
  }


  const isMaBroken = stock?.ma20 && price > 0 && price < stock.ma20;
  const decimalPlaces = isUs ? 2 : 0;

  return (
    <div className={`group relative bg-slate-900/40 border transition-all duration-700 rounded-[2.5rem] p-8 overflow-hidden ${signal?.type === 'BUY' ? 'border-emerald-500 shadow-2xl shadow-emerald-500/20' :
      signal?.type === 'SELL' ? 'border-rose-500/50 shadow-xl shadow-rose-900/20' :
        'border-slate-800/80 shadow-lg'
      }`}>

      {/* 상단 정보 바 (시그널 + 상태) */}
      <div className="flex justify-between items-start mb-6 w-full relative z-10">
        <div className="min-h-[24px]">
          {signal && signal.type !== 'SELL' && (
            <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-widest uppercase flex items-center gap-1.5 shadow-lg
                ${signal.color === 'emerald' ? 'bg-emerald-500 text-slate-900 shadow-emerald-500/20' :
                signal.color === 'blue' ? 'bg-blue-500 text-white shadow-blue-500/20' :
                  signal.color === 'amber' ? 'bg-amber-500 text-slate-900 shadow-amber-500/20' :
                    'bg-slate-700 text-white'}`}>
              {signal.type === 'BUY' && <Zap className="w-3 h-3 fill-current" />}
              {signal.type === 'WARN' && <AlertTriangle className="w-3 h-3 fill-current" />}
              {signal.label}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {stock?.isSimulated && (
            <span className="text-[7px] font-black px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-widest">Fixed</span>
          )}
          {stock?.marketState && (
            <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase tracking-widest ${stock.marketState.includes('Post') || stock.marketState.includes('Pre') ? 'text-indigo-400 border-indigo-500/30' : 'text-slate-500 border-slate-700/30'
              }`}>
              {stock.marketState}
            </span>
          )}
          <span className={`text-[8px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${isUs ? (status?.us !== 'Closed' ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30')
            : (status?.kr !== 'Closed' ? 'text-emerald-400 border-emerald-500/30' : (status?.kr.includes('NXT') ? 'text-blue-400 border-blue-500/30 font-black' : 'text-slate-600 border-slate-800'))
            }`}>
            {isUs ? status?.us : status?.kr}
          </span>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-2xl font-black tracking-tighter text-white group-hover:text-indigo-400 transition-colors uppercase">{stock?.name}</h3>
        <div className="flex justify-between items-center text-[10px] uppercase font-mono mt-1 opacity-70">
          <span className="text-slate-500 font-bold">Prev: {prevClose.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces })}</span>
          {stock.ma20 > 0 && (
            <span className={`font-black ${price < stock.ma20 ? 'text-rose-400' : 'text-emerald-400'}`}>
              MA20: {stock.ma20.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces })}
            </span>
          )}
        </div>
      </div>

      {/* 진입 목표 가격 표시 (레버리지 탭 전용) */}
      {leverageRule && prevClose > 0 && (
        <div className="flex gap-2 mb-4">
          {leverageRule.tiers.map((tier, i) => {
            const targetPrice = prevClose * (1 - tier.drop);
            const isReached = price <= targetPrice;
            return (
              <div key={i} className={`flex-1 px-3 py-2 rounded-xl border ${isReached ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-slate-950/30 border-slate-800 text-slate-500'}`}>
                <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5 opacity-80">{tier.label} Entry (-{Math.round(tier.drop * 100)}%)</div>
                <div className="text-sm font-mono font-black">{targetPrice.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces })}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between items-end relative z-10">
        <div>
          <p className="text-3xl font-mono font-black text-white tracking-tighter">
            {price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }) : '---'}
          </p>

          {/* 가격 정보 상세 표시 (Regular + Post/Pre) */}
          <div className="flex flex-col items-start mt-1 gap-0.5 min-h-[20px]">
            {/* 1. 정규장 종가 (시간외 가격이 있거나 메인이 Regular가 아닐 때 표시) */}
            {(stock.postPrice > 0 || stock.prePrice > 0) && (
              <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                <span className="opacity-70 uppercase font-bold tracking-wider">Regular</span>
                <span className="font-bold">{(stock.regularClose || price).toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces })}</span>
              </div>
            )}

            {/* 2. Post Market (있으면 표시) */}
            {stock.postPrice > 0 && (
              <div className={`text-[10px] font-mono flex items-center gap-1 ${stock.postPrice === price ? 'text-white font-black' : 'text-purple-400'}`}>
                <span className="opacity-70 uppercase font-bold tracking-wider">After</span>
                <span className="font-bold">{stock.postPrice.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces })}</span>
                {stock.regularClose > 0 && stock.postPrice !== stock.regularClose && (
                  <span className={`text-[9px] ${stock.postPrice > stock.regularClose ? 'text-emerald-400' : 'text-rose-400'}`}>
                    ({((stock.postPrice - stock.regularClose) / stock.regularClose * 100).toFixed(2)}%)
                  </span>
                )}
              </div>
            )}

            {/* 3. Pre Market (있으면 표시) */}
            {stock.prePrice > 0 && (
              <div className={`text-[10px] font-mono flex items-center gap-1 ${stock.prePrice === price ? 'text-white font-black' : 'text-amber-400'}`}>
                <span className="opacity-70 uppercase font-bold tracking-wider">Pre</span>
                <span className="font-bold">{stock.prePrice.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces })}</span>
              </div>
            )}
          </div>
        </div>
        <div className={`text-right font-black text-lg ${change >= 0 ? 'text-rose-500' : 'text-indigo-400'}`}>
          {(change || 0).toFixed(2)}%
        </div>
      </div>

      {/* 증권사 목표가 (Target Price) */}
      {stock.target && stock.target.mean > 0 && (
        <div className="mt-4 mb-2 p-3 rounded-xl bg-slate-950/40 border border-slate-800/50 flex flex-col gap-1.5 opacity-90 relative group-hover:border-slate-700/50 transition-colors">
          <div className="flex justify-between items-center text-[9px] font-mono">
            <span className="font-bold text-indigo-300 uppercase tracking-wider">🎯 Target Avg</span>
            <span className="font-black text-white">{stock.target.mean.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces })}</span>
          </div>
          <div className="flex justify-between items-center text-[8px] text-slate-500 font-mono">
            <span>Range (L~H)</span>
            <span className="tracking-tighter">{stock.target.low?.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: 0 })} ~ {stock.target.high?.toLocaleString(undefined, { minimumFractionDigits: decimalPlaces, maximumFractionDigits: 0 })}</span>
          </div>
          {price > 0 && (
            <div className="flex justify-between items-center mt-1 border-t border-slate-800/50 pt-1.5">
              <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Upside Potential</span>
              <span className={`text-[10px] font-black font-mono ${stock.target.mean > price ? 'text-emerald-400' : 'text-rose-400'}`}>
                {stock.target.mean > price ? '+' : ''}{((stock.target.mean - price) / price * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      <div className="pt-8 border-t border-slate-800/50 flex justify-between items-end">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest uppercase">MOMENTUM (RSI)</span>
          <span className={`text-sm font-mono font-bold ${stock?.rsi > 70 ? 'text-amber-500' : stock?.rsi < 30 ? 'text-emerald-400' : 'text-slate-300'}`}>
            {stock?.rsi ? stock.rsi.toFixed(1) : '-'} <span className="text-[9px] text-slate-600 font-normal">/ 100</span>
          </span>
        </div>
        <div className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${isMaBroken ? 'bg-rose-500/10 text-rose-500 border-rose-500/40 animate-pulse' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}>
          {isMaBroken ? '추세 이탈' : 'TREND HOLD'}
        </div>
      </div>
    </div>
  );
}

// 알림 권한 요청 버튼 컴포넌트
// 알림 권한 요청 버튼 컴포넌트
function NotificationButton() {
  const [permission, setPermission] = useState(() => {
    return (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
  });

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        new Notification('알림 설정 완료', { body: '이제 중요한 시그널을 놓치지 마세요!' });
        // 오디오 잠금 해제도 겸함
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            const audioCtx = new AudioContext();
            audioCtx.resume();
          }
        } catch (e) { console.error('Audio Init Failed', e); }
      }
    } catch (e) {
      console.error('Notification Request Failed', e);
    }
  };

  if (typeof Notification === 'undefined' || permission === 'granted') return null;


  return (
    <button
      onClick={requestPermission}
      className="fixed bottom-6 right-6 z-50 bg-indigo-600 hover:bg-indigo-500 text-white p-4 rounded-full shadow-2xl shadow-indigo-500/40 animate-bounce flex items-center justify-center transition-all active:scale-95"
      aria-label="알림 켜기"
    >
      <Bell className="w-6 h-6 fill-current" />
    </button>
  );
}

function SectorCard({ sector, status }) {
  const price = sector?.price || 0;
  const change = sector?.change || 0;
  const isUp = change >= 0;

  // 섹터 상태 진단
  let badge = null;
  const ma20 = sector?.ma20 || 0;
  const rsi = sector?.rsi || 50;

  if (ma20 > 0 && price > 0) {
    if (rsi > 70) badge = { label: '🔥 OVERHEATED', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' };
    else if (price > ma20 && change > 0 && rsi < 60) badge = { label: '🔄 ROTATION BUY', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
    else if (price < ma20) badge = { label: '📉 DOWNTREND', color: 'text-slate-500 bg-slate-800 border-slate-700' };
    else badge = { label: '👀 WATCH', color: 'text-slate-400 bg-slate-800/50 border-slate-700/50' };
  }

  return (
    <div className={`bg-slate-900/40 border p-6 rounded-[2.5rem] text-center shadow-xl group transition-all duration-500 flex flex-col items-center justify-between min-h-[200px] relative
      ${badge?.label === '🔄 ROTATION BUY' ? 'border-blue-500 shadow-blue-500/20' : 'border-slate-800 hover:border-indigo-500/50'}`}>

      <div className="absolute top-3 right-5 flex items-center gap-1.5">
        {badge && (
          <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase tracking-widest ${badge.color}`}>{badge.label}</span>
        )}
      </div>

      <div className="w-full pt-4">
        <p className="text-[10px] text-slate-600 font-black mb-1 tracking-[0.3em] uppercase group-hover:text-indigo-400 transition-colors">{sector?.code}</p>
        <h3
          onClick={() => window.open(`https://alphasquare.co.kr/home/stock-information?code=${sector.code}`, '_blank')}
          className="text-[13px] font-black text-white hover:text-indigo-400 cursor-pointer transition-colors leading-tight mb-3 h-8 flex items-center justify-center px-2 group-hover:scale-105 duration-300"
          title="알파스퀘어 차트 보기"
        >
          {sector?.name}
        </h3>
        <p className="text-xl font-mono font-black text-white mb-1">
          {price > 0 ? price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '---'}
        </p>
        <p className={`text-xs font-black ${isUp ? 'text-rose-500' : 'text-indigo-400'}`}>
          {isUp ? '+' : ''}{(change || 0).toFixed(2)}%
        </p>
      </div>

      {rsi > 0 && (
        <div className="w-full mt-4 pt-4 border-t border-slate-800/50 flex flex-col gap-2 px-2">
          {/* MA20 표시 추가 */}
          {ma20 > 0 && (
            <div className="flex justify-between items-center text-[9px] font-mono">
              <span className="text-slate-500 font-bold uppercase tracking-widest">MA(20)</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-bold">{ma20.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className={`${price > ma20 ? 'text-emerald-400' : 'text-rose-400'} font-black`}>
                  ({price > 0 ? ((price - ma20) / ma20 * 100).toFixed(1) : 0}%)
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">RSI (14)</span>
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-16 rounded-full bg-slate-800 overflow-hidden`}>
                <div className={`h-full rounded-full ${rsi > 70 ? 'bg-amber-500' : rsi < 30 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(rsi, 100)}%` }}></div>
              </div>
              <span className={`text-[10px] font-mono font-bold ${rsi > 70 ? 'text-amber-500' : 'text-slate-400'}`}>{rsi.toFixed(0)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




