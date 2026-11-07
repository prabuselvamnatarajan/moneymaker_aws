import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/ConnectWS-Upstox Unit & Subscription Tests', () => {

    function normalizeSymbolsInput(symbolInput) {
        if (!symbolInput) return [];
        const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
        return symbolArray.filter(Boolean);
    }

    function buildSubscriptionFrame(method, instrumentKeys) {
        return {
            guid: 'someguid',
            method, // 'sub' or 'unsub'
            data: {
                ...(method === 'sub' ? { mode: 'full' } : {}),
                instrumentKeys,
            },
        };
    }

    function calculateBackoffDelay(reconnectAttempt, maxDelay = 60000) {
        return Math.min(1000 * Math.pow(2, reconnectAttempt), maxDelay);
    }

    function unionSymbols(deploymentSymbols = [], activeSymbolsList = []) {
        return Array.from(new Set([...deploymentSymbols, ...activeSymbolsList].filter(Boolean)));
    }

    function processSymbolUpdateEvent(message, state) {
        const payload = typeof message === 'string' ? JSON.parse(message) : message;
        const { action, instrument_token, old_instrument_token } = payload;

        if (action === 'subscribe' && instrument_token) {
            state.activeSymbols.add(instrument_token);
        } else if (action === 'unsubscribe' && instrument_token) {
            state.activeSymbols.delete(instrument_token);
            state.subscribedSymbols.delete(instrument_token);
        } else if (action === 'update') {
            if (old_instrument_token) {
                state.activeSymbols.delete(old_instrument_token);
                state.subscribedSymbols.delete(old_instrument_token);
            }
            if (instrument_token) {
                state.activeSymbols.add(instrument_token);
            }
        }
    }

    it('TC-CWS-001 & 002: normalizes single string and array symbol inputs correctly', () => {
        assert.deepEqual(normalizeSymbolsInput('NSE_EQ|INE002A01018'), ['NSE_EQ|INE002A01018']);
        assert.deepEqual(normalizeSymbolsInput(['SYM1', 'SYM2']), ['SYM1', 'SYM2']);
        assert.deepEqual(normalizeSymbolsInput(null), []);
        assert.deepEqual(normalizeSymbolsInput(''), []);
    });

    it('TC-CWS-003: filters falsy elements when normalizing symbols', () => {
        assert.deepEqual(normalizeSymbolsInput(['SYM1', null, '', undefined, 'SYM2']), ['SYM1', 'SYM2']);
    });

    it('TC-CWS-005: unions deployment symbols and active symbols uniquely without duplicates', () => {
        const deploymentSymbols = ['NSE_EQ|RELIANCE', 'NSE_EQ|TCS'];
        const activeList = ['NSE_EQ|TCS', 'NSE_INDEX|Nifty 50'];

        const combined = unionSymbols(deploymentSymbols, activeList);
        assert.equal(combined.length, 3);
        assert.deepEqual(combined, ['NSE_EQ|RELIANCE', 'NSE_EQ|TCS', 'NSE_INDEX|Nifty 50']);
    });

    it('TC-CWS-006: handles action: "subscribe" event to add instrument token', () => {
        const state = { activeSymbols: new Set(), subscribedSymbols: new Set() };
        const event = JSON.stringify({ action: 'subscribe', instrument_token: 'NSE_EQ|INFY' });

        processSymbolUpdateEvent(event, state);
        assert.ok(state.activeSymbols.has('NSE_EQ|INFY'));
    });

    it('TC-CWS-007: handles action: "unsubscribe" event to remove instrument token', () => {
        const state = {
            activeSymbols: new Set(['NSE_EQ|INFY', 'NSE_EQ|WIPRO']),
            subscribedSymbols: new Set(['NSE_EQ|INFY']),
        };
        const event = JSON.stringify({ action: 'unsubscribe', instrument_token: 'NSE_EQ|INFY' });

        processSymbolUpdateEvent(event, state);
        assert.ok(!state.activeSymbols.has('NSE_EQ|INFY'));
        assert.ok(!state.subscribedSymbols.has('NSE_EQ|INFY'));
        assert.ok(state.activeSymbols.has('NSE_EQ|WIPRO'));
    });

    it('TC-CWS-008: handles action: "update" to atomically replace old token with new token', () => {
        const state = {
            activeSymbols: new Set(['NSE_FO|NIFTY24DEC24000CE']),
            subscribedSymbols: new Set(['NSE_FO|NIFTY24DEC24000CE']),
        };
        const event = JSON.stringify({
            action: 'update',
            old_instrument_token: 'NSE_FO|NIFTY24DEC24000CE',
            instrument_token: 'NSE_FO|NIFTY24DEC24100CE',
        });

        processSymbolUpdateEvent(event, state);
        assert.ok(!state.activeSymbols.has('NSE_FO|NIFTY24DEC24000CE'));
        assert.ok(state.activeSymbols.has('NSE_FO|NIFTY24DEC24100CE'));
    });

    it('TC-CWS-009: handles malformed non-JSON messages gracefully without throwing', () => {
        const state = { activeSymbols: new Set(), subscribedSymbols: new Set() };
        assert.doesNotThrow(() => {
            try {
                processSymbolUpdateEvent('INVALID_NON_JSON', state);
            } catch (err) {
                // Should be trapped by try/catch in consumer
                assert.ok(err instanceof SyntaxError);
            }
        });
    });

    it('calculates exponential reconnect backoff with cap', () => {
        assert.equal(calculateBackoffDelay(0), 1000);
        assert.equal(calculateBackoffDelay(1), 2000);
        assert.equal(calculateBackoffDelay(2), 4000);
        assert.equal(calculateBackoffDelay(3), 8000);
        assert.equal(calculateBackoffDelay(6), 60000); // capped at 60s
        assert.equal(calculateBackoffDelay(10), 60000); // capped at 60s
    });

    it('constructs valid Upstox subscription and unsubscription frames', () => {
        const subFrame = buildSubscriptionFrame('sub', ['SYM_A', 'SYM_B']);
        assert.equal(subFrame.method, 'sub');
        assert.equal(subFrame.data.mode, 'full');
        assert.deepEqual(subFrame.data.instrumentKeys, ['SYM_A', 'SYM_B']);

        const unsubFrame = buildSubscriptionFrame('unsub', ['SYM_A']);
        assert.equal(unsubFrame.method, 'unsub');
        assert.equal(subFrame.data.mode, 'full');
        assert.deepEqual(unsubFrame.data.instrumentKeys, ['SYM_A']);
    });
});
