export function extractLtp(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.ltp === 'number') return data.ltp;
  const feed =
    data.fullFeed?.marketFF ||
    data.fullFeed?.indexFF ||
    data.marketFF ||
    data.indexFF ||
    null;
  const ltp = feed?.ltpc?.ltp;
  return typeof ltp === 'number' ? ltp : null;
}
