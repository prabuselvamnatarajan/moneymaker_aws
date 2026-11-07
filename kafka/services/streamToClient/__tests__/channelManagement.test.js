import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('streamToClient Channel Management & Subscription Lifecycle Tests', () => {

    function resolveChannel(msg, livePrefix = 'live', backtestPrefix = 'backtest') {
        if (!msg || !msg.action || !msg.mode || !msg.symbol) {
            return null;
        }
        const mode = msg.mode === 'live' ? livePrefix : backtestPrefix;
        return `${mode}:${msg.symbol}`;
    }

    function createSubscriptionManager() {
        const sockets = new Map();
        const socketSubscriptions = new Map();
        const channelSubscriptions = new Map();

        function addClient(socketId, ws) {
            sockets.set(socketId, ws);
            socketSubscriptions.set(socketId, new Set());
        }

        function subscribe(socketId, channel) {
            if (!channelSubscriptions.has(channel)) {
                channelSubscriptions.set(channel, new Set());
            }
            channelSubscriptions.get(channel).add(socketId);
            socketSubscriptions.get(socketId)?.add(channel);
        }

        function unsubscribe(socketId, channel) {
            channelSubscriptions.get(channel)?.delete(socketId);
            socketSubscriptions.get(socketId)?.delete(channel);
            if (channelSubscriptions.get(channel)?.size === 0) {
                channelSubscriptions.delete(channel);
            }
        }

        function removeClient(socketId) {
            const channels = socketSubscriptions.get(socketId) || [];
            for (const ch of channels) {
                channelSubscriptions.get(ch)?.delete(socketId);
                if (channelSubscriptions.get(ch)?.size === 0) {
                    channelSubscriptions.delete(ch);
                }
            }
            socketSubscriptions.delete(socketId);
            sockets.delete(socketId);
        }

        return {
            sockets,
            socketSubscriptions,
            channelSubscriptions,
            addClient,
            subscribe,
            unsubscribe,
            removeClient,
        };
    }

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

    it('subscribes clients to channels and manages multi-socket distribution', () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('client_1', {});
        mgr.addClient('client_2', {});

        mgr.subscribe('client_1', 'live:TCS');
        mgr.subscribe('client_2', 'live:TCS');
        mgr.subscribe('client_1', 'live:INFY');

        assert.equal(mgr.channelSubscriptions.get('live:TCS').size, 2);
        assert.equal(mgr.channelSubscriptions.get('live:INFY').size, 1);
        assert.equal(mgr.socketSubscriptions.get('client_1').size, 2);
    });

    it('unsubscribes client and cleans up empty channels automatically', () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('c1', {});
        mgr.subscribe('c1', 'live:RELIANCE');

        assert.ok(mgr.channelSubscriptions.has('live:RELIANCE'));
        mgr.unsubscribe('c1', 'live:RELIANCE');
        assert.equal(mgr.channelSubscriptions.has('live:RELIANCE'), false, 'empty channel should be pruned');
    });

    it('cleans up all subscriptions upon socket disconnection', () => {
        const mgr = createSubscriptionManager();
        mgr.addClient('c1', {});
        mgr.addClient('c2', {});

        mgr.subscribe('c1', 'live:SYM1');
        mgr.subscribe('c1', 'live:SYM2');
        mgr.subscribe('c2', 'live:SYM2');

        mgr.removeClient('c1');

        assert.equal(mgr.sockets.has('c1'), false);
        assert.equal(mgr.socketSubscriptions.has('c1'), false);
        assert.equal(mgr.channelSubscriptions.has('live:SYM1'), false, 'SYM1 should be pruned');
        assert.equal(mgr.channelSubscriptions.get('live:SYM2').size, 1);
        assert.ok(mgr.channelSubscriptions.get('live:SYM2').has('c2'));
    });
});
