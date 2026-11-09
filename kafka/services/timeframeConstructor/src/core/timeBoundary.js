/**
 * Timeframe interval definitions and boundary calculations for Indian NSE markets (Asia/Kolkata).
 */

export const IST_OFFSET_MS = 19_800_000; // +05:30 in milliseconds
export const MARKET_OPEN_MS_OF_DAY = (9 * 60 + 15) * 60_000;  // 09:15:00 IST = 33,300,000 ms
export const MARKET_CLOSE_MS_OF_DAY = (15 * 60 + 30) * 60_000; // 15:30:00 IST = 55,800,000 ms
export const MS_PER_DAY = 86_400_000;

export const TIMEFRAME_CONFIG = {
  '1m': { intervalMs: 60_000, minutes: 1 },
  '3m': { intervalMs: 180_000, minutes: 3 },
  '5m': { intervalMs: 300_000, minutes: 5 },
  '15m': { intervalMs: 900_000, minutes: 15 },
  '30m': { intervalMs: 1_800_000, minutes: 30 },
  '1h': { intervalMs: 3_600_000, minutes: 60 },
  '1d': { intervalMs: 86_400_000, minutes: 1440 },
};

const TIMEFRAME_ALIASES = {
  '1m': '1m',
  '1minute': '1m',
  '1_minute': '1m',
  '3m': '3m',
  '3minute': '3m',
  '3_minute': '3m',
  '5m': '5m',
  '5minute': '5m',
  '5_minute': '5m',
  '15m': '15m',
  '15minute': '15m',
  '15_minute': '15m',
  '30m': '30m',
  '30minute': '30m',
  '30_minute': '30m',
  '1h': '1h',
  '1hour': '1h',
  '60m': '1h',
  '1d': '1d',
  '1day': '1d',
};

/**
 * Normalize and validate a timeframe string.
 * Throws explicit error if timeframe is missing or unsupported (Fail Loud & Fast).
 *
 * @param {string} timeframe
 * @returns {string} Standardized timeframe ('1m', '3m', '5m', etc.)
 */
export function normalizeTimeframe(timeframe) {
  if (timeframe == null || timeframe === '') {
    throw new Error('timeframe is required');
  }
  const clean = String(timeframe).trim().toLowerCase();
  const canonical = TIMEFRAME_ALIASES[clean];
  if (!canonical || !TIMEFRAME_CONFIG[canonical]) {
    throw new Error(
      `Unsupported timeframe: '${timeframe}'. Allowed values are: ${Object.keys(TIMEFRAME_CONFIG).join(', ')}`
    );
  }
  return canonical;
}

/**
 * Convert timeframe string to milliseconds.
 * Throws on unsupported timeframes.
 *
 * @param {string} timeframe
 * @returns {number} Interval in milliseconds
 */
export function timeframeToMs(timeframe) {
  const canonical = normalizeTimeframe(timeframe);
  return TIMEFRAME_CONFIG[canonical].intervalMs;
}

/**
 * Deterministically compute the bucket start timestamp (epoch ms) for a given interval.
 * Uses pure integer division.
 *
 * @param {number} timestampMs - Exchange timestamp in ms
 * @param {number} intervalMs - Bucket interval in ms
 * @returns {number} Bucket start timestamp in ms
 */
export function calculateBucketStart(timestampMs, intervalMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new Error(`Invalid timestampMs for bucket calculation: ${timestampMs}`);
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid intervalMs for bucket calculation: ${intervalMs}`);
  }
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

/**
 * Compute the bucket end timestamp (epoch ms) for a given start and interval.
 *
 * @param {number} bucketStartMs
 * @param {number} intervalMs
 * @returns {number}
 */
export function calculateBucketEnd(bucketStartMs, intervalMs) {
  return bucketStartMs + intervalMs;
}

/**
 * Check if an exchange timestamp falls within NSE Indian market hours (09:15 - 15:30 IST).
 *
 * @param {number} timestampMs
 * @returns {boolean}
 */
export function isMarketHours(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
  const istMsOfDay = (timestampMs + IST_OFFSET_MS) % MS_PER_DAY;
  return istMsOfDay >= MARKET_OPEN_MS_OF_DAY && istMsOfDay <= MARKET_CLOSE_MS_OF_DAY;
}
