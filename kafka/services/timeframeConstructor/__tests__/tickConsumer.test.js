import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TickConsumer } from '../src/consumers/tickConsumer.js';
import { SymbolStateManager } from '../src/core/symbolStateManager.js';
import { TimeframeProducer } from '../src/producers/timeframeProducer.js';

describe('TickConsumer - Production Code Tests', () => {
  it('processes incoming live tick message and produces combined timeframe snapshot', async () => {
    const published = [];
    const mockProducer = {
      async send({ topic, messages }) {
        published.push({ topic, messages });
      },
    };

    const stateManager = new SymbolStateManager();
    const tfProducer = new TimeframeProducer(mockProducer);
    const tickConsumer = new TickConsumer({
      symbolStateManager: stateManager,
      timeframeProducer: tfProducer,
      outputLiveTopic: 'timeframe_live_data',
      outputBacktestTopic: 'timeframe_backtest_data',
    });

    const liveMsg = {
      topic: 'splited-live-data',
      message: {
        key: Buffer.from('NIFTY'),
        value: Buffer.from(
          JSON.stringify({
            symbol: 'NIFTY',
            ltp: 24300,
            timestamp: '2024-07-06T03:20:05.000Z',
            ltq: 100,
          })
        ),
      },
    };

    const snapshot = await tickConsumer.handleMessage(liveMsg);
    assert.notEqual(snapshot, null);
    assert.equal(snapshot.symbol, 'NIFTY');
    assert.equal(snapshot.ltp, 24300);
    assert.ok(snapshot.timeframes['1m']);
    assert.ok(snapshot.timeframes['5m']);

    assert.equal(published.length, 1);
    assert.equal(published[0].topic, 'timeframe_live_data');
    assert.equal(published[0].messages[0].key, 'NIFTY');

    const publishedPayload = JSON.parse(published[0].messages[0].value);
    assert.equal(publishedPayload.symbol, 'NIFTY');
    assert.equal(publishedPayload.ltp, 24300);
  });

  it('preserves deployment_id and run_id when processing backtest tick message', async () => {
    const published = [];
    const mockProducer = {
      async send({ topic, messages }) {
        published.push({ topic, messages });
      },
    };

    const stateManager = new SymbolStateManager();
    const tfProducer = new TimeframeProducer(mockProducer);
    const tickConsumer = new TickConsumer({
      symbolStateManager: stateManager,
      timeframeProducer: tfProducer,
      outputLiveTopic: 'timeframe_live_data',
      outputBacktestTopic: 'timeframe_backtest_data',
      backtestInputTopic: 'backtest-stream-data',
    });

    const backtestMsg = {
      topic: 'backtest-stream-data',
      message: {
        key: Buffer.from('BANKNIFTY'),
        value: Buffer.from(
          JSON.stringify({
            symbol: 'BANKNIFTY',
            ltp: 52000,
            timestamp: '2024-07-06T03:20:05.000Z',
            deployment_id: 'dep_bt_999',
            run_id: 'run_xyz_123',
          })
        ),
      },
    };

    const snapshot = await tickConsumer.handleMessage(backtestMsg);
    assert.notEqual(snapshot, null);
    assert.equal(snapshot.symbol, 'BANKNIFTY');
    assert.equal(snapshot.deployment_id, 'dep_bt_999');
    assert.equal(snapshot.run_id, 'run_xyz_123');

    assert.equal(published.length, 1);
    assert.equal(published[0].topic, 'timeframe_backtest_data');
    assert.equal(published[0].messages[0].key, 'BANKNIFTY');
  });

  it('gracefully skips invalid or incomplete message payloads without throwing', async () => {
    const published = [];
    const mockProducer = {
      async send({ topic, messages }) {
        published.push({ topic, messages });
      },
    };

    const stateManager = new SymbolStateManager();
    const tfProducer = new TimeframeProducer(mockProducer);
    const tickConsumer = new TickConsumer({
      symbolStateManager: stateManager,
      timeframeProducer: tfProducer,
    });

    // Empty value
    assert.equal(await tickConsumer.handleMessage({ topic: 'splited-live-data', message: {} }), null);

    // Non-JSON string
    assert.equal(
      await tickConsumer.handleMessage({
        topic: 'splited-live-data',
        message: { value: Buffer.from('not-json') },
      }),
      null
    );

    // Missing required tick fields (missing LTP)
    assert.equal(
      await tickConsumer.handleMessage({
        topic: 'splited-live-data',
        message: { value: Buffer.from(JSON.stringify({ symbol: 'NIFTY' })) },
      }),
      null
    );

    assert.equal(published.length, 0);
  });
});
