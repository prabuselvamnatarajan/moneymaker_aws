function getLatestOHLCByInterval(dataObject, interval) {
  const ohlcArray = dataObject?.ff?.marketFF?.marketOHLC?.ohlc || [];

  // Filter only matching interval entries
  const matchingOHLCs = ohlcArray.filter(item => item.interval === interval);

  if (matchingOHLCs.length === 0) return null;

  // Find the OHLC with the latest timestamp
  const latestOHLC = matchingOHLCs.reduce((latest, current) => {
    return Number(current.ts) > Number(latest.ts) ? current : latest;
  });

  return latestOHLC;
}

function getLTP(dataObject) {
  return dataObject?.ff?.marketFF?.ltpc?.ltp ?? null;
}


module.exports = { getLatestOHLCByInterval, getLTP };
