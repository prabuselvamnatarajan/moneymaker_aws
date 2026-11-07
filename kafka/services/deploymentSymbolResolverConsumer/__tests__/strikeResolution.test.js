import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('deploymentSymbolResolverConsumer Reference Strike & Throttle Tests', () => {

    function computeReferenceStrike(ltp, strikePriceDiff) {
        const diff = Number(strikePriceDiff);
        const price = Number(ltp);
        if (!(diff > 0) || !(price > 0)) return null;
        return Math.round(price / diff) * diff;
    }

    function shouldTriggerResolve(dep, ltp, now, lastResolveAt, throttleMs = 5000) {
        const strikeDiff = Number(dep.strike_price_diff);
        if (!(strikeDiff > 0)) return false;
        if (dep.pending_resolve) return false;

        const referenceStrike = computeReferenceStrike(ltp, strikeDiff);
        if (referenceStrike == null) return false;

        if (dep.last_resolved_strike != null && Number(dep.last_resolved_strike) === referenceStrike) {
            return false;
        }

        const last = lastResolveAt.get(dep.deployment_id) || 0;
        if (now - last < throttleMs) {
            return false;
        }

        return true;
    }

    it('computes ATM reference strike rounded to strikePriceDiff multiple', () => {
        // Nifty diff 50
        assert.equal(computeReferenceStrike(24024.9, 50), 24000);
        assert.equal(computeReferenceStrike(24025.1, 50), 24050);
        assert.equal(computeReferenceStrike(24050, 50), 24050);

        // BankNifty diff 100
        assert.equal(computeReferenceStrike(51249, 100), 51200);
        assert.equal(computeReferenceStrike(51251, 100), 51300);
    });

    it('returns null for non-positive or invalid LTP and strike diffs', () => {
        assert.equal(computeReferenceStrike(0, 50), null);
        assert.equal(computeReferenceStrike(-100, 50), null);
        assert.equal(computeReferenceStrike(24000, 0), null);
        assert.equal(computeReferenceStrike(24000, -50), null);
        assert.equal(computeReferenceStrike('abc', 50), null);
        assert.equal(computeReferenceStrike(24000, null), null);
    });

    it('skips resolve when pending_resolve is already true', () => {
        const dep = { deployment_id: 'd1', strike_price_diff: 50, pending_resolve: true, last_resolved_strike: 23900 };
        const lastResolve = new Map();
        assert.equal(shouldTriggerResolve(dep, 24000, 10000, lastResolve), false);
    });

    it('skips resolve when referenceStrike matches last_resolved_strike', () => {
        const dep = { deployment_id: 'd1', strike_price_diff: 50, pending_resolve: false, last_resolved_strike: 24000 };
        const lastResolve = new Map();
        assert.equal(shouldTriggerResolve(dep, 24010, 10000, lastResolve), false);
    });

    it('skips resolve when called within throttle window', () => {
        const dep = { deployment_id: 'd1', strike_price_diff: 50, pending_resolve: false, last_resolved_strike: 23900 };
        const lastResolve = new Map([['d1', 8000]]);
        // now = 10000, diff = 2000 < throttleMs (5000)
        assert.equal(shouldTriggerResolve(dep, 24000, 10000, lastResolve, 5000), false);
    });

    it('triggers resolve when strike changes and throttle window has elapsed', () => {
        const dep = { deployment_id: 'd1', strike_price_diff: 50, pending_resolve: false, last_resolved_strike: 23900 };
        const lastResolve = new Map([['d1', 2000]]);
        // now = 10000, diff = 8000 >= throttleMs (5000)
        assert.equal(shouldTriggerResolve(dep, 24000, 10000, lastResolve, 5000), true);
    });
});
