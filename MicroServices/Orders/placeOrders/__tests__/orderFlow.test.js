import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderFlow } from '../orderFlow.js';
import { buildBrokerOrderPayload } from '../dependency.js';
import { resolveBalanceAfterLiveOrder } from '../resolveBalanceAfterLiveOrder.js';

const delay = (ms, value, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(fail) : res(value)), ms));

function makeDeps({ broker, ledger, live = async () => 1000 } = {}) {
    const log = [];
    const deps = {
        getAccessTokenFromRedis: async () => 'token',
        buildBrokerOrderPayload,
        resolveBalanceAfterLiveOrder,
        placeOrders: async () => { log.push('broker:start'); const r = await broker(); log.push('broker:end'); return r; },
        recordTradeInLedger: async () => { log.push('ledger:start'); const r = await ledger(); log.push('ledger:end'); return r; },
        getLiveAccountBalance: async () => { log.push('live'); return live(); },
        setAccountBalanceToRedis: async (acc, bal) => { log.push(`balance:${bal}`); },
    };
    return { deps, log };
}

const body = {
    client_order_id: 'c1', transaction_type: 'BUY', order_type: 'MARKET', price: 100, ltp: 100, quantity: 1,
    product: 'D', validity: 'DAY', instrument_token: 'NSE_EQ|INE002A01018', tag: 'RELIANCE',
};
const sd = { user_id: 'u1', account_id: 'a1', deployment_id: 'd1' };

describe('orderFlow live broker orders', () => {
    let errors;
    let realError;
    beforeEach(() => { errors = []; realError = console.error; console.error = (...a) => errors.push(a.join(' ')); });
    afterEach(() => { console.error = realError; });

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

    it('TC-PO-023: never writes the ledger or the balance when the broker rejects', async () => {
        const { deps, log } = makeDeps({
            broker: () => delay(5, null, new Error('rejected')),
            ledger: () => delay(5, { data: { closing_balance: 900 } }),
        });
        await assert.rejects(createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false), /rejected/);
        assert.ok(!log.includes('ledger:start'));
        assert.ok(!log.some(l => l.startsWith('balance:')));
    });

    it('TC-PO-024: writes the ledger only after the broker accepts, then stores the balance', async () => {
        const { deps, log } = makeDeps({
            broker: () => delay(5, { status: 'success' }),
            ledger: () => delay(5, { data: { closing_balance: 900 } }),
            live: async () => 900,
        });
        await createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false);
        assert.deepEqual(log.slice(0, 4), ['broker:start', 'broker:end', 'ledger:start', 'ledger:end']);
        assert.equal(log.at(-1), 'balance:900');
    });

    it('TC-PO-041: there is no parallel mode, even if ORDER_LEDGER_MODE=parallel is set', async (t) => {
        const prev = process.env.ORDER_LEDGER_MODE;
        process.env.ORDER_LEDGER_MODE = 'parallel';
        t.after(() => { if (prev === undefined) delete process.env.ORDER_LEDGER_MODE; else process.env.ORDER_LEDGER_MODE = prev; });
        const { deps, log } = makeDeps({
            broker: () => delay(20, null, new Error('rejected')),
            ledger: () => delay(1, { data: { closing_balance: 900 } }),
        });
        await assert.rejects(createOrderFlow(deps).handleLiveBrokerOrder(body, sd, false), /rejected/);
        assert.ok(!log.includes('ledger:start'), 'ledger must not start before the broker answers');
    });

    it('TC-PO-042: sends the allowlisted Upstox payload, not the raw order', async () => {
        let sent;
        const { deps } = makeDeps({ broker: () => delay(1, { status: 'success' }), ledger: () => delay(1, { data: { closing_balance: 1 } }) });
        deps.placeOrders = async (_token, payload) => { sent = JSON.parse(payload); return { status: 'success' }; };
        await createOrderFlow(deps).handleLiveBrokerOrder({ ...body, strategy_details: sd }, sd, false);
        assert.equal('strategy_details' in sent, false);
        assert.equal('client_order_id' in sent, false);
        assert.equal('ltp' in sent, false);
        assert.equal(sent.price, 0);
        assert.equal(sent.instrument_token, 'NSE_EQ|INE002A01018');
    });

    it('TC-PO-043: an invalid broker payload is rejected before the token lookup or broker call', async () => {
        const { deps, log } = makeDeps({ broker: () => delay(1, { status: 'success' }), ledger: () => delay(1, {}) });
        let tokenLookups = 0;
        deps.getAccessTokenFromRedis = async () => { tokenLookups++; return 'token'; };
        await assert.rejects(
            createOrderFlow(deps).handleLiveBrokerOrder({ ...body, product: 'CNC' }, sd, false),
            (err) => err.statusCode === 400
        );
        assert.equal(tokenLookups, 0);
        assert.equal(log.length, 0);
    });
});

describe('orderFlow internal (PAPER / BACKTEST) orders', () => {
    it('TC-PO-044: PAPER orders write the ledger and balance and never call the broker', async () => {
        const { deps, log } = makeDeps({ broker: () => { throw new Error('broker must not be called'); }, ledger: () => delay(1, { data: { closing_balance: 500 } }) });
        const msg = await createOrderFlow(deps).handleInternalOrder(body, sd, false);
        assert.match(msg, /Paper Mode/);
        assert.deepEqual(log, ['ledger:start', 'ledger:end', 'balance:500']);
    });

    it('TC-PO-045: BACKTEST orders are reported as backtest and never call the broker', async () => {
        const { deps, log } = makeDeps({ broker: () => { throw new Error('broker must not be called'); }, ledger: () => delay(1, { data: { closing_balance: 400 } }) });
        const msg = await createOrderFlow(deps).handleInternalOrder(body, sd, true);
        assert.match(msg, /Backtest Mode/);
        assert.ok(!log.includes('broker:start'));
    });
});
