function getLatestOHLCByInterval(dataObject, interval) {
  const ohlcArray = dataObject?.ff?.marketFF?.marketOHLC?.ohlc || [];

  console.log(`Extracted OHLC Array:`, ohlcArray);
  // Filter only matching interval entries
  const matchingOHLCs = ohlcArray.filter(item => item.interval === interval);

  if (matchingOHLCs.length === 0) {
    console.log(`No OHLC data found for interval: ${interval}`);
    ohlcArray.forEach(item => console.log(`Available interval: ${item.interval}`));
    let oneDayOHLC = ohlcArray.filter(item => item.interval === '1d');
    if (oneDayOHLC.length > 0) {
      return oneDayOHLC[0];
    }
    return null;
  }

  // Find the OHLC with the latest timestamp
  const latestOHLC = matchingOHLCs.reduce((latest, current) => {
    return Number(current.ts) > Number(latest.ts) ? current : latest;
  });

  return latestOHLC;
}

function getLTP(dataObject) {
  return dataObject?.ff?.marketFF?.ltpc?.ltp ?? null;
}


export { getLatestOHLCByInterval, getLTP };
