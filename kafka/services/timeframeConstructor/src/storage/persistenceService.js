import { normalizeTimeframe } from '../core/timeBoundary.js';

/**
 * Redis-backed persistence service for Timeframe Constructor.
 * Provides stateless storage for timeframe requirements and symbol intermediate candle states.
 */
export class PersistenceService {
  /**
   * @param {Object} redisClient - Connected redis client
   * @param {string} [keyPrefix='timeframe:state']
   */
  constructor(redisClient, keyPrefix = 'timeframe:state') {
    this.redisClient = redisClient;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Resolve state key in Redis for a symbol.
   *
   * @param {string} symbol
   * @param {boolean} [isBacktest=false]
   * @param {string|null} [deploymentId=null]
   * @returns {string}
   */
  getStateKey(symbol, isBacktest = false, deploymentId = null) {
    const clean = String(symbol).trim().toUpperCase();
    if (isBacktest && deploymentId) {
      return `${this.keyPrefix}:backtest:${clean}:${deploymentId}`;
    }
    if (isBacktest) {
      return `${this.keyPrefix}:backtest:${clean}`;
    }
    return `${this.keyPrefix}:${clean}`;
  }

  // Key helper for symbol state
  getKey(symbol) {
    const clean = String(symbol).trim().toUpperCase();
    return `${this.keyPrefix}:${clean}`;
  }

  /**
   * Fetch timeframe requirements for a symbol from Redis.
   * Checks timeframe:requirements:<symbol>, symbol:timeframes:<symbol>, and strategies:<symbol>.
   *
   * @param {string} symbol
   * @param {boolean} [isBacktest=false]
   * @param {string|null} [deploymentId=null]
   * @returns {Promise<string[]|null>} Array of canonical timeframes e.g. ['1m', '5m'] or null if not found
   */
  async getTimeframeRequirements(symbol, isBacktest = false, deploymentId = null) {
    if (!this.redisClient || !symbol) return null;
    const clean = String(symbol).trim().toUpperCase();

    const keysToTry = isBacktest
      ? [
          deploymentId ? `timeframe:requirements:backtest:${clean}:${deploymentId}` : null,
          `timeframe:requirements:backtest:${clean}`,
          `symbol:timeframes:backtest:${clean}`,
          `strategies:backtest:${clean}`,
        ].filter(Boolean)
      : [
          `timeframe:requirements:${clean}`,
          `symbol:timeframes:${clean}`,
          `symbol:timeframes:live:${clean}`,
          `strategies:live:${clean}`,
        ];

    for (const k of keysToTry) {
      try {
        const raw = await this.redisClient.get(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizeTimeframe);
        }
        if (parsed && Array.isArray(parsed.timeframes) && parsed.timeframes.length > 0) {
          return parsed.timeframes.map(normalizeTimeframe);
        }
        if (parsed && Array.isArray(parsed.activeStrategies)) {
          const tfs = new Set();
          for (const s of parsed.activeStrategies) {
            if (s.data_mode === 'tick') continue;
            if (Array.isArray(s.timeframes)) {
              for (const tf of s.timeframes) if (tf) tfs.add(normalizeTimeframe(tf));
            } else if (s.timeframe) {
              tfs.add(normalizeTimeframe(s.timeframe));
            }
          }
          if (tfs.size > 0) return Array.from(tfs);
        }
      } catch {
        // Continue to next fallback key
      }
    }

    return null;
  }

  /**
   * Save timeframe requirements for a symbol into Redis.
   *
   * @param {string} symbol
   * @param {string[]} timeframes
   * @param {boolean} [isBacktest=false]
   * @param {string|null} [deploymentId=null]
   */
  async saveTimeframeRequirements(symbol, timeframes, isBacktest = false, deploymentId = null) {
    if (!this.redisClient || !symbol || !Array.isArray(timeframes)) return;
    const clean = String(symbol).trim().toUpperCase();
    const normalized = timeframes.map(normalizeTimeframe);
    const reqKey = isBacktest
      ? (deploymentId ? `timeframe:requirements:backtest:${clean}:${deploymentId}` : `timeframe:requirements:backtest:${clean}`)
      : `timeframe:requirements:${clean}`;
    const aliasKey = isBacktest
      ? `symbol:timeframes:backtest:${clean}`
      : `symbol:timeframes:${clean}`;

    const serialized = JSON.stringify(normalized);
    await this.redisClient.set(reqKey, serialized);
    await this.redisClient.set(aliasKey, serialized);
  }

