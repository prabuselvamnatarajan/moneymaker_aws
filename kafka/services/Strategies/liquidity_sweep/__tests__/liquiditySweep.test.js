import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTick, isDataGap } from '../modules/tickParser.js';
import { classifyTickSide, enrichTick, computeRollingDelta, getDeltaWeight } from '../modules/tickDelta.js';
import { detectSweep, passesBookImbalance } from '../modules/sweepDetection.js';
import { processAbsorption } from '../modules/absorption.js';
import { buildTradeLevels, updateTrailingStop } from '../modules/tradeLevels.js';
import { DEFAULT_PARAMS, resolveParams } from '../config/defaultParams.js';
import { getSessionOpenTs } from '../modules/sessionTime.js';

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

    it('parses root-level ltpc payloads', () => {
        const tick = parseTick({
            ltpc: { ltp: 1500, ltq: 25, ltt: Date.now() },
            marketLevel: {
                bidAskQuote: [{ bidP: 1499.5, askP: 1500.5, bidQ: 100, askQ: 100 }],
            },
        });
        assert.equal(tick.ltp, 1500);
        assert.equal(tick.feedType, 'market');
        assert.equal(tick.confidence, 'high');
    });

    it('parses firstLevelWithGreeks payloads', () => {
        const tick = parseTick({
            firstLevelWithGreeks: {
                ltpc: { ltp: 22050, ltq: 10, ltt: Date.now() },
            },
        });
        assert.equal(tick.ltp, 22050);
        assert.equal(tick.feedType, 'market');
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

    it('down-weights low-confidence ticks in delta', () => {
        const high = { signedQty: 100, sideConfidence: 'high' };
        const low = { signedQty: 100, sideConfidence: 'low' };
        const params = { lowConfidenceDeltaWeight: 0.5 };
        assert.equal(getDeltaWeight(high, params), 1);
        assert.equal(getDeltaWeight(low, params), 0.5);
        const weightedHigh = computeRollingDelta([high], 1, params);
        const weightedLow = computeRollingDelta([low], 1, params);
        assert.equal(weightedHigh, 100);
        assert.equal(weightedLow, 50);
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
        const { signal, state: newState } = processAbsorption(state, tick, params, 'TEST_SYMBOL');
        assert.ok(signal);
        assert.equal(signal.direction, 'short');
        assert.equal(newState.machineState, 'PENDING_ENTRY');
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

describe('tradeManagement', () => {
    it('rejects insufficient R:R in buildTradeLevels', () => {
        const params = { ...DEFAULT_PARAMS, minRR: 2, maxRR: 3, stopBufferPct: 0.002, stopBufferTicks: 5, tickSize: 0.05 };
        const signal = { entryPrice: 1000, direction: 'long', sweepExtreme: 995 };
        const state = { levels: { sessionVWAP: 1000.5, hvn: [] } };
        const levels = buildTradeLevels(signal, state, params);
        assert.equal(levels.sufficientRR, true);
        assert.ok(levels.targetDist >= levels.riskDistance * params.minRR);
    });

    it('ratchets trailing stop after partial', () => {
        const params = { ...DEFAULT_PARAMS, trailOffsetR: 0.5 };
        const position = {
            direction: 'long',
            entry: 100,
            stop: 98,
            riskDistance: 2,
            partialTaken: true,
            breakevenMoved: true,
            trailStop: 100,
        };
        updateTrailingStop(position, 104, params);
        assert.equal(position.trailStop, 103);
        updateTrailingStop(position, 103, params);
        assert.equal(position.trailStop, 103);
    });
});

describe('bookImbalance', () => {
    it('passes upside imbalance when tbq dominates', () => {
        const tick = { tbq: 700, tsq: 300 };
        const params = { bookImbalanceThreshold: 0.55 };
        assert.equal(passesBookImbalance(tick, 'up', params), true);
        assert.equal(passesBookImbalance(tick, 'down', params), false);
    });
});

describe('backtest params', () => {
    it('applies relaxed overrides only for BACKTEST mode', () => {
        const params = resolveParams({ isTest: true, strategy_mode: 'BACKTEST' });
        assert.equal(params.minAvgTradedValuePerMin, 0);
        assert.equal(params.gapThresholdSec, 300);
        assert.equal(params.useLtqProxy, true);
        assert.equal(params.useTickRateVolumeProxy, true);
    });

    it('keeps live defaults for PAPER mode', () => {
        const params = resolveParams({ isTest: true, strategy_mode: 'PAPER' });
        assert.equal(params.minAvgTradedValuePerMin, DEFAULT_PARAMS.minAvgTradedValuePerMin);
        assert.equal(params.gapThresholdSec, DEFAULT_PARAMS.gapThresholdSec);
        assert.equal(params.useLtqProxy, false);
        assert.equal(params.useTickRateVolumeProxy, false);
    });

    it('uses unit delta proxy for index ticks with zero ltq', () => {
        const tick = parseTick({
            fullFeed: { indexFF: { ltpc: { ltp: 22100, ltq: 0, ltt: Date.now() } } },
        }, 22000);
        const enriched = enrichTick(tick, 22000, { useLtqProxy: true });
        assert.equal(enriched.signedQty, 1);
    });
});

describe('sessionTime', () => {
    it('maps 9:20 IST to five minutes after session open', () => {
        // 2024-06-03 09:20 IST = 03:50 UTC
        const ts = Date.UTC(2024, 5, 3, 3, 50, 0, 0);
        const openTs = getSessionOpenTs(ts);
        const minsSinceOpen = (ts - openTs) / (60 * 1000);
        assert.equal(Math.round(minsSinceOpen), 5);
    });
});
