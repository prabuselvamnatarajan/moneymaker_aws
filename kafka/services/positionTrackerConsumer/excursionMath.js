export function calcUnrealizedPnl(entryPrice, direction, openSize, ltp) {
  const entry = Number(entryPrice) || 0;
  const size = Number(openSize) || 0;
  const price = Number(ltp) || 0;
  if (!(size > 0) || !(entry > 0)) return 0;
  if (direction === "LONG") {
    return parseFloat(((price - entry) * size).toFixed(4));
  }
  return parseFloat(((entry - price) * size).toFixed(4));
}

export function calcProfitPct(entryPrice, direction, ltp) {
  const entry = Number(entryPrice) || 0;
  const price = Number(ltp) || 0;
  if (!(entry > 0)) return 0;
  if (direction === "LONG") {
    return parseFloat((((price - entry) / entry) * 100).toFixed(4));
  }
  return parseFloat((((entry - price) / entry) * 100).toFixed(4));
}

export function applyExcursion(current, unrealisedPnl, profitPct) {
  return {
    maxUp: Math.max(Number(current.maxUp) || 0, unrealisedPnl),
    maxDown: Math.min(Number(current.maxDown) || 0, unrealisedPnl),
    maxUpPct: Math.max(Number(current.maxUpPct) || 0, profitPct),
    maxDownPct: Math.min(Number(current.maxDownPct) || 0, profitPct),
  };
}

export function extractLtp(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.ltp === "number") return data.ltp;
  const feed =
    data.fullFeed?.marketFF ||
    data.fullFeed?.indexFF ||
    data.marketFF ||
    data.indexFF ||
    data.feed;
  const ltp = feed?.ltpc?.ltp ?? data.ltpc?.ltp ?? null;
  return typeof ltp === "number" ? ltp : null;
}
