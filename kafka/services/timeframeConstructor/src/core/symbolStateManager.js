import { CandleAggregator } from './candleAggregator.js';
import { normalizeTimeframe } from './timeBoundary.js';

export const DEFAULT_TIMEFRAMES = ['1m', '3m', '5m', '15m'];

/**
 * Pure stateless tick processor for timeframe construction.
 * Computes updated intermediate state and snapshot timeframes given a tick,
 * without retaining any in-memory state.
 *
 * @param {Object} tick - Normalized tick { symbol, ltp, timestampMs, ltq, vtt }
 * @param {Object} [existingState={}] - Current intermediate state from Redis { [tf]: { currentCandle, previousCandle, lastVtt } }
 * @param {string[]|null} [requiredTimeframes=null] - Dynamic timeframes required for this symbol
 * @returns {{
 *   updatedState: Object,
 *   snapshotData: Object
 * }}
 */
export function processStatelessTick(tick, existingState = {}, requiredTimeframes = null) {
  let timeframes;
  if (Array.isArray(requiredTimeframes) && requiredTimeframes.length > 0) {
    timeframes = requiredTimeframes.map(normalizeTimeframe);
  } else if (existingState && Object.keys(existingState).length > 0) {
    timeframes = Object.keys(existingState).map(normalizeTimeframe);
  } else {
    timeframes = DEFAULT_TIMEFRAMES.map(normalizeTimeframe);
  }

  const updatedState = {};
  const tfResults = {};

  for (const tf of timeframes) {
    const aggregator = new CandleAggregator(tf);
    if (existingState && existingState[tf]) {
      aggregator.fromJSON(existingState[tf]);
    }
    const result = aggregator.update(tick);
    updatedState[tf] = aggregator.toJSON();

    tfResults[tf] = {
      startTime: result.candle.startTime,
      endTime: result.candle.endTime,
      open: result.candle.open,
      high: result.candle.high,
      low: result.candle.low,
      close: result.candle.close,
      volume: result.candle.volume,
      isClosed: result.candle.isClosed,
      closedCandle: result.closedCandle,
    };
  }

  const prevVersion = Number(existingState?._version) || 0;
  const snapshotVersion = prevVersion + 1;
  updatedState._version = snapshotVersion;

  return {
    updatedState,
    snapshotData: {
      symbol: tick.symbol,
      eventTimestamp: tick.timestampMs,
      snapshotVersion,
      ltp: tick.ltp,
      volume: tick.ltq || 0,
      timeframes: tfResults,
    },
  };
}

/**
 * Encapsulates the multi-timeframe state for a single symbol.
 */
export class SymbolTimeframeState {
  /**
   * @param {string} symbol
   * @param {string[]} timeframes
   */
  constructor(symbol, timeframes = DEFAULT_TIMEFRAMES) {
    this.symbol = symbol;
    this.timeframes = timeframes.map(normalizeTimeframe);
    this.aggregators = new Map();
    for (const tf of this.timeframes) {
      this.aggregators.set(tf, new CandleAggregator(tf));
    }
    this.snapshotVersion = 0;
    this.lastProcessedTimestamp = null;
  }

  /**
   * Ensure a timeframe aggregator exists.
   *
   * @param {string} timeframe
   */
  ensureTimeframe(timeframe) {
    const canonical = normalizeTimeframe(timeframe);
    if (!this.aggregators.has(canonical)) {
      this.aggregators.set(canonical, new CandleAggregator(canonical));
      if (!this.timeframes.includes(canonical)) {
        this.timeframes.push(canonical);
      }
    }
  }

  /**
   * Ingest a tick and update all timeframes for this symbol.
   *
   * @param {Object} tick - { symbol, ltp, timestampMs, ltq, vtt }
   * @returns {{
   *   symbol: string,
   *   eventTimestamp: number,
   *   snapshotVersion: number,
   *   ltp: number,
   *   volume: number,
   *   timeframes: Object
   * }}
   */
  processTick(tick) {
    this.snapshotVersion += 1;
    this.lastProcessedTimestamp = tick.timestampMs;

    const tfResults = {};

    for (const [tf, aggregator] of this.aggregators.entries()) {
      const result = aggregator.update(tick);
      tfResults[tf] = {
        startTime: result.candle.startTime,
        endTime: result.candle.endTime,
        open: result.candle.open,
        high: result.candle.high,
        low: result.candle.low,
        close: result.candle.close,
        volume: result.candle.volume,
        isClosed: result.candle.isClosed,
        closedCandle: result.closedCandle,
      };
    }

    return {
      symbol: this.symbol,
      eventTimestamp: tick.timestampMs,
      snapshotVersion: this.snapshotVersion,
      ltp: tick.ltp,
      volume: tick.ltq || 0,
      timeframes: tfResults,
    };
  }

