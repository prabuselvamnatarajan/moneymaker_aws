import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLatency } from '../latencyUtil.js';

describe('shared/utils latencyUtil - calculateLatency', () => {
    it('returns null for null, undefined, or non-object inputs', () => {
        assert.equal(calculateLatency('SYM', null), null);
        assert.equal(calculateLatency('SYM', undefined), null);
        assert.equal(calculateLatency('SYM', 'string_payload'), null);
        assert.equal(calculateLatency('SYM', 12345), null);
    });

    it('returns null when feed has no timestamp', () => {
        assert.equal(calculateLatency('SYM', {}), null);
        assert.equal(calculateLatency('SYM', { fullFeed: { marketFF: {} } }), null);
        assert.equal(calculateLatency('SYM', { ltpc: {} }), null);
    });

    it('returns null when timestamp is not a finite number', () => {
        assert.equal(calculateLatency('SYM', { fullFeed: { marketFF: { ltpc: { ltt: 'not-a-number' } } } }), null);
        assert.equal(calculateLatency('SYM', { ltpc: { ltt: NaN } }), null);
    });

    it('extracts timestamp from fullFeed.marketFF.ltpc.ltt', () => {
        const now = Date.now();
        const tickTime = now - 150;
        const msg = { fullFeed: { marketFF: { ltpc: { ltt: tickTime } } } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 140 && latency <= 500);
    });

    it('extracts timestamp from fullFeed.indexFF.ltpc.ltt', () => {
        const now = Date.now();
        const tickTime = now - 200;
        const msg = { fullFeed: { indexFF: { ltpc: { ltt: String(tickTime) } } } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 190 && latency <= 500);
    });

    it('extracts timestamp from direct marketFF', () => {
        const now = Date.now();
        const tickTime = now - 50;
        const msg = { marketFF: { ltpc: { ltt: tickTime } } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 40 && latency <= 300);
    });

    it('extracts timestamp from direct indexFF', () => {
        const now = Date.now();
        const tickTime = now - 75;
        const msg = { indexFF: { ltpc: { ltt: tickTime } } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 65 && latency <= 300);
    });

    it('extracts timestamp from root ltpc', () => {
        const now = Date.now();
        const tickTime = now - 30;
        const msg = { ltpc: { ltt: tickTime } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 20 && latency <= 200);
    });

    it('extracts timestamp from firstLevelWithGreeks.ltpc', () => {
        const now = Date.now();
        const tickTime = now - 100;
        const msg = { firstLevelWithGreeks: { ltpc: { ltt: tickTime } } };
        const latency = calculateLatency('SYM', msg);
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 90 && latency <= 300);
    });
});
