

// RSI Calculation (Wilder's)
const calculateRSI = (prices, period = 14) => {
    if (prices.length < period + 1) return 50;

    // 1. Initial SMA
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) {
            gains += diff;
        } else {
            losses -= diff;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // 2. Wilder's Smoothing
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
    const rsi = 100 - (100 / (1 + rs));
    return rsi;
};

async function testSectorRSI() {
    const symbol = '091160.KS'; // KODEX 반도체
    console.log(`Checking ${symbol} (Range: 2y, Interval: 1d)...`);

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y&includePrePost=false`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.chart || !data.chart.result) {
            console.error('No data found');
            return;
        }

        const result = data.chart.result[0];
        const quote = result.indicators.quote[0];
        const adjClose = result.indicators.adjclose ? result.indicators.adjclose[0].adjclose : [];

        // Use Adjusted Close first (DISABLED for debug)
        // let rawPrices = (adjClose && adjClose.length > 0) ? adjClose : quote.close;
        let rawPrices = quote.close;

        // Filter out nulls/zeros
        const validPrices = rawPrices.filter(p => typeof p === 'number' && p > 0);

        if (validPrices.length < 20) {
            console.log('Not enough data points:', validPrices.length);
            return;
        }

        const rsi = calculateRSI(validPrices, 14);

        const timestamps = result.timestamp;
        const lastTimestamp = timestamps[timestamps.length - 1];
        const lastDate = new Date(lastTimestamp * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const lastPrice = validPrices[validPrices.length - 1];

        console.log('--- Results ---');
        console.log(`Symbol: ${symbol}`);
        console.log(`Last Date (API): ${lastDate}`);
        console.log(`Last Price: ${lastPrice}`);
        console.log(`Total Valid Data Points: ${validPrices.length}`);
        console.log('Recent 5 Prices:', validPrices.slice(-5).map(p => p.toFixed(0)).join(', '));
        console.log(`!!!! Calculated RSI(14): ${rsi.toFixed(2)} !!!!`);

    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

testSectorRSI();
