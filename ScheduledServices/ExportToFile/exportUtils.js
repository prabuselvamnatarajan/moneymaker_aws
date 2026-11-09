const { DateTime } = require('luxon');

const IST = 'Asia/Kolkata';

function sanitizeCollectionName(collectionName) {
    return String(collectionName || '').replace(/[^a-zA-Z0-9-_]/g, '_');
}

function resolveTargetDbAndTimeField(collectionName, defaultDb = 'stock_database') {
    let targetDbName = defaultDb;
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
    for (const sym of activeSymbols || []) {
        if (sym.instrument_token && !seen.has(sym.instrument_token)) {
            seen.add(sym.instrument_token);
            const { _id, user_id, ...cleanSym } = sym;
            cleanSymbols.push(cleanSym);
        }
    }
    return cleanSymbols;
}

module.exports = {
    IST,
    sanitizeCollectionName,
    resolveTargetDbAndTimeField,
    calculateTimeWindow,
    sanitizeUserSymbols,
};
