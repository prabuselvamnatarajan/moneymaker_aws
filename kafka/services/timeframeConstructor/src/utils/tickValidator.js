/**
 * Input tick extraction and validation utilities.
 */

function extractFeed(dataObject) {
  if (!dataObject || typeof dataObject !== 'object') return null;
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
 * Resolve the tick price (LTP) from various vendor formats.
 *
 * @param {Object} msg
 * @param {Object|null} feed
 * @returns {number|null} Valid numeric LTP or null
 */
export function extractLtp(msg, feed = null) {
  const resolvedFeed = feed || extractFeed(msg);
  const raw = resolvedFeed?.ltpc?.ltp ?? msg?.ltp ?? null;
  if (raw == null || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Resolve the exchange timestamp in milliseconds (epoch ms).
 * Prioritizes exchange LTT (feed.ltpc.ltt) over server-side msg.timestamp.
 *
 * @param {Object} msg
 * @param {Object|null} feed
 * @returns {number|null} Valid timestamp in ms or null
 */
export function extractTickTimestampMs(msg, feed = null) {
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
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Extract per-tick traded quantity and cumulative volume.
 *
 * @param {Object} msg
 * @param {Object|null} feed
 * @returns {{ ltq: number, vtt: number|null }}
 */
export function extractVolumeData(msg, feed = null) {
  const resolvedFeed = feed || extractFeed(msg);
  const rawLtq = resolvedFeed?.ltpc?.ltq ?? msg?.ltq ?? 0;
  const ltq = Number.isFinite(Number(rawLtq)) ? Math.max(0, Number(rawLtq)) : 0;

  const rawVtt = resolvedFeed?.vtt ?? msg?.vtt ?? msg?.volume ?? null;
  const vtt = rawVtt != null && Number.isFinite(Number(rawVtt)) ? Number(rawVtt) : null;

  return { ltq, vtt };
}

/**
 * Validate and normalize an incoming tick message.
 * Returns null if the tick is incomplete or invalid (soft-skip for corrupt packets).
 *
 * @param {Object} msg - Parsed Kafka message payload
 * @param {string|null} key - Kafka partition key (usually the symbol)
 * @returns {Object|null} Normalized tick object or null
 */
export function validateAndNormalizeTick(msg, key = null) {
  if (!msg || typeof msg !== 'object') return null;

  const feed = extractFeed(msg);
  const ltp = extractLtp(msg, feed);
  if (ltp === null) return null;

  const timestampMs = extractTickTimestampMs(msg, feed);
  if (timestampMs === null) return null;

  const rawSymbol = msg.symbol || msg.symbol_name || msg.name || key || '';
  const symbol = String(rawSymbol).trim();
  if (!symbol) return null;

  const { ltq, vtt } = extractVolumeData(msg, feed);

  return {
    symbol,
    ltp,
    timestampMs,
    ltq,
    vtt,
    raw: msg,
  };
}
