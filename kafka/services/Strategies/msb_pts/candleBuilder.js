import { extractFeed } from './utils.js';

/**
 * Convert timeframe string to milliseconds.
 * Throws explicit error if timeframe is unsupported (Fail Loud & Fast).
 */
export function timeframeToMs(timeframe) {
  if (!timeframe) return 60000;
  const str = String(timeframe).trim().toLowerCase();
  const map = {
    '1m': 60000,
    '1minute': 60000,
    '1_minute': 60000,
    '3m': 180000,
    '3minute': 180000,
    '3_minute': 180000,
    '5m': 300000,
    '5minute': 300000,
    '5_minute': 300000,
    '15m': 900000,
    '15minute': 900000,
    '15_minute': 900000,
  };
  const ms = map[str];
  if (!ms) {
    throw new Error(`Unsupported timeframe: '${timeframe}'. Allowed values are 1m (1minute), 3m (3minute), 5m (5minute), 15m (15minute).`);
  }
  return ms;
}

/**
 * Build / update aggregated timeframe candle from tick message.
 * @param {Object} msg - Raw tick payload
 * @param {string} timeframe - Target timeframe (e.g. '1m', '3m', '5m', '15m')
 * @param {Object|null} existingCandleState - Existing candle state from deployment strategy state
 * @returns {{ candle: Object, newCandleState: Object }}
 */
export function buildTimeframeCandle(msg, timeframe, existingCandleState = null) {
  const feed = extractFeed(msg);
  const ltp = feed?.ltpc?.ltp ?? msg?.ltp ?? null;
  if (ltp == null || typeof ltp !== 'number' || Number.isNaN(ltp)) {
    return { candle: null, newCandleState: existingCandleState };
  }

  let timestampMs;
  if (msg?.timestamp) {
    const parsed = new Date(msg.timestamp).getTime();
    timestampMs = !Number.isNaN(parsed) ? parsed : Date.now();
  } else if (feed?.ltpc?.ltt) {
    timestampMs = parseInt(feed.ltpc.ltt, 10);
  } else {
    timestampMs = Date.now();
  }

  const intervalMs = timeframeToMs(timeframe);
  const bucketStartMs = Math.floor(timestampMs / intervalMs) * intervalMs;
  const isoTimestamp = new Date(timestampMs).toISOString();

  // Extract I1 candle from feed if available
  const ohlcArray = feed?.marketOHLC?.ohlc || [];
  const i1 = ohlcArray.find((item) => item.interval === 'I1');
  const i1High = (i1 && typeof i1.high === 'number') ? i1.high : ltp;
  const i1Low = (i1 && typeof i1.low === 'number') ? i1.low : ltp;
  const i1Open = (i1 && typeof i1.open === 'number') ? i1.open : ltp;

  let newCandleState;
  if (!existingCandleState || existingCandleState.bucketStartMs !== bucketStartMs) {
    // New bucket
    newCandleState = {
      bucketStartMs,
      open: i1Open,
      high: Math.max(ltp, i1High),
      low: Math.min(ltp, i1Low),
      close: ltp,
      timestamp: isoTimestamp,
      interval: timeframe,
    };
  } else {
    // Same bucket
    newCandleState = {
      ...existingCandleState,
      high: Math.max(existingCandleState.high, ltp, i1High),
      low: Math.min(existingCandleState.low, ltp, i1Low),
      close: ltp,
      timestamp: isoTimestamp,
    };
  }

  const candle = {
    open: newCandleState.open,
    high: newCandleState.high,
    low: newCandleState.low,
    close: newCandleState.close,
    ltp: ltp,
    timestamp: newCandleState.timestamp,
    interval: timeframe,
  };

  return { candle, newCandleState };
}
