import { logger } from '/app/utils/logUtils.js';

function getLatestOHLCByInterval(dataObject, interval) {
  const ohlcArray = dataObject?.fullFeed?.marketFF?.marketOHLC?.ohlc || [];

  logger.debug(`Extracted OHLC Array:`, ohlcArray);
  // Filter only matching interval entries
  const matchingOHLCs = ohlcArray.filter(item => item.interval === interval);

  if (matchingOHLCs.length === 0) {
    logger.warn(`No OHLC data found for interval: ${interval}`);
    ohlcArray.forEach(item => logger.debug(`Available interval: ${item.interval}`));
    let oneDayOHLC = ohlcArray.filter(item => item.interval === '1d');
    if (oneDayOHLC.length > 0) {
      return oneDayOHLC[0];
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
  return dataObject?.fullFeed?.marketFF?.ltpc?.ltp ?? null;
}


export { getLatestOHLCByInterval, getLTP };
