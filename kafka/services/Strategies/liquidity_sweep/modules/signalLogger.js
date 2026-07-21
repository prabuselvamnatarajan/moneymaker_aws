import axios from 'axios';

const sweepLogBuffer = [];

function getSweepLogApiBase() {
    return process.env.SWEEP_LOG_API || process.env.BACKTEST_APP_URL || 'http://backtest-app:3000';
}

function getServiceHeaders(strategy_details = {}) {
    const token = process.env.BACKTEST_SERVICE_TOKEN;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['x-service-token'] = token;
    }
    const userId = strategy_details.user_id;
    if (userId) {
        headers['x-user-id'] = String(userId);
    }
    return headers;
}

async function persistLog(payload, strategy_details) {
    const deploymentId = strategy_details?.deployment_id;
    if (!deploymentId) {
        console.error('[liquidity_sweep] Refusing to persist sweep log: strategy_details.deployment_id is missing');
        return;
    }
    if (process.env.BACKTEST_SERVICE_TOKEN && !strategy_details?.user_id) {
        console.error(
            `[liquidity_sweep] Refusing to persist sweep log for deployment ${deploymentId}: strategy_details.user_id is required when BACKTEST_SERVICE_TOKEN is set`
        );
        return;
    }
    const base = getSweepLogApiBase();
    const url = `${base}/api/deployments/${deploymentId}/sweep-signals`;
    const headers = getServiceHeaders(strategy_details);

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await axios.post(url, payload, {
                timeout: 3000,
                headers,
            });
            return;
        } catch (err) {
            if (attempt === 2) {
                console.warn(`[liquidity_sweep] Failed to persist log after retries: ${err.message}`);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
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
