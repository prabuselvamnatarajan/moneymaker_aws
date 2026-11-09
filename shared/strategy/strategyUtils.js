function envIsBacktest() {
    const raw = process.env.IS_BACKTEST;
    return raw === true || raw === 'true' || raw === '1';
}

export function resolveIsBackTest(strategy_details = {}) {
    if (envIsBacktest() || strategy_details.strategy_mode === 'BACKTEST') {
        return true;
    }
    if (strategy_details.strategy_mode === 'LIVE' || strategy_details.strategy_mode === 'PAPER') {
        return false;
    }
    return strategy_details.isTest === true;
}

export function extractCleanSymbol(msg, rawKey) {
    const sd = msg?.strategy_details || {};
    return String(
        msg?.symbol || msg?.symbol_name || sd.symbol || String(rawKey || '').split(':')[0]
    ).toUpperCase();
}

export function createDeploymentLock() {
    const locks = new Map();
    return async function withLock(deploymentId, fn) {
        if (!deploymentId) return fn();
        const prev = locks.get(deploymentId) || Promise.resolve();
        let resolve;
        const curr = new Promise((r) => {
            resolve = r;
        });
        locks.set(deploymentId, curr);
        try {
            await prev;
            return await fn();
        } finally {
            resolve();
            if (locks.get(deploymentId) === curr) {
                locks.delete(deploymentId);
            }
        }
    };
}
