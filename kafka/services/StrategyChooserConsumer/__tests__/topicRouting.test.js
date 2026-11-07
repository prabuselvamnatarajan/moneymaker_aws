import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('StrategyChooserConsumer Topic Routing & Payload Construction Tests', () => {

    function resolveTopicName(strategyName, isTestMode) {
        return isTestMode
            ? `${strategyName}_backtest_data`
            : `${strategyName}_live_data`;
    }

    function extractSymbol(data, rawKey) {
        return String(data?.symbol || data?.name || data?.symbolName || rawKey || '').toUpperCase();
    }

    function buildMessagePayload(baseData, strategy, isTestMode) {
        const strategyData = { ...baseData };
        strategyData.strategy_details = { ...strategy };
        strategyData.strategy_details.isTest = Boolean(isTestMode);
        return strategyData;
    }

    function resolvePartitionKey(symbol, strategy, isTestMode) {
        return isTestMode && strategy?.deployment_id
            ? `${symbol}:${strategy.deployment_id}`
            : symbol;
    }

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
});
