import { logger } from '../utils/logUtils.js';

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

function getLatestOHLCByInterval(dataObject, interval) {
    const feed = extractFeed(dataObject);
    if (!feed) {
        logger.warn(`No feed found in tick payload for interval: ${interval}`);
        return null;
    }

    const ohlcArray = feed.marketOHLC?.ohlc || [];
    logger.debug('Extracted OHLC Array:', ohlcArray);

    const ohlc = getOhlcByInterval(feed, interval);
    if (ohlc) {
        return { ...ohlc };
    }

    logger.warn(`No OHLC data found for interval: ${interval}`);
    ohlcArray.forEach((item) => logger.debug(`Available interval: ${item.interval}`));
    return null;
}

function getLTP(dataObject) {
    const feed = extractFeed(dataObject);
    return feed?.ltpc?.ltp ?? null;
}

function getTickTimestamp(dataObject) {
    // Prefer Upstox LTPC.ltt (exchange last traded time) over server timestamp
    const feed = extractFeed(dataObject);
    const rawLtt = feed?.ltpc?.ltt;
    if (rawLtt != null && rawLtt !== '') {
        const ltt = typeof rawLtt === 'number' ? rawLtt : parseInt(rawLtt, 10);
        if (Number.isFinite(ltt) && ltt > 0) {
            return new Date(ltt).toISOString();
        }
    }
    if (dataObject?.timestamp) {
        const parsed = new Date(dataObject.timestamp).getTime();
        if (!Number.isNaN(parsed) && parsed > 0) {
            return new Date(parsed).toISOString();
        }
    }
    return new Date().toISOString();
}

export {
    extractFeed,
    getLatestOHLCByInterval,
    getLTP,
    getTickTimestamp,
};
