import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcUnrealizedPnl,
  calcProfitPct,
  applyExcursion,
  extractLtp,
  extractTickTimeMs,
  tickTargetsPosition,
} from '../excursionMath.js';

describe('calcUnrealizedPnl', () => {
  it('computes LONG unrealised as (ltp - entry) * size', () => {
    assert.equal(calcUnrealizedPnl(100, 'LONG', 10, 105), 50);
    assert.equal(calcUnrealizedPnl(100, 'long', 10, 95), -50);
  });

  it('computes SHORT unrealised as (entry - ltp) * size', () => {
    assert.equal(calcUnrealizedPnl(100, 'SHORT', 10, 95), 50);
    assert.equal(calcUnrealizedPnl(100, 'short', 10, 105), -50);
  });

  it('returns 0 when size or entry is invalid', () => {
    assert.equal(calcUnrealizedPnl(0, 'LONG', 10, 105), 0);
    assert.equal(calcUnrealizedPnl(100, 'LONG', 0, 105), 0);
    assert.equal(calcUnrealizedPnl(100, 'LONG', -5, 105), 0);
  });
});

describe('calcProfitPct', () => {
  it('computes percentage move vs entry for LONG and SHORT', () => {
    assert.equal(calcProfitPct(100, 'LONG', 110), 10);
    assert.equal(calcProfitPct(100, 'SHORT', 90), 10);
    assert.equal(calcProfitPct(100, 'LONG', 90), -10);
  });

  it('returns 0 when entry is invalid', () => {
    assert.equal(calcProfitPct(0, 'LONG', 110), 0);
  });
});

describe('applyExcursion', () => {
  it('tracks max up / max down from unrealised values', () => {
    let state = { maxUp: 0, maxDown: 0, maxUpPct: 0, maxDownPct: 0 };
    state = applyExcursion(state, 25, 2.5);
    assert.equal(state.maxUp, 25);
    assert.equal(state.maxDown, 0);
    state = applyExcursion(state, -40, -4);
    assert.equal(state.maxUp, 25);
    assert.equal(state.maxDown, -40);
    assert.equal(state.maxUpPct, 2.5);
    assert.equal(state.maxDownPct, -4);
  });
});

describe('extractLtp', () => {
  it('reads flat ltp or nested fullFeed ltpc.ltp', () => {
    assert.equal(extractLtp({ ltp: 123.4 }), 123.4);
    assert.equal(
      extractLtp({ fullFeed: { marketFF: { ltpc: { ltp: 99.5 } } } }),
      99.5
    );
    assert.equal(extractLtp({}), null);
    assert.equal(extractLtp(null), null);
  });
});

describe('extractTickTimeMs', () => {
  it('prefers ltpc.ltt over message timestamp', () => {
    const ltt = 1720236000123;
    const ms = extractTickTimeMs({
      timestamp: '2024-07-06T03:20:00.000Z',
      fullFeed: { marketFF: { ltpc: { ltp: 100, ltt: String(ltt) } } },
    });
    assert.equal(ms, ltt);
  });

  it('falls back to message timestamp when ltt is absent', () => {
    const iso = '2024-07-06T03:20:00.000Z';
    const ms = extractTickTimeMs({ timestamp: iso, fullFeed: { marketFF: { ltpc: { ltp: 100 } } } });
    assert.equal(ms, new Date(iso).getTime());
  });

  it('returns null when neither ltt nor timestamp is present', () => {
    assert.equal(extractTickTimeMs({ fullFeed: { marketFF: { ltpc: { ltp: 100 } } } }), null);
    assert.equal(extractTickTimeMs(null), null);
  });
});

describe('topic vs mode isolation (contract)', () => {
  // Mirrors topicAllowsMode in positionTrackerConsumer.js
  function topicAllowsMode(topic, strategyMode, backtestTopic = 'backtest-stream-data') {
    const mode = String(strategyMode || '').toUpperCase();
    const isBacktestTopic = topic === backtestTopic;
    if (isBacktestTopic) return mode === 'BACKTEST';
    return mode === 'LIVE' || mode === 'PAPER';
  }

  it('backtest topic only updates BACKTEST positions', () => {
    assert.equal(topicAllowsMode('backtest-stream-data', 'BACKTEST'), true);
    assert.equal(topicAllowsMode('backtest-stream-data', 'LIVE'), false);
    assert.equal(topicAllowsMode('backtest-stream-data', 'PAPER'), false);
  });

  it('live topic only updates LIVE/PAPER', () => {
    assert.equal(topicAllowsMode('splited-live-data', 'LIVE'), true);
    assert.equal(topicAllowsMode('splited-live-data', 'PAPER'), true);
    assert.equal(topicAllowsMode('splited-live-data', 'BACKTEST'), false);
  });
});

describe('tickTargetsPosition', () => {
  it('keeps concurrent backtests on the same symbol isolated', () => {
    assert.equal(tickTargetsPosition(true, 'depA', 'depA'), true);
    assert.equal(tickTargetsPosition(true, 'depA', 'depB'), false);
  });

  it('compares ids as strings so ObjectId vs string does not leak', () => {
    assert.equal(tickTargetsPosition(true, { toString: () => 'depA' }, 'depA'), true);
  });

  it('rejects a backtest tick when the position has no deployment id', () => {
    assert.equal(tickTargetsPosition(true, 'depA', null), false);
  });

  it('does not filter the live feed, which carries no deployment id', () => {
    assert.equal(tickTargetsPosition(false, null, 'depA'), true);
    assert.equal(tickTargetsPosition(false, 'depA', 'depB'), true);
  });

  it('rejects a backtest tick that carries no deployment id to prevent cross-deployment pollution', () => {
    assert.equal(tickTargetsPosition(true, null, 'depA'), false);
  });
});
