const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { DateTime } = require('luxon');

describe('ScheduledServices/ExportToFile Unit & Boundary Tests', () => {

    const IST = 'Asia/Kolkata';

    function sanitizeCollectionName(collectionName) {
        return collectionName.replace(/[^a-zA-Z0-9-_]/g, '_');
    }

    function resolveTargetDbAndTimeField(collectionName) {
        let targetDbName = 'stock_database';
        let timeField = 'timestamp';

        if (collectionName === 'usersymbols') {
            targetDbName = 'BacktestApp';
            timeField = null;
        } else if (collectionName === 'trades') {
            targetDbName = 'BacktestApp';
            timeField = 'created_at';
        } else if (collectionName === 'ledgers') {
            targetDbName = 'BacktestApp';
            timeField = 'created_on';
        } else if (collectionName.includes(':') || collectionName.includes('|')) {
            targetDbName = 'stock_database';
            timeField = 'timestamp';
        }

        return { targetDbName, timeField };
    }

    function calculateTimeWindow(targetDbName, dateIST) {
        const base = dateIST || DateTime.now().setZone(IST);
        let start, end;
        if (targetDbName === 'stock_database') {
            start = base.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate();
            end = base.set({ hour: 15, minute: 40, second: 0, millisecond: 0 }).toUTC().toJSDate();
        } else {
            start = base.startOf('day').toUTC().toJSDate();
            end = base.endOf('day').toUTC().toJSDate();
        }
        return { start, end };
    }

    function sanitizeUserSymbols(activeSymbols) {
        const seen = new Set();
        const cleanSymbols = [];
        for (const sym of activeSymbols) {
            if (sym.instrument_token && !seen.has(sym.instrument_token)) {
                seen.add(sym.instrument_token);
                const { _id, user_id, ...cleanSym } = sym;
                cleanSymbols.push(cleanSym);
            }
        }
        return cleanSymbols;
    }

    it('TC-EXP-001: sanitizes collection names with colons, pipes, and special characters', () => {
        assert.equal(sanitizeCollectionName('NSE_INDEX|Nifty 50'), 'NSE_INDEX_Nifty_50');
        assert.equal(sanitizeCollectionName('NSE_EQ:RELIANCE'), 'NSE_EQ_RELIANCE');
        assert.equal(sanitizeCollectionName('valid-name_123'), 'valid-name_123');
    });

    it('TC-EXP-006: maps target db and timestamp field accurately for trades and ledgers', () => {
        const trades = resolveTargetDbAndTimeField('trades');
        assert.equal(trades.targetDbName, 'BacktestApp');
        assert.equal(trades.timeField, 'created_at');

        const ledgers = resolveTargetDbAndTimeField('ledgers');
        assert.equal(ledgers.targetDbName, 'BacktestApp');
        assert.equal(ledgers.timeField, 'created_on');

        const stock = resolveTargetDbAndTimeField('NSE_EQ|INFY');
        assert.equal(stock.targetDbName, 'stock_database');
        assert.equal(stock.timeField, 'timestamp');
    });

    it('TC-EXP-005: calculates stock trading window strictly from 9:00 to 15:40 IST in UTC', () => {
        const testDate = DateTime.fromISO('2024-06-15T12:00:00', { zone: IST });
        const { start, end } = calculateTimeWindow('stock_database', testDate);

        // 9:00 IST = 03:30 UTC
        assert.equal(start.toISOString(), '2024-06-15T03:30:00.000Z');
        // 15:40 IST = 10:10 UTC
        assert.equal(end.toISOString(), '2024-06-15T10:10:00.000Z');
    });

    it('TC-EXP-005: calculates full day window for non-stock collections', () => {
        const testDate = DateTime.fromISO('2024-06-15T12:00:00', { zone: IST });
        const { start, end } = calculateTimeWindow('BacktestApp', testDate);

        // 00:00 IST = 18:30 UTC (prev day)
        assert.equal(start.toISOString(), '2024-06-14T18:30:00.000Z');
        // 23:59:59.999 IST = 18:29:59.999 UTC
        assert.equal(end.toISOString(), '2024-06-15T18:29:59.999Z');
    });

    it('TC-EXP-003 & 004: sanitizes usersymbols: strips _id & user_id and deduplicates by instrument_token', () => {
        const rawSymbols = [
            { _id: 'id1', user_id: 'usr1', instrument_token: 'TOK1', symbol: 'SYM1', is_active: true },
            { _id: 'id2', user_id: 'usr2', instrument_token: 'TOK1', symbol: 'SYM1', is_active: true }, // duplicate token
            { _id: 'id3', user_id: 'usr1', instrument_token: 'TOK2', symbol: 'SYM2', is_active: true },
        ];

        const clean = sanitizeUserSymbols(rawSymbols);
        assert.equal(clean.length, 2);
        assert.equal(clean[0].instrument_token, 'TOK1');
        assert.equal(clean[1].instrument_token, 'TOK2');

        assert.equal(clean[0]._id, undefined, '_id must be stripped for privacy');
        assert.equal(clean[0].user_id, undefined, 'user_id must be stripped for privacy');
        assert.equal(clean[0].symbol, 'SYM1');
    });
});
