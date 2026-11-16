import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SymbolStateManager, SymbolTimeframeState } from '../src/core/symbolStateManager.js';

describe('SymbolStateManager - Production Code Tests', () => {
  it('updates all default timeframes (1m, 3m, 5m, 15m) for a symbol simultaneously', () => {
    const manager = new SymbolStateManager();
    const tick = {
      symbol: 'NIFTY',
      ltp: 24200,
      timestampMs: 1720236005000,
      ltq: 75,
      vtt: 1500,
    };

    const res = manager.processTick(tick);
    assert.equal(res.symbol, 'NIFTY');
    assert.equal(res.ltp, 24200);
    assert.equal(res.snapshotVersion, 1);
    assert.ok(res.timeframes['1m']);
    assert.ok(res.timeframes['3m']);
    assert.ok(res.timeframes['5m']);
    assert.ok(res.timeframes['15m']);

    // Check that all timeframes have open = 24200
    assert.equal(res.timeframes['1m'].open, 24200);
    assert.equal(res.timeframes['3m'].open, 24200);
    assert.equal(res.timeframes['5m'].open, 24200);
    assert.equal(res.timeframes['15m'].open, 24200);
  });

  it('guarantees complete isolation between symbols (no cross-symbol contamination)', () => {
    const manager = new SymbolStateManager();

    // Tick for NIFTY
    manager.processTick({
      symbol: 'NIFTY',
      ltp: 24000,
      timestampMs: 1720236005000,
      ltq: 10,
    });

    // Tick for BANKNIFTY
    manager.processTick({
      symbol: 'BANKNIFTY',
      ltp: 51000,
      timestampMs: 1720236005000,
      ltq: 20,
    });

    // Check NIFTY state
    const nifty = manager.getOrCreate('NIFTY');
    assert.equal(nifty.snapshotVersion, 1);
    assert.equal(nifty.aggregators.get('1m').currentCandle.close, 24000);
    assert.equal(nifty.aggregators.get('1m').currentCandle.volume, 10);

    // Check BANKNIFTY state
    const bankNifty = manager.getOrCreate('BANKNIFTY');
    assert.equal(bankNifty.snapshotVersion, 1);
    assert.equal(bankNifty.aggregators.get('1m').currentCandle.close, 51000);
    assert.equal(bankNifty.aggregators.get('1m').currentCandle.volume, 20);

    // Another tick for NIFTY must NOT touch BANKNIFTY
    manager.processTick({
      symbol: 'NIFTY',
      ltp: 24050,
      timestampMs: 1720236015000,
      ltq: 15,
    });

    assert.equal(manager.getOrCreate('NIFTY').snapshotVersion, 2);
    assert.equal(manager.getOrCreate('NIFTY').aggregators.get('1m').currentCandle.close, 24050);
    assert.equal(manager.getOrCreate('NIFTY').aggregators.get('1m').currentCandle.volume, 25);

    // BANKNIFTY should remain unchanged at version 1, close 51000, volume 20
    assert.equal(manager.getOrCreate('BANKNIFTY').snapshotVersion, 1);
    assert.equal(manager.getOrCreate('BANKNIFTY').aggregators.get('1m').currentCandle.close, 51000);
    assert.equal(manager.getOrCreate('BANKNIFTY').aggregators.get('1m').currentCandle.volume, 20);
  });

  it('supports dynamically adding additional timeframes (e.g. 30m, 1h)', () => {
    const manager = new SymbolStateManager();
    const state = manager.getOrCreate('RELIANCE', ['1m', '30m', '1h']);

    assert.equal(state.timeframes.includes('1m'), true);
    assert.equal(state.timeframes.includes('30m'), true);
    assert.equal(state.timeframes.includes('1h'), true);

    const res = manager.processTick({
      symbol: 'RELIANCE',
      ltp: 3000,
      timestampMs: 1720236000000,
      ltq: 100,
    });

    assert.ok(res.timeframes['30m']);
    assert.ok(res.timeframes['1h']);
    assert.equal(res.timeframes['30m'].close, 3000);
    assert.equal(res.timeframes['1h'].close, 3000);
  });

  it('manages symbol lifecycle (has, delete, clear, getActiveSymbols)', () => {
    const manager = new SymbolStateManager();
    manager.getOrCreate('TCS');
    manager.getOrCreate('INFY');

    assert.equal(manager.has('TCS'), true);
    assert.equal(manager.has('INFY'), true);
    assert.equal(manager.has('WIPRO'), false);

    assert.deepEqual(manager.getActiveSymbols().sort(), ['INFY', 'TCS']);

    manager.delete('TCS');
    assert.equal(manager.has('TCS'), false);
    assert.equal(manager.has('INFY'), true);

    manager.clear();
    assert.equal(manager.has('INFY'), false);
    assert.equal(manager.getActiveSymbols().length, 0);
  });

  it('processes ticks statelessly without retaining any in-memory state', () => {
    const manager = new SymbolStateManager();

    // First tick with empty state
    const tick1 = {
      symbol: 'SBIN',
      ltp: 850,
      timestampMs: 1720236005000,
      ltq: 100,
      vtt: 1000,
    };

    const res1 = manager.processTick(tick1, {}, ['1m', '5m']);
    assert.ok(res1.updatedState['1m']);
    assert.ok(res1.updatedState['5m']);
    assert.equal(res1.snapshotData.ltp, 850);
    assert.equal(res1.updatedState['1m'].currentCandle.close, 850);

    // Verify manager holds ZERO state in memory
    assert.equal(manager.has('SBIN'), false);
    assert.equal(manager.getActiveSymbols().length, 0);

    // Second tick passing the updatedState from the first tick
    const tick2 = {
      symbol: 'SBIN',
      ltp: 855,
      timestampMs: 1720236015000,
      ltq: 50,
      vtt: 1050,
    };

    const res2 = manager.processTick(tick2, res1.updatedState, ['1m', '5m']);
    assert.equal(res2.updatedState['1m'].currentCandle.close, 855);
    assert.equal(res2.updatedState['1m'].currentCandle.high, 855);
    assert.equal(res2.updatedState['1m'].currentCandle.volume, 150);

    // Still ZERO state stored in memory
    assert.equal(manager.has('SBIN'), false);
  });

  it('computes only the timeframes combined from active strategies (e.g. 5m alone)', () => {
    const manager = new SymbolStateManager();

    const tick = {
      symbol: 'RELIANCE',
      ltp: 2900,
      timestampMs: 1720236000000,
      ltq: 20,
    };

    // Strategies only need 5m for RELIANCE
    const res = manager.processTick(tick, {}, ['5m']);
    assert.ok(res.updatedState['5m']);
    assert.equal(res.updatedState['1m'], undefined);
    assert.equal(res.updatedState['3m'], undefined);
    assert.equal(res.updatedState['15m'], undefined);

    assert.ok(res.snapshotData.timeframes['5m']);
    assert.equal(res.snapshotData.timeframes['1m'], undefined);
  });
});
