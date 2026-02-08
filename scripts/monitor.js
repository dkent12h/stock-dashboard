const TELEGRAM_TOKEN = '8254989007:AAHBEN86rxhRgf_v8jnik4h3qYMv_O1TJjQ';
const CHAT_ID = '7052069160';

const SYMBOLS = [
    // CORE
    { symbol: '005930.KS', name: '삼성전자', type: 'CORE' },
    { symbol: '000660.KS', name: 'SK하이닉스', type: 'CORE' },
    { symbol: 'NVDA', name: 'NVDA', type: 'CORE' },
    { symbol: 'ARM', name: 'ARM', type: 'CORE' },
    // LEVERAGE
    { symbol: 'SOXL', name: 'SOXL', type: 'LEVERAGE' },
    { symbol: 'SOXS', name: 'SOXS', type: 'LEVERAGE' },
    { symbol: 'TQQQ', name: 'TQQQ', type: 'LEVERAGE' },
    { symbol: 'SQQQ', name: 'SQQQ', type: 'LEVERAGE' },
    // 8대 섹터 ETF (KODEX/TIGER 등 대표 종목으로 교체)
    { symbol: '091160.KS', name: 'KODEX 반도체', type: 'SECTOR' },
    { symbol: '305720.KS', name: 'KODEX 2차전지산업', type: 'SECTOR' },
    { symbol: '091180.KS', name: 'KODEX 자동차', type: 'SECTOR' },
    { symbol: '091170.KS', name: 'KODEX 은행', type: 'SECTOR' },
    { symbol: '266420.KS', name: 'KODEX 헬스케어', type: 'SECTOR' },
    { symbol: '139230.KS', name: 'TIGER 200중공업', type: 'SECTOR' },
    { symbol: '429000.KS', name: 'ARIRANG K방산Fn', type: 'SECTOR' },
    { symbol: '424260.KS', name: 'HANARO 원자력iSelect', type: 'SECTOR' }
];

async function sendMessage(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: text })
        });
        if (!res.ok) console.error('Telegram API Failed:', res.status);
    } catch (e) {
        console.error('Telegram Send Error:', e);
    }
}

async function fetchChart(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2mo`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockBot/1.0)' }
        });
        const data = await res.json();
        return data?.chart?.result?.[0];
    } catch (e) {
        console.error(`Fetch Error (${symbol}):`, e.message);
        return null;
    }
}

// RSI 계산
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

async function checkStock(stock) {
    const result = await fetchChart(stock.symbol);
    if (!result) return;

    const quote = result.indicators.quote[0];
    const closes = quote.close.filter(p => typeof p === 'number');
    if (closes.length < 20) return;

    const currentPrice = closes[closes.length - 1];
    const last20 = closes.slice(-20);
    const ma20 = last20.reduce((a, b) => a + b, 0) / 20;
    const rsi = calculateRSI(closes);
    const dist = (currentPrice - ma20) / ma20; // 20일선 이격도

    // 조건 체크
    let msg = '';

    // 1. CORE: 눌림목 (-2% ~ +2%, RSI < 70)
    if (stock.type === 'CORE') {
        if (dist > -0.02 && dist < 0.02 && rsi < 70) {
            msg = `✨ [CORE/눌림목] ${stock.name}\n20일선 터치! (이격 ${dist.toFixed(2)}%, RSI ${rsi.toFixed(0)})`;
        }
    }
    // 2. LEVERAGE: 돌파/상승 (0% ~ +5%, RSI < 70)
    else if (stock.type === 'LEVERAGE') {
        if (dist > 0 && dist < 0.05 && rsi < 70) {
            // 오늘 올랐는지 확인 (전일 종가 대비)
            const prev = closes[closes.length - 2];
            if (currentPrice > prev) {
                msg = `🚀 [LEV/돌파] ${stock.name}\n20일선 위 상승세! (이격 ${dist.toFixed(2)}%, RSI ${rsi.toFixed(0)})`;
            }
        }
    }
    // 3. SECTOR: 길목 (-2% ~ +3%, RSI < 60)
    else if (stock.type === 'SECTOR') {
        if (dist > -0.02 && dist < 0.03 && rsi > 35 && rsi < 60) {
            msg = `🔄 [순환매/길목] ${stock.name}\n관심 구간 진입 (RSI ${rsi.toFixed(0)})`;
        }
    }

    // 4. 공통: 과열 (RSI > 70) 혹은 추세 이탈
    if (rsi > 75) {
        msg = `🔥 [과열] ${stock.name} RSI ${rsi.toFixed(0)}! 익절 고민하세요.`;
    } else if (currentPrice < ma20 && stock.type !== 'SECTOR') {
        // 데드크로스? (너무 자주 울릴 수 있으니 3% 이상 하락 시에만?)
        // 여기서는 생략, 매수 기회만 알림
    }

    if (msg) {
        console.log(`Alert: ${stock.name}`);
        await sendMessage(msg);
    } else {
        console.log(`Pass: ${stock.name} (${currentPrice}, MA ${ma20.toFixed(0)})`);
    }
}

async function run() {
    console.log('Starting Stock Monitor...');
    for (const symbol of SYMBOLS) {
        await checkStock(symbol);
    }
    console.log('Done.');
}

run();
