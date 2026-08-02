import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MSB Symbol Extraction & Partition Key Handling', () => {

  function extractCleanSymbol(msg, rawKey) {
    const strategyDetails = msg?.strategy_details || {};
    return String(msg?.symbol || msg?.symbol_name || strategyDetails.symbol || String(rawKey || '').split(':')[0]).toUpperCase();
  }

  it('extracts clean symbol name when rawKey contains deployment_id suffix', () => {
    const rawKey = 'NSE_FO|57331:6a6f38a699b5fd2ea448d9bd';
    const msg = {
      symbol_name: 'NSE_FO|57331',
      deployment_id: '6a6f38a699b5fd2ea448d9bd',
      strategy_details: {
        symbol: 'NSE_FO|57331',
        deployment_id: '6a6f38a699b5fd2ea448d9bd'
      }
    };

    const symbol = extractCleanSymbol(msg, rawKey);
    assert.equal(symbol, 'NSE_FO|57331', 'expected symbol to be clean without deployment_id suffix');
  });

  it('falls back to splitting rawKey when msg has no symbol property', () => {
    const rawKey = 'NSE_FO|57331:dep_999';
    const msg = {};

    const symbol = extractCleanSymbol(msg, rawKey);
    assert.equal(symbol, 'NSE_FO|57331', 'expected symbol to be split from rawKey');
  });

  it('converts symbol to uppercase', () => {
    const rawKey = 'nifty:dep_123';
    const msg = { symbol: 'nifty' };

    const symbol = extractCleanSymbol(msg, rawKey);
    assert.equal(symbol, 'NIFTY', 'expected uppercase symbol name');
  });
});