  /**
   * Load the symbol's intermediate timeframe state object from Redis.
   * Object structure: { [timeframe]: { currentCandle, previousCandle, lastVtt } }
   *
   * @param {string} symbol
   * @param {boolean} [isBacktest=false]
   * @param {string|null} [deploymentId=null]
   * @returns {Promise<Object>} The intermediate state object or {}
   */
  async getSymbolIntermediateState(symbol, isBacktest = false, deploymentId = null) {
    if (!this.redisClient || !symbol) return {};
    const key = this.getStateKey(symbol, isBacktest, deploymentId);
    try {
      const dataStr = await this.redisClient.get(key);
      if (!dataStr) return {};
      const parsed = JSON.parse(dataStr);
      if (parsed && typeof parsed === 'object') {
        if (parsed.aggregators && typeof parsed.aggregators === 'object') {
          return parsed.aggregators;
        }
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  /**
   * Save the symbol's intermediate timeframe state object to Redis.
   *
   * @param {string} symbol
   * @param {Object} state - { [timeframe]: { currentCandle, previousCandle, lastVtt } }
   * @param {boolean} [isBacktest=false]
   * @param {string|null} [deploymentId=null]
   * @param {number} [ttlSeconds=86400]
   */
  async saveSymbolIntermediateState(symbol, state, isBacktest = false, deploymentId = null, ttlSeconds = 86400) {
    if (!this.redisClient || !symbol || !state) return;
    const key = this.getStateKey(symbol, isBacktest, deploymentId);
    const serialized = JSON.stringify(state);

    if (typeof this.redisClient.setEx === 'function') {
      await this.redisClient.setEx(key, ttlSeconds, serialized);
    } else if (typeof this.redisClient.set === 'function') {
      await this.redisClient.set(key, serialized, { EX: ttlSeconds });
    }
  }

  /**
   * Checkpoint a symbol's timeframe state into Redis (legacy compatibility).
   */
  async saveSymbolState(symbolState, ttlSeconds = 86400) {
    if (!this.redisClient || !symbolState) return;
    const clean = String(symbolState.symbol).trim().toUpperCase();
    const aggregatorsObj = {};
    if (symbolState.aggregators instanceof Map) {
      for (const [tf, agg] of symbolState.aggregators.entries()) {
        aggregatorsObj[tf] = agg.toJSON();
      }
    } else if (symbolState.aggregators && typeof symbolState.aggregators === 'object') {
      Object.assign(aggregatorsObj, symbolState.aggregators);
    }
    await this.saveSymbolIntermediateState(clean, aggregatorsObj, false, null, ttlSeconds);
    const legacyKey = this.getKey(clean);
    const serialized = JSON.stringify({
      symbol: clean,
      snapshotVersion: symbolState.snapshotVersion || 0,
      aggregators: aggregatorsObj,
      ...aggregatorsObj,
    });
    if (typeof this.redisClient.setEx === 'function') {
      await this.redisClient.setEx(legacyKey, ttlSeconds, serialized);
    } else if (typeof this.redisClient.set === 'function') {
      await this.redisClient.set(legacyKey, serialized, { EX: ttlSeconds });
    }
  }

  /**
   * Load and hydrate a symbol's timeframe state from Redis (legacy compatibility).
   */
  async loadSymbolState(symbolState) {
    if (!this.redisClient || !symbolState) return false;
    const clean = String(symbolState.symbol).trim().toUpperCase();
    const keysToTry = [
      this.getStateKey(clean),
      this.getKey(clean),
      `timeframe_state:${clean}`,
      `timeframe:state:${clean}`,
    ];
    for (const key of keysToTry) {
      try {
        const dataStr = await this.redisClient.get(key);
        if (dataStr) {
          const data = JSON.parse(dataStr);
          if (data && typeof data === 'object') {
            if (data.aggregators && typeof data.aggregators === 'object') {
              symbolState.fromJSON(data);
            } else {
              symbolState.fromJSON({ symbol: clean, snapshotVersion: data._version || 0, aggregators: data });
            }
            return true;
          }
        }
      } catch {
        // continue
      }
    }
    return false;
  }
}
