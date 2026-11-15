import { validateAndNormalizeTick } from '../utils/tickValidator.js';
import { SnapshotGenerator } from '../core/snapshotGenerator.js';

/**
 * Handles incoming tick batches from splited-live-data and backtest-stream-data.
 * Stateless processing: intermediate timeframe states and dynamic timeframe requirements
 * are stored in and retrieved directly from Redis on every tick.
 */
export class TickConsumer {
  /**
   * @param {Object} options
   * @param {Object} options.symbolStateManager
   * @param {Object} options.timeframeProducer
   * @param {Object} [options.persistenceService=null]
   * @param {string} [options.outputLiveTopic='timeframe_live_data']
   * @param {string} [options.outputBacktestTopic='timeframe_backtest_data']
   * @param {string} [options.backtestInputTopic='backtest-stream-data']
   * @param {Object} [options.logger=console]
   */
  constructor({
    symbolStateManager,
    timeframeProducer,
    persistenceService = null,
    outputLiveTopic = 'timeframe_live_data',
    outputBacktestTopic = 'timeframe_backtest_data',
    backtestInputTopic = 'backtest-stream-data',
    logger = console,
  }) {
    this.stateManager = symbolStateManager;
    this.producer = timeframeProducer;
    this.persistenceService = persistenceService;
    this.outputLiveTopic = outputLiveTopic;
    this.outputBacktestTopic = outputBacktestTopic;
    this.backtestInputTopic = backtestInputTopic;
    this.logger = logger;
    this.processedCount = 0;
  }

  /**
   * Handle an incoming Kafka message.
   *
   * @param {Object} params - { topic, message: { key, value } }
   * @returns {Promise<Object|null>} Generated snapshot or null if skipped
   */
  async handleMessage({ topic, message: { key, value } }) {
    if (!value) return null;

    let data;
    try {
      data = JSON.parse(value.toString());
    } catch {
      this.logger.warn?.('Failed to parse Kafka message JSON — skipping');
      return null;
    }

    const rawKey = key ? key.toString() : '';
    const tick = validateAndNormalizeTick(data, rawKey);
    if (!tick) {
      // Incomplete or non-tick data (e.g. control signals like done)
      return null;
    }

    const isBackTest = topic === this.backtestInputTopic;
    const outputTopic = isBackTest ? this.outputBacktestTopic : this.outputLiveTopic;
    const deploymentId = data?.deployment_id || null;

    let snapshot;

    if (this.persistenceService) {
      // 1. Dynamic timeframe requirements: fetch from Redis (computed from active deployments)
      const requiredTimeframes = await this.persistenceService.getTimeframeRequirements(
        tick.symbol,
        isBackTest,
        deploymentId
      );

      // 2. Stateless intermediate state: load from Redis
      const existingState = await this.persistenceService.getSymbolIntermediateState(
        tick.symbol,
        isBackTest,
        deploymentId
      );

      // 3. Process tick statelessly using pure candle aggregation logic
      const result = this.stateManager.processTick(
        tick,
        existingState,
        requiredTimeframes
      );
      const updatedState = result.updatedState || result;
      const snapshotData = result.snapshotData || result;

      // 4. Immediately persist updated intermediate state back into Redis
      await this.persistenceService.saveSymbolIntermediateState(
        tick.symbol,
        updatedState,
        isBackTest,
        deploymentId
      );

      snapshot = SnapshotGenerator.generate(snapshotData);
    } else {
      // Offline / in-memory fallback (e.g. unit tests without Redis)
      const processed = this.stateManager.processTick(tick);
      snapshot = SnapshotGenerator.generate(processed);
    }

    // Forward backtest routing metadata if present
    if (isBackTest) {
      if (data.deployment_id) snapshot.deployment_id = data.deployment_id;
      if (data.run_id) snapshot.run_id = data.run_id;
    }

    // Produce multi-timeframe snapshot to Kafka
    await this.producer.publishSnapshot(outputTopic, snapshot);

    this.processedCount += 1;
    return snapshot;
  }
}
