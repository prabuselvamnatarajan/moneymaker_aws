function extractFeed(dataObject) {
    return dataObject?.fullFeed?.marketFF
        || dataObject?.fullFeed?.indexFF
        || dataObject?.marketFF
        || dataObject?.indexFF
        || null;
}

function getOhlcByInterval(feed, interval) {
    const ohlcArray = feed?.marketOHLC?.ohlc || [];
    const matching = ohlcArray.filter((item) => item.interval === interval);
    if (matching.length === 0) {
        return null;
    }
    return matching.reduce((latest, current) =>
        Number(current.ts) > Number(latest.ts) ? current : latest
    );
}

/**
 * Normalize raw Kafka tick payload into a canonical tick DTO.
 */
function parseTick(dataObject, previousLtp = null) {
    const marketFF = dataObject?.fullFeed?.marketFF || dataObject?.marketFF;
    const indexFF = dataObject?.fullFeed?.indexFF || dataObject?.indexFF;
    const feed = marketFF || indexFF;

    if (!feed?.ltpc) {
        return null;
    }

    const ltpc = feed.ltpc;
    const ltp = ltpc.ltp ?? null;
    const ltq = Number(ltpc.ltq) || 0;
    const ltt = Number(ltpc.ltt) || Date.now();
    const cp = ltpc.cp ?? null;

    const quotes = feed.marketLevel?.bidAskQuote || [];
    const topQuote = quotes[0] || {};

    const feedType = marketFF ? 'market' : 'index';
    const bestBid = topQuote.bidP ?? null;
    const bestAsk = topQuote.askP ?? null;
    const bidQ = Number(topQuote.bidQ) || 0;
    const askQ = Number(topQuote.askQ) || 0;

    let confidence = 'high';
    if (feedType === 'index' || bestBid == null || bestAsk == null) {
        confidence = 'low';
    }

    return {
        ltp,
        ltq,
        ltt,
        cp,
        bestBid,
        bestAsk,
        bidQ,
        askQ,
        vtt: feed.vtt != null ? Number(feed.vtt) : null,
        tbq: feed.tbq != null ? Number(feed.tbq) : null,
        tsq: feed.tsq != null ? Number(feed.tsq) : null,
        atp: feed.atp ?? null,
        ohlcI1: getOhlcByInterval(feed, 'I1'),
        ohlc1d: getOhlcByInterval(feed, '1d'),
        feedType,
        confidence,
        previousLtp,
        timestamp: ltt,
    };
}

/**
 * Detect data gap; returns true if buffer/sweep state should reset.
 */
function isDataGap(currentLtt, lastLtt, gapThresholdSec = 3) {
    if (!lastLtt || !currentLtt) {
        return false;
    }
    const gapMs = Math.abs(currentLtt - lastLtt);
    return gapMs > gapThresholdSec * 1000;
}

function getLTP(dataObject) {
    const feed = extractFeed(dataObject);
    return feed?.ltpc?.ltp ?? null;
}

function getLatestOHLCByInterval(dataObject, interval) {
    const feed = extractFeed(dataObject);
    if (!feed) {
        return {};
    }
    const ohlc = getOhlcByInterval(feed, interval);
    if (ohlc) {
        return { ...ohlc };
    }
    const oneDay = getOhlcByInterval(feed, '1d');
    return oneDay ? { ...oneDay } : {};
}

export {
    parseTick,
    isDataGap,
    getLTP,
    getLatestOHLCByInterval,
    extractFeed,
};
