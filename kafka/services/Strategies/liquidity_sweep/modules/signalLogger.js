const sweepLogBuffer = [];

function logSweepOutcome(symbol, sweep, outcome, tick) {
    const entry = {
        symbol,
        outcome,
        level: sweep.level,
        levelType: sweep.levelType,
        direction: sweep.direction,
        sweepExtreme: sweep.sweepExtreme,
        tickCount: sweep.tickCount,
        ltp: tick.ltp,
        timestamp: tick.timestamp,
        loggedAt: Date.now(),
    };
    sweepLogBuffer.push(entry);
    if (sweepLogBuffer.length > 1000) {
        sweepLogBuffer.shift();
    }
    console.log(`[liquidity_sweep] SWEEP ${outcome}`, JSON.stringify(entry));
}

function logTradeEvent(symbol, event, details) {
    console.log(`[liquidity_sweep] TRADE ${event}`, JSON.stringify({ symbol, ...details }));
}

function getSweepLogBuffer() {
    return [...sweepLogBuffer];
}

export { logSweepOutcome, logTradeEvent, getSweepLogBuffer };
