function extractFeed(dataObject) {
    const marketFF = dataObject?.fullFeed?.marketFF || dataObject?.marketFF;
    const indexFF = dataObject?.fullFeed?.indexFF || dataObject?.indexFF;
    if (marketFF?.ltpc || indexFF?.ltpc) {
        return marketFF || indexFF;
    }
    if (dataObject?.ltpc) {
        return {
            ltpc: dataObject.ltpc,
            marketLevel: dataObject.marketLevel,
            marketOHLC: dataObject.marketOHLC,
            vtt: dataObject.vtt,
            tbq: dataObject.tbq,
            tsq: dataObject.tsq,
            atp: dataObject.atp,
        };
    }
    if (dataObject?.firstLevelWithGreeks?.ltpc) {
        return dataObject.firstLevelWithGreeks;
    }
    return dataObject?.fullFeed?.marketFF
        || dataObject?.fullFeed?.indexFF
        || dataObject?.marketFF
        || dataObject?.indexFF
        || null;
}

function resolveFeedContext(dataObject) {
    const marketFF = dataObject?.fullFeed?.marketFF || dataObject?.marketFF;
    const indexFF = dataObject?.fullFeed?.indexFF || dataObject?.indexFF;
    if (marketFF?.ltpc) {
        return { feed: marketFF, feedType: 'market' };
    }
    if (indexFF?.ltpc) {
        return { feed: indexFF, feedType: 'index' };
    }
    if (dataObject?.ltpc) {
        return {
            feed: {
                ltpc: dataObject.ltpc,
                marketLevel: dataObject.marketLevel,
                marketOHLC: dataObject.marketOHLC,
                vtt: dataObject.vtt,
                tbq: dataObject.tbq,
                tsq: dataObject.tsq,
                atp: dataObject.atp,
            },
            feedType: dataObject.firstLevelWithGreeks ? 'market' : 'market',
        };
    }
    if (dataObject?.firstLevelWithGreeks?.ltpc) {
        return { feed: dataObject.firstLevelWithGreeks, feedType: 'market' };
    }
    return null;
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
    const resolved = resolveFeedContext(dataObject);
    if (!resolved?.feed?.ltpc) {
        return null;
    }

    const { feed, feedType } = resolved;

    const ltpc = feed.ltpc;
    const rawLtp = ltpc.ltp ?? null;
    const ltp = rawLtp == null || rawLtp === '' ? null : Number(rawLtp);
    const ltq = Number(ltpc.ltq) || 0;
    // Upstox LTPC.ltt = last traded time (ms epoch). Used for bar bucketing.
    const rawLtt = Number(ltpc.ltt);
    const tradeTs = Number.isFinite(rawLtt) && rawLtt > 0 ? rawLtt : null;
    const cp = ltpc.cp ?? null;

    const quotes = feed.marketLevel?.bidAskQuote || [];
    const topQuote = quotes[0] || {};

    const bestBid = topQuote.bidP ?? null;
    const bestAsk = topQuote.askP ?? null;
    const bidQ = Number(topQuote.bidQ) || 0;
    const askQ = Number(topQuote.askQ) || 0;

    let confidence = 'high';
    if (feedType === 'index' || bestBid == null || bestAsk == null) {
        confidence = 'low';
    }

    // Wall-clock / server time for gap detection (illiquid instruments have sparse ltt)
    let serverTs = null;
    if (dataObject && dataObject.timestamp) {
        const parsedTs = new Date(dataObject.timestamp).getTime();
        if (!isNaN(parsedTs) && parsedTs > 0) {
            serverTs = parsedTs;
        }
    }
    const gapTimestamp = serverTs || tradeTs || Date.now();
    // Bar bucketing prefers exchange trade time when available
    const barTimestamp = tradeTs || serverTs || gapTimestamp;

    return {
        ltp: Number.isFinite(ltp) ? ltp : null,
        ltq,
        ltt: tradeTs || gapTimestamp,
        cp,
        bestBid,
        bestAsk,
        bidQ,
        askQ,
        vtt: feed.vtt != null ? Number(feed.vtt) : null,
        tbq: feed.tbq != null ? Number(feed.tbq) : null,
        tsq: feed.tsq != null ? Number(feed.tsq) : null,
        atp: feed.atp ?? null,
        // Prior-day levels only — timeframe bars are built from tick LTP/LTT, not I1
        ohlc1d: getOhlcByInterval(feed, '1d'),
        feedType,
        confidence,
        previousLtp,
        timestamp: gapTimestamp,
        barTimestamp,
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
