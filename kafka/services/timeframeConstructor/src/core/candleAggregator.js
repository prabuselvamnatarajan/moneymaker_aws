import { calculateBucketStart, calculateBucketEnd, timeframeToMs } from './timeBoundary.js';

/**
 * Pure timeframe candle aggregator.
 * Responsible for updating OHLCV state and detecting bucket rollovers.
 */
export class CandleAggregator {
  /**
   * @param {string} timeframe - e.g. '1m', '3m', '5m', '15m'
   */
  constructor(timeframe) {
    this.timeframe = timeframe;
    this.intervalMs = timeframeToMs(timeframe);
    this.currentCandle = null;
    this.previousCandle = null;
    this.lastVtt = null;
  }

  /**
   * Reset aggregator state (e.g. on new session or timeframe change).
   */
  reset() {
    this.currentCandle = null;
    this.previousCandle = null;
    this.lastVtt = null;
  }

  /**
   * Calculate incremental volume for this tick.
   * Prioritizes per-event traded quantity (ltq). Falls back to cumulative vtt delta if ltq is 0.
   *
   * @param {number} ltq - Last traded quantity
   * @param {number|null} vtt - Cumulative volume
   * @returns {number} Incremental volume for this tick
   */
  resolveTickVolume(ltq, vtt) {
    if (Number.isFinite(ltq) && ltq > 0) {
      if (vtt != null && Number.isFinite(vtt)) {
        this.lastVtt = vtt;
      }
      return ltq;
    }

    if (vtt != null && Number.isFinite(vtt)) {
      if (this.lastVtt == null || vtt < this.lastVtt) {
        // First tick or session reset
        this.lastVtt = vtt;
        return 0;
      }
      const delta = vtt - this.lastVtt;
      this.lastVtt = vtt;
      return delta >= 0 ? delta : 0;
    }

    return 0;
  }

  /**
   * Process a single normalized tick and update this timeframe's candle.
   *
   * @param {Object} tick - { symbol, ltp, timestampMs, ltq, vtt }
   * @returns {{
   *   timeframe: string,
   *   candle: Object,
   *   closedCandle: Object|null,
   *   isRollover: boolean,
   *   isStale: boolean
   * }}
   */
  update(tick) {
    const { ltp, timestampMs, ltq, vtt } = tick;
    const bucketStartMs = calculateBucketStart(timestampMs, this.intervalMs);
    const bucketEndMs = calculateBucketEnd(bucketStartMs, this.intervalMs);
    const tickVolume = this.resolveTickVolume(ltq, vtt);

    // Stale/out-of-order tick check: Ignore ticks that belong to an already passed bucket
    if (this.currentCandle && bucketStartMs < this.currentCandle.startTime) {
      return {
        timeframe: this.timeframe,
        candle: { ...this.currentCandle },
        closedCandle: null,
        isRollover: false,
        isStale: true,
      };
    }

    const bucketChanged = !this.currentCandle || this.currentCandle.startTime !== bucketStartMs;

    let closedCandle = null;
    if (bucketChanged && this.currentCandle) {
      // Finalize the previous candle
      closedCandle = {
        startTime: this.currentCandle.startTime,
        endTime: this.currentCandle.endTime,
        open: this.currentCandle.open,
        high: this.currentCandle.high,
        low: this.currentCandle.low,
        close: this.currentCandle.close,
        volume: this.currentCandle.volume,
        isClosed: true,
        updatedAt: this.currentCandle.updatedAt,
      };
      this.previousCandle = closedCandle;
    }

    if (bucketChanged) {
      // Start a new forming candle
      this.currentCandle = {
        startTime: bucketStartMs,
        endTime: bucketEndMs,
        open: ltp,
        high: ltp,
        low: ltp,
        close: ltp,
        volume: tickVolume,
        isClosed: false,
        updatedAt: timestampMs,
      };
    } else {
      // Intra-bar tick: update existing candle
      this.currentCandle.high = Math.max(this.currentCandle.high, ltp);
      this.currentCandle.low = Math.min(this.currentCandle.low, ltp);
      this.currentCandle.close = ltp;
      this.currentCandle.volume += tickVolume;
      this.currentCandle.updatedAt = timestampMs;
    }

    return {
      timeframe: this.timeframe,
      candle: { ...this.currentCandle },
      closedCandle,
      isRollover: bucketChanged && closedCandle !== null,
      isStale: false,
    };
  }

  /**
   * Export the current state for serialization / checkpointing.
   */
  toJSON() {
    return {
      timeframe: this.timeframe,
      intervalMs: this.intervalMs,
      currentCandle: this.currentCandle ? { ...this.currentCandle } : null,
      previousCandle: this.previousCandle ? { ...this.previousCandle } : null,
      lastVtt: this.lastVtt,
    };
  }

  /**
   * Hydrate state from a persisted snapshot.
   */
  fromJSON(data) {
    if (!data) return;
    this.currentCandle = data.currentCandle ? { ...data.currentCandle } : null;
    this.previousCandle = data.previousCandle ? { ...data.previousCandle } : null;
    this.lastVtt = data.lastVtt ?? null;
  }
}
