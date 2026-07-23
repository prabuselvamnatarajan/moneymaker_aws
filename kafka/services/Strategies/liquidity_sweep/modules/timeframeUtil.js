/**
 * Convert timeframe string to milliseconds for liquidity_sweep bar bucketing.
 * Throws explicit error if timeframe is unsupported (Fail Loud & Fast).
 */
export function timeframeToMs(timeframe) {
  if (!timeframe) return 60000;
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
