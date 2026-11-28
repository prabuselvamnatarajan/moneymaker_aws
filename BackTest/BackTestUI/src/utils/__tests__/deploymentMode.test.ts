import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_TYPE_FOR_MODE,
  accountsForMode,
  deploymentAccountError,
  isAccountAllowedForMode,
} from '../deploymentMode';

const accounts = [
  { id: 'a1', name: 'Upstox live', accountType: 'LIVE' as const },
  { id: 'a2', name: 'paper', accountType: 'PAPER' as const },
  { id: 'a3', name: 'simulation', accountType: 'SIMULATION' as const },
  { id: 'a4', name: 'second paper', accountType: 'PAPER' as const },
];

describe('UI deployment mode -> account type rule', () => {
  it('TC-DMODE-UI-001: maps live/paper/backtest to LIVE/PAPER/SIMULATION', () => {
    assert.deepEqual(ACCOUNT_TYPE_FOR_MODE, { live: 'LIVE', paper: 'PAPER', backtest: 'SIMULATION' });
  });

  it('TC-DMODE-UI-002: filters the account dropdown to the selected mode', () => {
    assert.deepEqual(accountsForMode(accounts, 'live').map((a) => a.id), ['a1']);
    assert.deepEqual(accountsForMode(accounts, 'paper').map((a) => a.id), ['a2', 'a4']);
    assert.deepEqual(accountsForMode(accounts, 'backtest').map((a) => a.id), ['a3']);
  });

  it('TC-DMODE-UI-003: rejects every cross pairing', () => {
    assert.equal(isAccountAllowedForMode(accounts[1], 'live'), false);
    assert.equal(isAccountAllowedForMode(accounts[0], 'paper'), false);
    assert.equal(isAccountAllowedForMode(accounts[1], 'backtest'), false);
    assert.equal(isAccountAllowedForMode(accounts[2], 'paper'), false);
    assert.equal(isAccountAllowedForMode(undefined, 'paper'), false);
  });

  it('TC-DMODE-UI-004: explains a mismatch and a missing account, null when valid', () => {
    assert.match(deploymentAccountError(accounts[1], 'live')!, /Live deployments need a LIVE account/);
    assert.match(deploymentAccountError(undefined, 'backtest')!, /Select a SIMULATION account/);
    assert.equal(deploymentAccountError(accounts[2], 'backtest'), null);
  });

  it('TC-DMODE-UI-005: an account with no type never matches', () => {
    assert.equal(isAccountAllowedForMode({ accountType: undefined }, 'live'), false);
  });
});
