import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTick, isDataGap } from '../utils/tickParser.js';
import { classifyTickSide, enrichTick, computeRollingDelta } from '../modules/tickDelta.js';
import { detectSweep } from '../modules/sweepDetection.js';
import { processAbsorption } from '../modules/absorption.js';
import { DEFAULT_PARAMS } from '../config/defaultParams.js';

function makeMarketTick({ ltp, ltq = 100, ltt = Date.now(), bidP, askP, prevLtp }) {
    return parseTick({
        fullFeed: {
            marketFF: {
                ltpc: { ltp, ltq, ltt, cp: ltp },
                marketLevel: {
                    bidAskQuote: [{ bidP, bidQ: 500, askP, askQ: 500 }],
                },
                marketOHLC: {
                    ohlc: [
                        { interval: 'I1', open: ltp, high: ltp, low: ltp, close: ltp, vol: ltq, ts: ltt },
                        { interval: '1d', open: ltp - 10, high: ltp + 20, low: ltp - 20, close: ltp, vol: 10000, ts: ltt },
                    ],
                },
                vtt: 100000,
            },
        },
    }, prevLtp);
}

describe('tickParser', () => {
    it('parses equity full feed with bid/ask', () => {
        const tick = makeMarketTick({ ltp: 1000, bidP: 999.5, askP: 1000.5 });
        assert.equal(tick.ltp, 1000);
        assert.equal(tick.feedType, 'market');
        assert.equal(tick.bestBid, 999.5);
        assert.equal(tick.bestAsk, 1000.5);
        assert.equal(tick.confidence, 'high');
    });

    it('parses index feed with low confidence', () => {
        const tick = parseTick({
            fullFeed: {
                indexFF: {
                    ltpc: { ltp: 22000, ltq: 50, ltt: Date.now() },
                    marketOHLC: { ohlc: [] },
                },
            },
        });
        assert.equal(tick.feedType, 'index');
        assert.equal(tick.confidence, 'low');
    });

    it('detects data gaps', () => {
        assert.equal(isDataGap(10000, 5000, 3), true);
        assert.equal(isDataGap(6000, 5000, 3), false);
    });
});

describe('tickDelta', () => {
    it('classifies buy-initiated tick at ask', () => {
        const tick = makeMarketTick({ ltp: 1000.5, bidP: 1000, askP: 1000.5 });
        const result = classifyTickSide(tick);
        assert.equal(result.side, 'buy');
        assert.equal(result.confidence, 'high');
    });

    it('classifies sell-initiated tick at bid', () => {
        const tick = makeMarketTick({ ltp: 999.5, bidP: 999.5, askP: 1000 });
        const result = classifyTickSide(tick);
        assert.equal(result.side, 'sell');
    });

    it('falls back to LTP direction for index ticks', () => {
        const tick = parseTick({
            fullFeed: { indexFF: { ltpc: { ltp: 22100, ltq: 10, ltt: Date.now() } } },
        }, 22000);
        const result = classifyTickSide({ ...tick, previousLtp: 22000 });
        assert.equal(result.side, 'buy');
        assert.equal(result.confidence, 'low');
    });

    it('computes rolling delta', () => {
        const ticks = [
            enrichTick(makeMarketTick({ ltp: 1000, bidP: 999, askP: 1000.5, ltq: 100 }), 999),
            enrichTick(makeMarketTick({ ltp: 999.5, bidP: 999, askP: 1000, ltq: 80 }), 1000),
            enrichTick(makeMarketTick({ ltp: 1000.5, bidP: 999.5, askP: 1000.5, ltq: 120 }), 999.5),
        ];
        const delta = computeRollingDelta(ticks, 3);
        assert.ok(delta !== 0);
    });
});

describe('sweepDetection', () => {
    it('detects upside sweep through key level', () => {
        const level = 1000;
        const params = { ...DEFAULT_PARAMS, burstMultiplier: 1.1, deltaThresholdMultiplier: 0.5 };
        const tickBuffer = [];
        for (let i = 0; i < 10; i++) {
            tickBuffer.push(enrichTick(
                makeMarketTick({
                    ltp: 1000.5 + i * 0.1,
                    bidP: 1000,
                    askP: 1000.6,
                    ltq: 500,
                    ltt: 1000000 + i * 100,
                }),
                1000
            ));
        }
        const tick = makeMarketTick({
            ltp: 1001.5,
            bidP: 1001,
            askP: 1001.6,
            ltq: 800,
            ltt: 1002000,
        });
        const state = {
            machineState: 'IDLE',
            activeLevels: [{ type: 'sessionVWAP', price: level }],
            tickBuffer,
            metrics: { avgVolumeRate: 100, avgAbsDelta: 50 },
        };
        const sweep = detectSweep(state, tick, params);
        assert.ok(sweep);
        assert.equal(sweep.direction, 'up');
        assert.equal(sweep.level, level);
    });
});

describe('absorption', () => {
    it('confirms rejection after upside sweep', () => {
        const params = { ...DEFAULT_PARAMS, deltaWindowTicks: 3 };
        const level = 1000;
        const tickBuffer = [
            enrichTick(makeMarketTick({ ltp: 1001, bidP: 1000.5, askP: 1001, ltq: 300, ltt: 2000000 }), 1000),
            enrichTick(makeMarketTick({ ltp: 1001.2, bidP: 1001, askP: 1001.5, ltq: 200, ltt: 2000100 }), 1001),
            enrichTick(makeMarketTick({ ltp: 999.5, bidP: 999.5, askP: 1000, ltq: 500, ltt: 2000200 }), 1001.2),
            enrichTick(makeMarketTick({ ltp: 999, bidP: 999, askP: 999.5, ltq: 600, ltt: 2000300 }), 999.5),
        ];
        const state = {
            machineState: 'SWEEP_ACTIVE',
            tickBuffer,
            sweep: {
                level,
                levelType: 'sessionVWAP',
                direction: 'up',
                sweepExtreme: 1001.2,
                sweepStartTime: 2000000,
                tickCount: 2,
            },
        };
        const tick = makeMarketTick({
            ltp: 998.5,
            bidP: 998.5,
            askP: 999,
            ltq: 400,
            ltt: 2000400,
        });
        tickBuffer.push(enrichTick(tick, 999));
        state.tickBuffer = tickBuffer;
        const { signal } = processAbsorption(state, tick, params, 'TEST_SYMBOL');
        assert.ok(signal);
        assert.equal(signal.direction, 'short');
    });

    it('invalidates on continuation beyond sweep extreme', () => {
        const params = DEFAULT_PARAMS;
        const state = {
            machineState: 'SWEEP_ACTIVE',
            tickBuffer: [],
            sweep: {
                level: 1000,
                direction: 'up',
                sweepExtreme: 1001,
                sweepStartTime: Date.now() - 1000,
                tickCount: 2,
            },
        };
        const tick = makeMarketTick({ ltp: 1005, bidP: 1004, askP: 1005, ltt: Date.now() });
        const { signal, state: newState } = processAbsorption(state, tick, params, 'TEST');
        assert.equal(signal, null);
        assert.equal(newState.sweep, null);
    });
});
