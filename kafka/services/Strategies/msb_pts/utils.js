import { logger } from '/app/utils/logUtils.js';

// IST offset from UTC: +5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Checks whether a given feed timestamp falls within the configured trading window.
 *
 * @param {number|string} ts   - Unix epoch in seconds (from OHLC data)
 * @param {object} strategy_details - strategy config; may contain:
 *   trading_window: { start: "HH:MM", end: "HH:MM" }   (IST, 24-hr format)
 *   Defaults to 11:30 – 14:00 IST if not provided.
 * @returns {boolean}
 */
function isWithinTradingWindow(ts, strategy_details = {}) {
  const window = strategy_details.trading_window || {};
  const startStr = window.start || '11:30';
  const endStr   = window.end   || '14:00';

  // Convert epoch milliseconds → IST Date (Upstox ts is already in ms)
  const epochMs = Number(ts);
  const istMs   = epochMs + IST_OFFSET_MS;
  const istDate = new Date(istMs);

  const hours   = istDate.getUTCHours();    // UTC hours of IST date
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH,   endM  ] = endStr.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes   = endH   * 60 + endM;

  const inWindow = totalMinutes >= startMinutes && totalMinutes < endMinutes;

  logger.debug(
    `Trading window check: feed ts=${ts}, IST time=${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}, ` +
    `window=${startStr}–${endStr}, inWindow=${inWindow}`
  );

  return inWindow;
}

function getLatestOHLCByInterval(dataObject, interval) {
  const feed = dataObject?.fullFeed?.marketFF || dataObject?.fullFeed?.indexFF || dataObject?.marketFF || dataObject?.indexFF;
  const ohlcArray = feed?.marketOHLC?.ohlc || [];

  logger.debug(`Extracted OHLC Array:`, ohlcArray);
  // Filter only matching interval entries
  const matchingOHLCs = ohlcArray.filter(item => item.interval === interval);

  if (matchingOHLCs.length === 0) {
    logger.warn(`No OHLC data found for interval: ${interval}`);
    ohlcArray.forEach(item => logger.debug(`Available interval: ${item.interval}`));
    let oneDayOHLC = ohlcArray.filter(item => item.interval === '1d');
    if (oneDayOHLC.length > 0) {
      return { ...oneDayOHLC[0] };
    }
    return {};
  }

  // Find the OHLC with the latest timestamp
  const latestOHLC = matchingOHLCs.reduce((latest, current) => {
    return Number(current.ts) > Number(latest.ts) ? current : latest;
  });

  return latestOHLC;
}

function getLTP(dataObject) {
  const feed = dataObject?.fullFeed?.marketFF || dataObject?.fullFeed?.indexFF || dataObject?.marketFF || dataObject?.indexFF;
  return feed?.ltpc?.ltp ?? null;
}


export { getLatestOHLCByInterval, getLTP, isWithinTradingWindow };
