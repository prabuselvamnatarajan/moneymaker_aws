import { extractFeed } from './utils.js';

/**
 * Convert timeframe string to milliseconds.
 * Throws explicit error if timeframe is unsupported (Fail Loud & Fast).
 */
export function timeframeToMs(timeframe) {
  if (timeframe == null || timeframe === '') {
    throw new Error('timeframe is required');
  }
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
 * Resolve exchange tick time in ms.
 * Prefer ltpc.ltt (Upstox LTPC.last traded time) over any server-side timestamp.
 * @see MicroServices/ConnectWS-Upstox/MarketDataFeed.proto LTPC { ltp, ltt, ltq, cp }
 */
export function resolveTickTimestampMs(msg, feed = null) {
  const resolvedFeed = feed || extractFeed(msg);
  const rawLtt = resolvedFeed?.ltpc?.ltt;
  if (rawLtt != null && rawLtt !== '') {
    const ltt = typeof rawLtt === 'number' ? rawLtt : parseInt(rawLtt, 10);
    if (Number.isFinite(ltt) && ltt > 0) {
      return ltt;
    }
  }
  if (msg?.timestamp) {
    const parsed = new Date(msg.timestamp).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new Error('Tick missing ltpc.ltt and usable timestamp');
}

/**
 * Build / update aggregated timeframe candle from tick LTP/LTT only.
 * Does not use marketOHLC / I1 — OHLC is constructed purely from consecutive ticks.
 *
 * @param {Object} msg - Raw tick payload (fullFeed / ltpc / firstLevelWithGreeks)
 * @param {string} timeframe - Target timeframe (e.g. '1m', '3m', '5m', '15m')
 * @param {Object|null} existingCandleState - Existing candle state from deployment strategy state
 * @returns {{ candle: Object|null, newCandleState: Object|null }}
 */
export function buildTimeframeCandle(msg, timeframe, existingCandleState = null) {
  const feed = extractFeed(msg);
  const ltp = feed?.ltpc?.ltp ?? msg?.ltp ?? null;
  if (ltp == null || typeof ltp !== 'number' || Number.isNaN(ltp)) {
    return { candle: null, newCandleState: existingCandleState };
  }

  const timestampMs = resolveTickTimestampMs(msg, feed);
  const intervalMs = timeframeToMs(timeframe);
  const bucketStartMs = Math.floor(timestampMs / intervalMs) * intervalMs;
  const isoTimestamp = new Date(timestampMs).toISOString();

  const timeframeChanged = existingCandleState
    && existingCandleState.interval
    && existingCandleState.interval !== timeframe;
  const bucketChanged = !existingCandleState
    || existingCandleState.bucketStartMs !== bucketStartMs
    || timeframeChanged;

  let newCandleState;
  if (bucketChanged) {
    newCandleState = {
      bucketStartMs,
      open: ltp,
      high: ltp,
      low: ltp,
      close: ltp,
      timestamp: isoTimestamp,
      interval: timeframe,
    };
  } else {
    newCandleState = {
      ...existingCandleState,
      high: Math.max(existingCandleState.high, ltp),
      low: Math.min(existingCandleState.low, ltp),
      close: ltp,
      timestamp: isoTimestamp,
      interval: timeframe,
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
