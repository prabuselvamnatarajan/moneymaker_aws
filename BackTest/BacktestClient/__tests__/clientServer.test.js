const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, validateStreamQuery, appendMetadataToTick } = require('../streamHelper.js');

describe('BackTest/BacktestClient Unit Tests (Real Codebase)', () => {

    it('rejects requests missing symbolName or date (400)', () => {
        assert.equal(validateStreamQuery({ date: '2024-01-01' }).status, 400);
        assert.equal(validateStreamQuery({ symbolName: 'NIFTY' }).status, 400);
        assert.equal(validateStreamQuery({}).status, 400);
    });

    it('rejects invalid or negative time_ms (400)', () => {
        assert.equal(validateStreamQuery({ symbolName: 'NIFTY', date: '2024-01-01', time_ms: -5 }).status, 400);
        assert.equal(validateStreamQuery({ symbolName: 'NIFTY', date: '2024-01-01', time_ms: 'invalid' }).status, 400);
    });

    it('accepts valid request and defaults time_ms to 0', () => {
        const res = validateStreamQuery({ symbolName: 'NIFTY', date: '2024-01-01' });
        assert.equal(res.status, 200);
        assert.equal(res.value.timeMsNum, 0);
        assert.equal(res.value.partitionKey, 'backtest-NIFTY-2024-01-01-0');
    });

    it('generates sanitized partition key for Kafka messages', () => {
        const res = validateStreamQuery({
            symbolName: 'NSE_EQ|INE002A01018',
            date: '2024-01-01',
            time_ms: 100,
        });
        assert.equal(res.status, 200);
        assert.equal(res.value.partitionKey, 'backtest-NSE_EQ_INE002A01018-2024-01-01-100');
    });

    it('appends deployment_id and run_id to outgoing tick JSON', () => {
        const tick = JSON.stringify({ ltp: 100 });
        const enrichedStr = appendMetadataToTick(tick, 'dep_abc', 'run_xyz');
        const enriched = JSON.parse(enrichedStr);
        assert.equal(enriched.ltp, 100);
        assert.equal(enriched.deployment_id, 'dep_abc');
        assert.equal(enriched.run_id, 'run_xyz');
    });

    it('handles malformed tick gracefully when appending metadata', () => {
        const malformed = 'NOT_JSON';
        const result = appendMetadataToTick(malformed, 'dep_1', 'run_1');
        assert.equal(result, 'NOT_JSON');
    });
});
