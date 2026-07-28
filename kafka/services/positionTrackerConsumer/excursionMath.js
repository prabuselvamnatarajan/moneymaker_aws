export function calcUnrealizedPnl(entryPrice, direction, openSize, ltp) {
  const entry = Number(entryPrice) || 0;
  const size = Number(openSize) || 0;
  const price = Number(ltp) || 0;
  if (!(size > 0) || !(entry > 0)) return 0;
  const dir = String(direction).toUpperCase();
  if (dir === "LONG") {
    return parseFloat(((price - entry) * size).toFixed(4));
  }
  return parseFloat(((entry - price) * size).toFixed(4));
}

export function calcProfitPct(entryPrice, direction, ltp) {
  const entry = Number(entryPrice) || 0;
  const price = Number(ltp) || 0;
  if (!(entry > 0)) return 0;
  const dir = String(direction).toUpperCase();
  if (dir === "LONG") {
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

/**
 * Prefer exchange LTT (ltpc.ltt), then message timestamp.
 * Same precedence as strategy candle builders.
 */
export function extractTickTimeMs(data) {
  if (!data || typeof data !== "object") return null;
  const feed =
    data.fullFeed?.marketFF ||
    data.fullFeed?.indexFF ||
    data.marketFF ||
    data.indexFF ||
    data.feed;
  const ltt = feed?.ltpc?.ltt ?? data.ltpc?.ltt;
  if (ltt != null && ltt !== "") {
    const ms = parseInt(ltt, 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (data.timestamp) {
    const ms = new Date(data.timestamp).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

/**
 * position:open:{SYMBOL} is keyed by symbol alone, so two BACKTEST deployments
 * replaying the same symbol share one set. Backtest ticks carry deployment_id,
 * so require an exact match before a replay may mark a position. Live feed ticks
 * carry no deployment_id and legitimately apply to every LIVE/PAPER position.
 */
export function tickTargetsPosition(isBacktestTopic, tickDeploymentId, positionDeploymentId) {
  if (!isBacktestTopic) return true;
  if (!tickDeploymentId || !positionDeploymentId) return false;
  return String(tickDeploymentId) === String(positionDeploymentId);
}
