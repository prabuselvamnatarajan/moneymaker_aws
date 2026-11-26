import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderFlow } from '../orderFlow.js';
import { buildBrokerOrderPayload } from '../dependency.js';
import { resolveBalanceAfterLiveOrder } from '../resolveBalanceAfterLiveOrder.js';

const delay = (ms, value, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(fail) : res(value)), ms));

function makeDeps({ mode = 'parallel', broker, ledger, live = async () => 1000 } = {}) {
    const log = [];
    const deps = {
        getAccessTokenFromRedis: async () => 'token',
        buildBrokerOrderPayload,
        resolveBalanceAfterLiveOrder,
        resolveLedgerMode: () => mode,
        placeOrders: async () => { log.push('broker:start'); const r = await broker(); log.push('broker:end'); return r; },
        recordTradeInLedger: async () => { log.push('ledger:start'); const r = await ledger(); log.push('ledger:end'); return r; },
        getLiveAccountBalance: async () => { log.push('live'); return live(); },
        setAccountBalanceToRedis: async (acc, bal) => { log.push(`balance:${bal}`); },
    };
    return { deps, log };
}

const body = { client_order_id: 'c1', transaction_type: 'BUY', order_type: 'MARKET', price: 100, ltp: 100, quantity: 1 };
const sd = { user_id: 'u1', account_id: 'a1', deployment_id: 'd1' };

describe('orderFlow live broker orders', () => {
    let errors;
    let realError;
    beforeEach(() => { errors = []; realError = console.error; console.error = (...a) => errors.push(a.join(' ')); });
    afterEach(() => { console.error = realError; });

    it('TC-PO-020: parallel mode starts broker and ledger together and stores balance before returning', async () => {
        const { deps, log } = makeDeps({
            broker: () => delay(30, { status: 'success' }),
            ledger: () => delay(10, { data: { closing_balance: 900 } }),
            live: async () => 900,
        });
        const result = await createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false);
        assert.deepEqual(result, { status: 'success' });
        assert.deepEqual(log.slice(0, 2).sort(), ['broker:start', 'ledger:start']);
        assert.equal(log.at(-1), 'balance:900');
    });

    it('TC-PO-021: parallel mode rethrows a broker rejection and flags the orphaned ledger trade', async () => {
        const { deps, log } = makeDeps({
            broker: () => delay(5, null, Object.assign(new Error('rejected'), { statusCode: 502 })),
            ledger: () => delay(5, { data: { closing_balance: 900 } }),
        });
        await assert.rejects(createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false), /rejected/);
        assert.ok(errors.some(e => e.includes('CRITICAL') && e.includes('c1')));
        assert.ok(!log.some(l => l.startsWith('balance:')));
    });

    it('TC-PO-022: broker success with ledger failure still returns success and uses live balance', async () => {
        const { deps, log } = makeDeps({
            broker: () => delay(5, { status: 'success' }),
            ledger: () => delay(5, null, new Error('mongo down')),
            live: async () => 750,
        });
        const result = await createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false);
        assert.deepEqual(result, { status: 'success' });
        assert.ok(errors.some(e => e.includes('ledger write failed')));
        assert.equal(log.at(-1), 'balance:750');
    });

    it('TC-PO-023: sequential mode never writes the ledger when the broker rejects', async () => {
        const { deps, log } = makeDeps({
            mode: 'sequential',
            broker: () => delay(5, null, new Error('rejected')),
            ledger: () => delay(5, { data: { closing_balance: 900 } }),
        });
        await assert.rejects(createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false), /rejected/);
        assert.ok(!log.includes('ledger:start'));
    });

    it('TC-PO-024: sequential mode writes the ledger only after the broker accepts', async () => {
        const { deps, log } = makeDeps({
            mode: 'sequential',
            broker: () => delay(5, { status: 'success' }),
            ledger: () => delay(5, { data: { closing_balance: 900 } }),
            live: async () => 900,
        });
        await createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false);
        assert.deepEqual(log.slice(0, 4), ['broker:start', 'broker:end', 'ledger:start', 'ledger:end']);
    });
});
