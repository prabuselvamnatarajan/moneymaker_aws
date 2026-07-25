/**
 * Helpers for Position lifecycle and excursion maths used by createTrade
 * and the position tracker consumer.
 */

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

/** Profit-direction percentage vs entry. Returns 0 when entryPrice is invalid. */
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
  const next = { ...current };
  next.max_up = Math.max(Number(next.max_up) || 0, unrealisedPnl);
  next.max_down = Math.min(Number(next.max_down) || 0, unrealisedPnl);
  next.max_up_pct = Math.max(Number(next.max_up_pct) || 0, profitPct);
  next.max_down_pct = Math.min(Number(next.max_down_pct) || 0, profitPct);
  return next;
}

export function weightedAvgPrice(currentAvg, currentQty, newPrice, newQty) {
  const cq = Number(currentQty) || 0;
  const nq = Number(newQty) || 0;
  if (nq <= 0) return Number(currentAvg) || 0;
  if (cq <= 0) return Number(newPrice) || 0;
  return ((Number(currentAvg) || 0) * cq + (Number(newPrice) || 0) * nq) / (cq + nq);
}

export function applyBuySellPrice(position, typeOfOrder, price, quantity) {
  if (typeOfOrder === "BUY") {
    position.buy_price = weightedAvgPrice(position.buy_price, position.buy_qty, price, quantity);
    position.buy_qty = (position.buy_qty || 0) + quantity;
  } else {
    position.sell_price = weightedAvgPrice(position.sell_price, position.sell_qty, price, quantity);
    position.sell_qty = (position.sell_qty || 0) + quantity;
  }
}

export function directionFromSignedSize(signedSize) {
  return signedSize > 0 ? "LONG" : "SHORT";
}

/**
 * Timestamp for a forced end-of-run close. Must land strictly after the open,
 * otherwise the closing trade sorts level with the opening one in the analysis
 * series and the excursion replay window is empty.
 */
export function resolveCloseExecutionTime(openedAt, lastTickAt) {
  const openedRaw = openedAt ? new Date(openedAt).getTime() : NaN;
  const openedMs = Number.isFinite(openedRaw) ? openedRaw : Date.now();
  const tickRaw = lastTickAt ? new Date(lastTickAt).getTime() : NaN;
  const tickMs = Number.isFinite(tickRaw) ? tickRaw : 0;
  return tickMs > openedMs ? new Date(tickMs) : new Date(openedMs + 1);
}

export function round2(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

/**
 * Unrealised is open-quantity mark-to-market, so CLOSED positions contribute
 * nothing however stale a value they happen to be carrying.
 */
export function sumOpenUnrealised(positions = []) {
  let total = 0;
  for (const pos of positions) {
    if (String(pos.status || "").toUpperCase() !== "OPEN") continue;
    total += Number(pos.unrealised_pnl) || 0;
  }
  return round2(total);
}
