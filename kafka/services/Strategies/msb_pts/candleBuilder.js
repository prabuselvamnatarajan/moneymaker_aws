/**
 * Local extractFeed — kept here so candleBuilder tests run without Docker /app logger.
 */
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
 * Soft-skips incomplete ticks (missing LTP or ltt/timestamp) by returning candle=null.
 * Soft-skips out-of-order ticks whose bucket is older than the current bucket.
 * Unsupported timeframe still throws (config error).
 *
 * @param {Object} msg - Raw tick payload (fullFeed / ltpc / firstLevelWithGreeks)
 * @param {string} timeframe - Target timeframe (e.g. '1m', '3m', '5m', '15m')
 * @param {Object|null} existingCandleState - Existing candle state from deployment strategy state
 * @returns {{ candle: Object|null, newCandleState: Object|null }}
 */
export function buildTimeframeCandle(msg, timeframe, existingCandleState = null) {
  const feed = extractFeed(msg);
  const rawLtp = feed?.ltpc?.ltp ?? msg?.ltp ?? null;
  const ltp = typeof rawLtp === 'number' ? rawLtp : Number(rawLtp);
  if (rawLtp == null || rawLtp === '' || !Number.isFinite(ltp)) {
    // Soft-skip: incomplete tick data must not crash the consumer
    return { candle: null, newCandleState: existingCandleState };
  }

  let timestampMs;
  try {
    timestampMs = resolveTickTimestampMs(msg, feed);
  } catch {
    // Soft-skip: missing ltt/timestamp — caller should log and continue
    return { candle: null, newCandleState: existingCandleState };
  }
  const intervalMs = timeframeToMs(timeframe);
  const bucketStartMs = Math.floor(timestampMs / intervalMs) * intervalMs;
  const isoTimestamp = new Date(timestampMs).toISOString();

  const timeframeChanged = existingCandleState
    && existingCandleState.interval
    && existingCandleState.interval !== timeframe;

  // Ignore stale/out-of-order ticks that would rewind the forming bar
  if (
    existingCandleState
    && !timeframeChanged
    && Number.isFinite(existingCandleState.bucketStartMs)
    && bucketStartMs < existingCandleState.bucketStartMs
  ) {
    return { candle: null, newCandleState: existingCandleState };
  }

  const bucketChanged = !existingCandleState
    || existingCandleState.bucketStartMs !== bucketStartMs
    || timeframeChanged;

  let closedCandle = null;
  if (
    bucketChanged &&
    existingCandleState &&
    !timeframeChanged &&
    Number.isFinite(existingCandleState.bucketStartMs) &&
    existingCandleState.bucketStartMs !== bucketStartMs
  ) {
    closedCandle = {
      open: existingCandleState.open,
      high: existingCandleState.high,
      low: existingCandleState.low,
      close: existingCandleState.close,
      ltp: existingCandleState.close,
      timestamp: existingCandleState.timestamp,
      interval: timeframe,
      isClosed: true,
    };
  }

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
    isClosed: false,
  };

  return { candle, closedCandle, newCandleState };
}
