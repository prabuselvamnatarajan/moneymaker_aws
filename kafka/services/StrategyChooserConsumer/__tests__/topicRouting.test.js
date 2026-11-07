import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveTopicName,
    extractSymbol,
    buildMessagePayload,
    resolvePartitionKey,
    filterBacktestStrategies,
} from '../topicRoutingHelper.js';

describe('StrategyChooserConsumer Topic Routing & Payload Construction Tests (Real Codebase)', () => {

    it('resolves correct Kafka topic for backtest and live modes', () => {
        assert.equal(resolveTopicName('MSB', true), 'MSB_backtest_data');
        assert.equal(resolveTopicName('MSB', false), 'MSB_live_data');
        assert.equal(resolveTopicName('liquidity_sweep', true), 'liquidity_sweep_backtest_data');
        assert.equal(resolveTopicName('liquidity_sweep', false), 'liquidity_sweep_live_data');
    });

    it('extracts symbol adhering to fallback priority and converts to uppercase', () => {
        assert.equal(extractSymbol({ symbol: 'tcs' }, 'key'), 'TCS');
        assert.equal(extractSymbol({ name: 'infy' }, 'key'), 'INFY');
        assert.equal(extractSymbol({ symbolName: 'reliance' }, 'key'), 'RELIANCE');
        assert.equal(extractSymbol({}, 'fallback_key'), 'FALLBACK_KEY');
    });

    it('clones payload immutably to prevent parallel mutation race conditions', () => {
        const base = { ltp: 24000, timestamp: 1700000000 };
        const stratA = { name: 'MSB', deployment_id: 'dep_A' };
        const stratB = { name: 'MSB', deployment_id: 'dep_B' };

        const payloadA = buildMessagePayload(base, stratA, true);
        const payloadB = buildMessagePayload(base, stratB, false);

        assert.equal(payloadA.strategy_details.deployment_id, 'dep_A');
        assert.equal(payloadA.strategy_details.isTest, true);

        assert.equal(payloadB.strategy_details.deployment_id, 'dep_B');
        assert.equal(payloadB.strategy_details.isTest, false);

        // Ensure base is not mutated
        assert.equal(base.strategy_details, undefined);
    });

    it('constructs partition key isolating parallel backtest deployments', () => {
        const strat1 = { deployment_id: 'dep_1' };
        const strat2 = { deployment_id: 'dep_2' };

        const key1 = resolvePartitionKey('NIFTY', strat1, true);
        const key2 = resolvePartitionKey('NIFTY', strat2, true);
        assert.equal(key1, 'NIFTY:dep_1');
        assert.equal(key2, 'NIFTY:dep_2');
        assert.notEqual(key1, key2);

        // Live mode uses shared symbol key
        const liveKey = resolvePartitionKey('NIFTY', strat1, false);
        assert.equal(liveKey, 'NIFTY');
    });

    it('filters backtest strategies by deployment_id and validates run_id freshness', () => {
        const strategies = [
            { deployment_id: 'dep_1', backtest_run_id: 'run_100' },
            { deployment_id: 'dep_1', backtest_run_id: 'run_99' },
            { deployment_id: 'dep_2', backtest_run_id: 'run_100' },
        ];

        // Matching deployment_id and run_id
        const filtered = filterBacktestStrategies(strategies, { deployment_id: 'dep_1', run_id: 'run_100' });
        assert.equal(filtered.length, 1);
        assert.equal(filtered[0].backtest_run_id, 'run_100');

        // Missing deployment_id returns empty array
        assert.deepEqual(filterBacktestStrategies(strategies, {}), []);
    });
});
