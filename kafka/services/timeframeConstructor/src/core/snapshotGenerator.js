/**
 * Generates atomic, combined multi-timeframe snapshot payloads.
 */
export class SnapshotGenerator {
  /**
   * Format an updated symbol multi-timeframe state into a standardized Kafka event.
   *
   * @param {Object} processedResult - Output of SymbolTimeframeState.processTick
   * @param {string} [prefix='tf']
   * @returns {Object} Standardized combined timeframe snapshot
   */
  static generate(processedResult, prefix = 'tf') {
    const { symbol, eventTimestamp, snapshotVersion, ltp, volume, timeframes } = processedResult;

    const safeSymbol = symbol.replace(/[^a-zA-Z0-9_-]/g, '_');
    const eventId = `${prefix}_${safeSymbol}_${eventTimestamp}_${snapshotVersion}`;

    return {
      eventId,
      symbol,
      eventTimestamp,
      snapshotVersion,
      ltp,
      volume,
      timeframes,
    };
  }
}
