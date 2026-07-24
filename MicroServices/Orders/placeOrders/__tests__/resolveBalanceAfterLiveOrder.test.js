import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBalanceAfterLiveOrder } from '../resolveBalanceAfterLiveOrder.js';

describe('resolveBalanceAfterLiveOrder', () => {
    it('keeps positive ledger when live margin is 0 (post-SELL CNC lag)', () => {
        const result = resolveBalanceAfterLiveOrder(95000, 0);
        assert.equal(result.balanceToStore, 95000);
        assert.equal(result.balanceSource, 'ledger_kept_over_zero_live');
    });

    it('uses live margin when it is positive', () => {
        const result = resolveBalanceAfterLiveOrder(95000, 120000);
        assert.equal(result.balanceToStore, 120000);
        assert.equal(result.balanceSource, 'live_available_margin');
    });

    it('falls back to ledger when live fetch failed (null)', () => {
        const result = resolveBalanceAfterLiveOrder(88000, null);
        assert.equal(result.balanceToStore, 88000);
        assert.equal(result.balanceSource, 'ledger_closing_balance');
    });

    it('stores zero live only when ledger is missing', () => {
        const result = resolveBalanceAfterLiveOrder(null, 0);
        assert.equal(result.balanceToStore, 0);
        assert.equal(result.balanceSource, 'live_available_margin_zero');
    });
});