  /**
   * Export symbol state for persistence.
   */
  toJSON() {
    const aggregatorsObj = {};
    for (const [tf, agg] of this.aggregators.entries()) {
      aggregatorsObj[tf] = agg.toJSON();
    }
    return {
      symbol: this.symbol,
      timeframes: this.timeframes,
      snapshotVersion: this.snapshotVersion,
      lastProcessedTimestamp: this.lastProcessedTimestamp,
      aggregators: aggregatorsObj,
    };
  }

  /**
   * Hydrate symbol state from persisted snapshot.
   */
  fromJSON(data) {
    if (!data) return;
    this.snapshotVersion = data.snapshotVersion || 0;
    this.lastProcessedTimestamp = data.lastProcessedTimestamp || null;
    if (data.aggregators && typeof data.aggregators === 'object') {
      for (const [tf, aggData] of Object.entries(data.aggregators)) {
        this.ensureTimeframe(tf);
        this.aggregators.get(tf).fromJSON(aggData);
      }
    }
  }
}

/**
 * In-memory manager for watched symbols.
 * Supports both stateless execution (via processStatelessTick) and isolated local state.
 */
export class SymbolStateManager {
  /**
   * @param {string[]} defaultTimeframes
   */
  constructor(defaultTimeframes = DEFAULT_TIMEFRAMES) {
    this.defaultTimeframes = defaultTimeframes.map(normalizeTimeframe);
    this.symbolStates = new Map();
  }

  /**
   * Get or initialize the SymbolTimeframeState for a symbol.
   *
   * @param {string} symbol
   * @param {string[]} [timeframes]
   * @returns {SymbolTimeframeState}
   */
  getOrCreate(symbol, timeframes = null) {
    const key = String(symbol).trim().toUpperCase();
    if (!this.symbolStates.has(key)) {
      const tfs = timeframes || this.defaultTimeframes;
      this.symbolStates.set(key, new SymbolTimeframeState(key, tfs));
    } else if (timeframes && Array.isArray(timeframes)) {
      const state = this.symbolStates.get(key);
      for (const tf of timeframes) {
        state.ensureTimeframe(tf);
      }
    }
    return this.symbolStates.get(key);
  }

  /**
   * Process a tick for a symbol.
   * If existingState is supplied, executes statelessly without retaining memory state.
   *
   * @param {Object} tick - { symbol, ltp, timestampMs, ltq, vtt }
   * @param {Object|null} [existingState=null]
   * @param {string[]|null} [requiredTimeframes=null]
   * @returns {Object}
   */
  processTick(tick, existingState = null, requiredTimeframes = null) {
    if (existingState !== null) {
      return processStatelessTick(tick, existingState, requiredTimeframes || this.defaultTimeframes);
    }
    const state = this.getOrCreate(tick.symbol, requiredTimeframes);
    return state.processTick(tick);
  }

  /**
   * Check if state exists for a symbol.
   *
   * @param {string} symbol
   * @returns {boolean}
   */
  has(symbol) {
    return this.symbolStates.has(String(symbol).trim().toUpperCase());
  }

  /**
   * Remove a symbol from state (e.g. on unsubscription).
   *
   * @param {string} symbol
   * @returns {boolean}
   */
  delete(symbol) {
    return this.symbolStates.delete(String(symbol).trim().toUpperCase());
  }

  /**
   * Clear all symbols.
   */
  clear() {
    this.symbolStates.clear();
  }

  /**
   * Return array of all active symbol names.
   *
   * @returns {string[]}
   */
  getActiveSymbols() {
    return Array.from(this.symbolStates.keys());
  }
}
