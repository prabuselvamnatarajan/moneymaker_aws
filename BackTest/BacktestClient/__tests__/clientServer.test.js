const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('BackTest/BacktestClient Unit Tests', () => {

    function sanitize(str) {
        return String(str).replace(/[^a-zA-Z0-9-_]/g, '_');
    }

    function validateStreamRequest(query) {
        const { symbolName, date, time_ms, deployment_id, run_id } = query || {};
        if (!symbolName || !date) {
            return { status: 400, message: 'Missing symbolName or date' };
        }

        let timeMsNum = 0;
        if (time_ms !== undefined) {
            timeMsNum = Number(time_ms);
            if (isNaN(timeMsNum) || timeMsNum < 0) {
                return { status: 400, message: 'Invalid time_ms: must be a number >= 0' };
            }
        }

        const partitionKey = `backtest-${sanitize(symbolName)}-${sanitize(date)}-${sanitize(timeMsNum)}`;
        return {
            status: 200,
            symbolName,
            date,
            timeMsNum,
            deployment_id,
            run_id,
            partitionKey,
        };
    }

    function appendMetadataToTick(rawMessage, deployment_id, run_id) {
        let msgStr = rawMessage.toString();
        if (deployment_id) {
            try {
                const parsed = JSON.parse(msgStr);
                parsed.deployment_id = deployment_id;
                if (run_id) {
                    parsed.run_id = run_id;
                }
                msgStr = JSON.stringify(parsed);
            } catch (err) {
                // Return original string if parse fails
            }
        }
        return msgStr;
    }

    it('rejects requests missing symbolName or date (400)', () => {
        assert.equal(validateStreamRequest({ date: '2024-01-01' }).status, 400);
        assert.equal(validateStreamRequest({ symbolName: 'NIFTY' }).status, 400);
        assert.equal(validateStreamRequest({}).status, 400);
    });

    it('rejects invalid or negative time_ms (400)', () => {
        assert.equal(validateStreamRequest({ symbolName: 'NIFTY', date: '2024-01-01', time_ms: -5 }).status, 400);
        assert.equal(validateStreamRequest({ symbolName: 'NIFTY', date: '2024-01-01', time_ms: 'invalid' }).status, 400);
    });

    it('accepts valid request and defaults time_ms to 0', () => {
        const res = validateStreamRequest({ symbolName: 'NIFTY', date: '2024-01-01' });
        assert.equal(res.status, 200);
        assert.equal(res.timeMsNum, 0);
        assert.equal(res.partitionKey, 'backtest-NIFTY-2024-01-01-0');
    });

    it('generates sanitized partition key for Kafka messages', () => {
        const res = validateStreamRequest({
            symbolName: 'NSE_EQ|INE002A01018',
            date: '2024-01-01',
            time_ms: 100,
        });
        assert.equal(res.status, 200);
        assert.equal(res.partitionKey, 'backtest-NSE_EQ_INE002A01018-2024-01-01-100');
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
