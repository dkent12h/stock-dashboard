
const symbols = ['NQ=F', 'ES=F', 'KRW=X', '^KS200'];

async function checkIndices() {
    console.log('Checking Indices...', symbols);

    for (const symbol of symbols) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
            const res = await fetch(url);
            const data = await res.json();

            const result = data.chart?.result?.[0];
            if (result) {
                const price = result.meta.regularMarketPrice;
                const time = new Date(result.meta.regularMarketTime * 1000).toLocaleString();
                console.log(`[${symbol}] Price: ${price}, Time: ${time}`);
            } else {
                console.log(`[${symbol}] No Data (result is null)`);
            }
        } catch (e) {
            console.log(`[${symbol}] Error: ${e.message}`);
        }
    }
}

checkIndices();
