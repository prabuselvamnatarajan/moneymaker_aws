/**
 * Redis-backed checkpoint persistence for Timeframe Constructor.
 */
export class PersistenceService {
  /**
   * @param {Object} redisClient - Connected redis client
   * @param {string} [keyPrefix='timeframe_state']
   */
  constructor(redisClient, keyPrefix = 'timeframe_state') {
    this.redisClient = redisClient;
    this.keyPrefix = keyPrefix;
  }

  getKey(symbol) {
    const clean = String(symbol).trim().toUpperCase();
    return `${this.keyPrefix}:${clean}`;
  }

  /**
   * Checkpoint a symbol's timeframe state into Redis.
   *
   * @param {Object} symbolState - SymbolTimeframeState instance
   * @param {number} [ttlSeconds=86400] - 24 hour TTL
   */
  async saveSymbolState(symbolState, ttlSeconds = 86400) {
    if (!this.redisClient || !symbolState) return;
    const key = this.getKey(symbolState.symbol);
    const serialized = JSON.stringify(symbolState.toJSON());

    if (typeof this.redisClient.setEx === 'function') {
      await this.redisClient.setEx(key, ttlSeconds, serialized);
    } else if (typeof this.redisClient.set === 'function') {
      await this.redisClient.set(key, serialized, { EX: ttlSeconds });
    }
  }

  /**
   * Load and hydrate a symbol's timeframe state from Redis.
   *
   * @param {Object} symbolState - SymbolTimeframeState instance to hydrate
   * @returns {boolean} True if state was restored, false otherwise
   */
  async loadSymbolState(symbolState) {
    if (!this.redisClient || !symbolState) return false;
    const key = this.getKey(symbolState.symbol);
    const dataStr = await this.redisClient.get(key);
    if (!dataStr) return false;

    try {
      const data = JSON.parse(dataStr);
      symbolState.fromJSON(data);
      return true;
    } catch {
      return false;
    }
  }
}
