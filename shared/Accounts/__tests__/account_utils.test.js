import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveAccountBalanceKey,
    resolveBoughtQuantityKey,
    resolveShortQuantityKey,
    resolveOrderLockKey,
} from '../account_utils.js';

describe('shared/Accounts account_utils logic & key resolution', () => {

    it('resolves account balance key: isolated by deploymentId in backtest mode', () => {
        const key = resolveAccountBalanceKey('acc_123', 'dep_456', true);
        assert.equal(key, 'account_balance:dep_456');
    });

    it('resolves account balance key: uses account_id in live and paper mode even if deploymentId is given', () => {
        const liveKey = resolveAccountBalanceKey('acc_123', 'dep_456', false);
        assert.equal(liveKey, 'account_balance:acc_123');
    });

    it('resolves account balance key: falls back to account_id if deploymentId is empty in backtest mode', () => {
        const key = resolveAccountBalanceKey('acc_123', null, true);
        assert.equal(key, 'account_balance:acc_123');
    });

    it('resolves bought_quantity key with deploymentId prefix when available', () => {
        assert.equal(resolveBoughtQuantityKey('BUY_NIFTY', 'dep_100'), 'bought_quantity:dep_100:BUY_NIFTY');
        assert.equal(resolveBoughtQuantityKey('BUY_NIFTY', null), 'bought_quantity:BUY_NIFTY');
    });

    it('resolves short_quantity key with deploymentId prefix when available', () => {
        assert.equal(resolveShortQuantityKey('SHORT_NIFTY', 'dep_200'), 'short_quantity:dep_200:SHORT_NIFTY');
        assert.equal(resolveShortQuantityKey('SHORT_NIFTY', undefined), 'short_quantity:SHORT_NIFTY');
    });

    it('resolves pending_order lock key with deploymentId prefix when available', () => {
        assert.equal(resolveOrderLockKey('LOCK_NIFTY', 'dep_300'), 'pending_order:dep_300:LOCK_NIFTY');
        assert.equal(resolveOrderLockKey('LOCK_NIFTY', ''), 'pending_order:LOCK_NIFTY');
    });

    it('prevents parallel backtests on same account from colliding on balance key', () => {
        const backtestA = resolveAccountBalanceKey('shared_acc', 'dep_A', true);
        const backtestB = resolveAccountBalanceKey('shared_acc', 'dep_B', true);
        assert.notEqual(backtestA, backtestB);
    });

    it('allows concurrent live strategies on same account to share live ledger balance key', () => {
        const liveA = resolveAccountBalanceKey('shared_acc', 'dep_A', false);
        const liveB = resolveAccountBalanceKey('shared_acc', 'dep_B', false);
        assert.equal(liveA, liveB);
        assert.equal(liveA, 'account_balance:shared_acc');
    });
});
