import axios from 'axios';

const GET_OHLC_API = process.env.GET_OHLC_API || 'http://get-ohlc';

/**
 * Fetch prior session high/low via REST on session start.
 * Falls back to tick ohlc1d when API unavailable.
 */
async function fetchPriorDayOHLC(instrumentToken, userId, tickFallback) {
    const fallback = {
        prevDayHigh: tickFallback?.ohlc1d?.high ?? tickFallback?.ltp,
        prevDayLow: tickFallback?.ohlc1d?.low ?? tickFallback?.ltp,
    };

    if (!instrumentToken) {
        return fallback;
    }

    try {
        const url = `${GET_OHLC_API}/?symbol=${encodeURIComponent(instrumentToken)}&interval=1d${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`;
        const res = await axios.get(url, { timeout: 5000 });
        const ohlcData = res.data?.data?.ohlc || res.data?.ohlc || res.data;
        const entry = Array.isArray(ohlcData)
            ? ohlcData.find((o) => o.interval === '1d') || ohlcData[0]
            : ohlcData;

        if (entry?.high != null && entry?.low != null) {
            return { prevDayHigh: entry.high, prevDayLow: entry.low };
        }
    } catch (err) {
        console.warn(`[sessionInit] Prior day OHLC fetch failed: ${err.message}`);
    }

    return fallback;
}

export { fetchPriorDayOHLC };
