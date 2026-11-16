import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLtp,
  extractTickTimestampMs,
  extractVolumeData,
  validateAndNormalizeTick,
} from '../src/utils/tickValidator.js';

describe('tickValidator - Production Code Tests', () => {
  it('extracts LTP from marketFF, indexFF, and direct ltpc formats', () => {
    assert.equal(extractLtp({ fullFeed: { marketFF: { ltpc: { ltp: 100 } } } }), 100);
    assert.equal(extractLtp({ fullFeed: { indexFF: { ltpc: { ltp: 24000.5 } } } }), 24000.5);
    assert.equal(extractLtp({ ltpc: { ltp: '105.25' } }), 105.25);
    assert.equal(extractLtp({ ltp: 200 }), 200);
    assert.equal(extractLtp({ firstLevelWithGreeks: { ltpc: { ltp: 15.5 } } }), 15.5);

    // Invalid LTPs return null
    assert.equal(extractLtp({ ltpc: { ltp: 0 } }), null);
    assert.equal(extractLtp({ ltpc: { ltp: -10 } }), null);
    assert.equal(extractLtp({ ltpc: { ltp: 'not-a-number' } }), null);
    assert.equal(extractLtp({}), null);
    assert.equal(extractLtp(null), null);
  });

  it('prioritizes exchange LTT over server timestamp', () => {
    const exchangeLtt = 1720236005000;
    const serverTimestamp = '2024-07-06T03:20:00.000Z'; // 1720236000000

    const msg = {
      timestamp: serverTimestamp,
      fullFeed: { marketFF: { ltpc: { ltp: 100, ltt: exchangeLtt } } },
    };

    assert.equal(extractTickTimestampMs(msg), exchangeLtt);

    // Falls back to timestamp if ltt is absent
    const msgWithoutLtt = {
      timestamp: serverTimestamp,
      ltpc: { ltp: 100 },
    };
    assert.equal(extractTickTimestampMs(msgWithoutLtt), 1720236000000);

    // Missing both returns null
    assert.equal(extractTickTimestampMs({ ltpc: { ltp: 100 } }), null);
  });

  it('extracts per-tick quantity (ltq) and cumulative volume (vtt)', () => {
    const data = {
      fullFeed: {
        marketFF: {
          ltpc: { ltp: 100, ltq: 25 },
          vtt: 150000,
        },
      },
    };
    const { ltq, vtt } = extractVolumeData(data);
    assert.equal(ltq, 25);
    assert.equal(vtt, 150000);
  });

  it('normalizes valid tick payloads and rejects invalid/incomplete ticks', () => {
    const valid = {
      symbol: 'NIFTY',
      ltpc: { ltp: 24000, ltt: 1720236000000, ltq: 50 },
      vtt: 1000,
    };
    const normalized = validateAndNormalizeTick(valid);
    assert.notEqual(normalized, null);
    assert.equal(normalized.symbol, 'NIFTY');
    assert.equal(normalized.ltp, 24000);
    assert.equal(normalized.timestampMs, 1720236000000);
    assert.equal(normalized.ltq, 50);
    assert.equal(normalized.vtt, 1000);

    // Falls back to partition key if symbol is absent inside object
    const withKey = validateAndNormalizeTick(
      { ltpc: { ltp: 100, ltt: 1720236000000 } },
      'RELIANCE'
    );
    assert.notEqual(withKey, null);
    assert.equal(withKey.symbol, 'RELIANCE');

    // Missing LTP soft-skips (returns null)
    assert.equal(validateAndNormalizeTick({ symbol: 'NIFTY', timestamp: 1720236000000 }), null);
    // Missing timestamp soft-skips (returns null)
    assert.equal(validateAndNormalizeTick({ symbol: 'NIFTY', ltp: 100 }), null);
    // Missing symbol soft-skips (returns null)
    assert.equal(validateAndNormalizeTick({ ltp: 100, timestamp: 1720236000000 }), null);
  });
});
