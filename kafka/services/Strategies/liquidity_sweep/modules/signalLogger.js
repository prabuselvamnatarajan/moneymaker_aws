import axios from 'axios';

const sweepLogBuffer = [];

function getSweepLogApiBase() {
    return process.env.SWEEP_LOG_API || process.env.BACKTEST_APP_URL || 'http://backtest-app:3000';
}

function getServiceHeaders() {
    const token = process.env.BACKTEST_SERVICE_TOKEN;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['x-service-token'] = token;
    }
    return headers;
}

async function persistLog(payload, strategy_details) {
    const deploymentId = strategy_details?.deployment_id;
    if (!deploymentId) {
        return;
    }
    const base = getSweepLogApiBase();
    const url = `${base}/api/deployments/${deploymentId}/sweep-signals`;
    try {
        await axios.post(url, payload, {
            timeout: 3000,
            headers: getServiceHeaders(),
        });
    } catch (err) {
        console.warn(`[liquidity_sweep] Failed to persist log: ${err.message}`);
    }
}

function logSweepOutcome(symbol, sweep, outcome, tick, strategy_details = {}) {
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
        eventType: 'sweep',
    };
    sweepLogBuffer.push(entry);
    if (sweepLogBuffer.length > 1000) {
        sweepLogBuffer.shift();
    }
    console.log(`[liquidity_sweep] SWEEP ${outcome}`, JSON.stringify(entry));
    persistLog(entry, strategy_details).catch(() => {});
}

function logTradeEvent(symbol, event, details, strategy_details = {}) {
    const entry = {
        symbol,
        outcome: event,
        eventType: 'trade',
        ...details,
        timestamp: details.timestamp || Date.now(),
        loggedAt: Date.now(),
    };
    console.log(`[liquidity_sweep] TRADE ${event}`, JSON.stringify({ symbol, ...details }));
    persistLog(entry, strategy_details).catch(() => {});
}

function getSweepLogBuffer() {
    return [...sweepLogBuffer];
}

export { logSweepOutcome, logTradeEvent, getSweepLogBuffer, persistLog };
