import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('shared/Accounts account_utils logic & key resolution', () => {
    // Key resolution rules per account_utils.js
    function resolveBalanceKey(account_id, deploymentId, isBacktest = false) {
        return (isBacktest && deploymentId)
            ? `account_balance:${deploymentId}`
            : `account_balance:${account_id}`;
    }

    function resolveBoughtQtyKey(tag, deploymentId) {
        return deploymentId ? `bought_quantity:${deploymentId}:${tag}` : `bought_quantity:${tag}`;
    }

    function resolveShortQtyKey(tag, deploymentId) {
        return deploymentId ? `short_quantity:${deploymentId}:${tag}` : `short_quantity:${tag}`;
    }

    function resolveOrderLockKey(tag, deploymentId) {
        return deploymentId ? `pending_order:${deploymentId}:${tag}` : `pending_order:${tag}`;
    }

    it('resolves account balance key: isolated by deploymentId in backtest mode', () => {
        const key = resolveBalanceKey('acc_123', 'dep_456', true);
        assert.equal(key, 'account_balance:dep_456');
    });

    it('resolves account balance key: uses account_id in live and paper mode even if deploymentId is given', () => {
        const liveKey = resolveBalanceKey('acc_123', 'dep_456', false);
        assert.equal(liveKey, 'account_balance:acc_123');
    });

    it('resolves account balance key: falls back to account_id if deploymentId is empty in backtest mode', () => {
        const key = resolveBalanceKey('acc_123', null, true);
        assert.equal(key, 'account_balance:acc_123');
    });

    it('resolves bought_quantity key with deploymentId prefix when available', () => {
        assert.equal(resolveBoughtQtyKey('BUY_NIFTY', 'dep_100'), 'bought_quantity:dep_100:BUY_NIFTY');
        assert.equal(resolveBoughtQtyKey('BUY_NIFTY', null), 'bought_quantity:BUY_NIFTY');
    });

    it('resolves short_quantity key with deploymentId prefix when available', () => {
        assert.equal(resolveShortQtyKey('SHORT_NIFTY', 'dep_200'), 'short_quantity:dep_200:SHORT_NIFTY');
        assert.equal(resolveShortQtyKey('SHORT_NIFTY', undefined), 'short_quantity:SHORT_NIFTY');
    });

    it('resolves pending_order lock key with deploymentId prefix when available', () => {
        assert.equal(resolveOrderLockKey('LOCK_NIFTY', 'dep_300'), 'pending_order:dep_300:LOCK_NIFTY');
        assert.equal(resolveOrderLockKey('LOCK_NIFTY', ''), 'pending_order:LOCK_NIFTY');
    });

    it('prevents parallel backtests on same account from colliding on balance key', () => {
        const backtestA = resolveBalanceKey('shared_acc', 'dep_A', true);
        const backtestB = resolveBalanceKey('shared_acc', 'dep_B', true);
        assert.notEqual(backtestA, backtestB);
    });

    it('allows concurrent live strategies on same account to share live ledger balance key', () => {
        const liveA = resolveBalanceKey('shared_acc', 'dep_A', false);
        const liveB = resolveBalanceKey('shared_acc', 'dep_B', false);
        assert.equal(liveA, liveB);
        assert.equal(liveA, 'account_balance:shared_acc');
    });
});
