/**
 * Convert timeframe string to milliseconds for liquidity_sweep bar bucketing.
 * Throws explicit error if timeframe is unsupported (Fail Loud & Fast).
 */
export function timeframeToMs(timeframe) {
  if (timeframe == null || timeframe === '') {
    throw new Error('timeframe is required');
  }
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

/** Bar length in minutes for the deployment timeframe. */
export function timeframeToMinutes(timeframe) {
  return timeframeToMs(timeframe) / 60000;
}

/**
 * atrLookbackBars is calibrated as a count of 1-minute bars.
 * Scale to the deployment bar size so wall-clock lookback stays ~equivalent.
 */
export function resolveAtrLookbackBars(timeframe, atrLookbackBars) {
  const lookback = Number(atrLookbackBars);
  if (!Number.isFinite(lookback) || lookback < 2) {
    throw new Error(`atrLookbackBars must be >= 2, got: ${atrLookbackBars}`);
  }
  const barMinutes = timeframeToMinutes(timeframe);
  return Math.max(2, Math.ceil(lookback / barMinutes));
}

/**
 * Convert TF-bar ATR to 1-minute-equivalent magnitude so atrLowPct/atrHighPct
 * (tuned for 1m bars) remain valid on 3m/5m/15m.
 */
export function normalizeAtrTo1m(atr, timeframe) {
  if (atr == null) return null;
  if (!Number.isFinite(atr)) {
    throw new Error(`Invalid ATR value: ${atr}`);
  }
  const barMinutes = timeframeToMinutes(timeframe);
  return atr / barMinutes;
}
