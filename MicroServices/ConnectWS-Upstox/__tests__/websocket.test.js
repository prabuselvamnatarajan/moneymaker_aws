import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeSymbolsInput,
    buildSubscriptionFrame,
    calculateBackoffDelay,
    unionSymbols,
    processSymbolUpdateEvent,
    fetchAuthorizedWebSocketUrl,
} from '../wsHelpers.js';

describe('MicroServices/ConnectWS-Upstox Unit & Subscription Tests (Real Codebase)', () => {

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
        let subscribed = null;
        const event = JSON.stringify({ action: 'subscribe', instrument_token: 'NSE_EQ|INFY', userId: 'user-1' });

        processSymbolUpdateEvent(event, {
            state,
            onSubscribe: (tokens) => { subscribed = tokens; },
        });
        assert.ok(state.activeSymbols.has('NSE_EQ|INFY'));
        assert.deepEqual(subscribed, ['NSE_EQ|INFY']);
    });

    it('TC-CWS-007: handles action: "unsubscribe" event to remove instrument token', () => {
        const state = {
            activeSymbols: new Set(['NSE_EQ|INFY', 'NSE_EQ|WIPRO']),
            subscribedSymbols: new Set(['NSE_EQ|INFY']),
        };
        let unsubscribed = null;
        const event = JSON.stringify({ action: 'unsubscribe', instrument_token: 'NSE_EQ|INFY' });

        processSymbolUpdateEvent(event, {
            state,
            onUnsubscribe: (tokens) => { unsubscribed = tokens; },
        });
        assert.ok(!state.activeSymbols.has('NSE_EQ|INFY'));
        assert.ok(!state.subscribedSymbols.has('NSE_EQ|INFY'));
        assert.ok(state.activeSymbols.has('NSE_EQ|WIPRO'));
        assert.deepEqual(unsubscribed, ['NSE_EQ|INFY']);
    });

    it('TC-CWS-008: handles action: "update" to atomically replace old token with new token', () => {
        const state = {
            activeSymbols: new Set(['NSE_FO|NIFTY24DEC24000CE']),
            subscribedSymbols: new Set(['NSE_FO|NIFTY24DEC24000CE']),
        };
        const calls = [];
        const event = JSON.stringify({
            action: 'update',
            old_instrument_token: 'NSE_FO|NIFTY24DEC24000CE',
            instrument_token: 'NSE_FO|NIFTY24DEC24100CE',
        });

        processSymbolUpdateEvent(event, {
            state,
            onUnsubscribe: (tokens) => calls.push({ unsub: tokens }),
            onSubscribe: (tokens) => calls.push({ sub: tokens }),
        });
        assert.ok(!state.activeSymbols.has('NSE_FO|NIFTY24DEC24000CE'));
        assert.ok(state.activeSymbols.has('NSE_FO|NIFTY24DEC24100CE'));
        assert.deepEqual(calls, [
            { unsub: ['NSE_FO|NIFTY24DEC24000CE'] },
            { sub: ['NSE_FO|NIFTY24DEC24100CE'] },
        ]);
    });

    it('TC-CWS-009: handles malformed non-JSON messages gracefully without throwing if caught', () => {
        const state = { activeSymbols: new Set(), subscribedSymbols: new Set() };
        assert.throws(() => {
            processSymbolUpdateEvent('INVALID_NON_JSON', { state });
        }, SyntaxError);
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
        assert.equal(unsubFrame.data.mode, undefined);
        assert.deepEqual(unsubFrame.data.instrumentKeys, ['SYM_A']);
    });

    it('fetches authorized WebSocket redirect URI from Upstox authorize endpoint', async () => {
        const mockHttpClient = {
            async get(url, options) {
                assert.ok(url.includes('market-data-feed/authorize'));
                assert.equal(options.headers.Authorization, 'Bearer test_token');
                return {
                    data: {
                        status: 'success',
                        data: {
                            authorized_redirect_uri: 'wss://api.upstox.com/v3/feed/market-data-feed/feeds?code=123',
                        },
                    },
                };
            },
        };

        const uri = await fetchAuthorizedWebSocketUrl('test_token', mockHttpClient);
        assert.equal(uri, 'wss://api.upstox.com/v3/feed/market-data-feed/feeds?code=123');
    });

    it('fails fast when access token is missing in fetchAuthorizedWebSocketUrl', async () => {
        await assert.rejects(
            async () => {
                await fetchAuthorizedWebSocketUrl(null);
            },
            /Access token is required/
        );
    });
});
