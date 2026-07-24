import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialLevelState, updateLevels, computeSessionAtr } from '../modules/levelDetection.js';
import {
    normalizeAtrTo1m,
    resolveAtrLookbackBars,
    timeframeToMs,
} from '../modules/timeframeUtil.js';
import { DEFAULT_PARAMS } from '../config/defaultParams.js';

describe('levelDetection timeframe bars from tick LTT', () => {
    const baseLtt = 1720236000000; // aligned 5m boundary

    function makeTick({ ltp, ltt, ltq = 10, ohlcI1Ts }) {
        return {
            ltp,
            ltq,
            ltt,
            timestamp: ltt,
            // Stale/wrong I1 ts must be ignored for multi-TF bars
            ohlcI1: ohlcI1Ts != null ? { ts: ohlcI1Ts, open: ltp, high: ltp, low: ltp, close: ltp } : null,
            ohlc1d: { high: ltp + 50, low: ltp - 50 },
        };
    }

    it('buckets 5m bars from tick timestamp, ignoring I1 ts', () => {
        const tick1 = makeTick({ ltp: 100, ltt: baseLtt + 1000, ohlcI1Ts: baseLtt + 1000 });
        let state = createInitialLevelState(tick1, DEFAULT_PARAMS, '5m');
        assert.equal(state.volumeProfile.currentBar.ts, baseLtt);
        assert.equal(state.volumeProfile.interval, '5m');

        // Same 5m bucket but I1 would have rolled to next minute
        const tick2 = makeTick({
            ltp: 105,
            ltt: baseLtt + 90_000,
            ohlcI1Ts: baseLtt + 60_000,
        });
        state = updateLevels(state, tick2, DEFAULT_PARAMS, '5m');
        assert.equal(state.volumeProfile.currentBar.ts, baseLtt);
        assert.equal(state.volumeProfile.currentBar.high, 105);
        assert.equal((state.volumeProfile.minuteBars || []).length, 0);

        // Next 5m bucket
        const tick3 = makeTick({
            ltp: 99,
            ltt: baseLtt + 300_000,
            ohlcI1Ts: baseLtt + 300_000,
        });
        state = updateLevels(state, tick3, DEFAULT_PARAMS, '5m');
        assert.equal(state.volumeProfile.currentBar.ts, baseLtt + 300_000);
        assert.equal(state.volumeProfile.minuteBars.length, 1);
        assert.equal(state.volumeProfile.minuteBars[0].ts, baseLtt);
        assert.equal(state.volumeProfile.minuteBars[0].high, 105);
    });

    it('rolls 1m bars from tick timestamp without needing I1', () => {
        const tick1 = makeTick({ ltp: 100, ltt: baseLtt });
        let state = createInitialLevelState(tick1, DEFAULT_PARAMS, '1m');
        const tick2 = makeTick({ ltp: 101, ltt: baseLtt + 60_000 });
        state = updateLevels(state, tick2, DEFAULT_PARAMS, '1m');
        assert.equal(state.volumeProfile.currentBar.ts, baseLtt + 60_000);
        assert.equal(state.volumeProfile.minuteBars.length, 1);
    });

    it('fails loudly when volumeProfile.interval mismatches deployment timeframe', () => {
        const tick = makeTick({ ltp: 100, ltt: baseLtt });
        const state = createInitialLevelState(tick, DEFAULT_PARAMS, '1m');
        assert.throws(
            () => updateLevels(state, tick, DEFAULT_PARAMS, '5m'),
            /volumeProfile.interval mismatch/
        );
    });
});

describe('ATR multi-timeframe normalization', () => {
    it('scales lookback bars to keep ~1m-equivalent wall-clock window', () => {
        assert.equal(resolveAtrLookbackBars('1m', 14), 14);
        assert.equal(resolveAtrLookbackBars('5m', 14), 3); // ceil(14/5)
        assert.equal(resolveAtrLookbackBars('15m', 14), 2); // max(2, ceil(14/15))
    });

    it('normalizes TF-bar ATR magnitude to 1m-equivalent for filter thresholds', () => {
        // 5-point average move on 5m bars → 1 point per minute
        assert.equal(normalizeAtrTo1m(5, '5m'), 1);
        assert.equal(normalizeAtrTo1m(15, '15m'), 1);
        assert.equal(normalizeAtrTo1m(2, '1m'), 2);
    });

    it('stores 1m-normalized sessionAtr from higher-TF bars', () => {
        const baseLtt = 1720236000000;
        const params = { ...DEFAULT_PARAMS, atrLookbackBars: 14 };
        let state = null;

        // Build several closed 5m bars with +5 close-to-close moves
        for (let i = 0; i < 4; i++) {
            const barStart = baseLtt + i * 300_000;
            const tickOpen = {
                ltp: 100 + i * 5,
                ltq: 10,
                ltt: barStart + 1000,
                timestamp: barStart + 1000,
                ohlc1d: { high: 200, low: 50 },
            };
            if (!state) {
                state = createInitialLevelState(tickOpen, params, '5m');
            }
            state = updateLevels(state, tickOpen, params, '5m');

            const tickClose = {
                ltp: 100 + (i + 1) * 5,
                ltq: 10,
                ltt: barStart + 299_000,
                timestamp: barStart + 299_000,
                ohlc1d: { high: 200, low: 50 },
            };
            state = updateLevels(state, tickClose, params, '5m');
        }

        // Force roll to next bucket so last bar is closed into minuteBars
        const next = {
            ltp: 125,
            ltq: 10,
            ltt: baseLtt + 4 * 300_000,
            timestamp: baseLtt + 4 * 300_000,
            ohlc1d: { high: 200, low: 50 },
        };
        state = updateLevels(state, next, params, '5m');

        assert.ok(state.volumeProfile.minuteBars.length >= 2);
        const raw = computeSessionAtr(
            state.volumeProfile.minuteBars,
            resolveAtrLookbackBars('5m', 14)
        );
        assert.ok(raw != null);
        // sessionAtr must be 1m-normalized (raw / 5)
        assert.ok(Math.abs(state.sessionAtr - raw / 5) < 1e-9);
        assert.equal(timeframeToMs('5m'), 300000);
    });
});
