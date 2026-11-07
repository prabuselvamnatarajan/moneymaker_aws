import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveChannel,
    createSubscriptionManager,
} from '../subscriptionManager.js';

describe('streamToClient Channel Management & Subscription Lifecycle Tests (Real Codebase)', () => {

    it('resolves correct channel name for live and backtest modes', () => {
        assert.equal(resolveChannel({ action: 'subscribe', mode: 'live', symbol: 'NIFTY' }), 'live:NIFTY');
        assert.equal(resolveChannel({ action: 'subscribe', mode: 'backtest', symbol: 'NIFTY' }), 'backtest:NIFTY');
    });

    it('rejects invalid messages missing action, mode, or symbol', () => {
        assert.equal(resolveChannel(null), null);
        assert.equal(resolveChannel({ mode: 'live', symbol: 'NIFTY' }), null);
        assert.equal(resolveChannel({ action: 'subscribe', symbol: 'NIFTY' }), null);
        assert.equal(resolveChannel({ action: 'subscribe', mode: 'live' }), null);
    });

    it('subscribes clients to channels and manages multi-socket distribution', async () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('client_1', {});
        mgr.addClient('client_2', {});

        await mgr.subscribe('client_1', 'live:TCS');
        await mgr.subscribe('client_2', 'live:TCS');
        await mgr.subscribe('client_1', 'live:INFY');

        assert.equal(mgr.channelSubscriptions.get('live:TCS').size, 2);
        assert.equal(mgr.channelSubscriptions.get('live:INFY').size, 1);
        assert.equal(mgr.socketSubscriptions.get('client_1').size, 2);
    });

    it('unsubscribes client and cleans up empty channels automatically', async () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('c1', {});
        await mgr.subscribe('c1', 'live:RELIANCE');

        assert.ok(mgr.channelSubscriptions.has('live:RELIANCE'));
        await mgr.unsubscribe('c1', 'live:RELIANCE');
        assert.equal(mgr.channelSubscriptions.has('live:RELIANCE'), false, 'empty channel should be pruned');
    });

    it('cleans up all subscriptions upon socket disconnection', async () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('c1', {});
        mgr.addClient('c2', {});

        await mgr.subscribe('c1', 'live:SYM1');
        await mgr.subscribe('c1', 'live:SYM2');
        await mgr.subscribe('c2', 'live:SYM2');

        await mgr.removeClient('c1');

        assert.equal(mgr.sockets.has('c1'), false);
        assert.equal(mgr.socketSubscriptions.has('c1'), false);
        assert.equal(mgr.channelSubscriptions.has('live:SYM1'), false, 'SYM1 should be pruned');
        assert.equal(mgr.channelSubscriptions.get('live:SYM2').size, 1);
        assert.ok(mgr.channelSubscriptions.get('live:SYM2').has('c2'));
    });
});
