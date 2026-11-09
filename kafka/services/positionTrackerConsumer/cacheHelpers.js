export function openSymbolKey(symbol) {
    return `position:open:${String(symbol || '').toUpperCase()}`;
}

export function liveKey(positionId) {
    return `position:live:${positionId}`;
}

export function throttleKey(positionId) {
    return `position:throttle:unrealised:${positionId}`;
}

export function checkThrottleExpired(lastWriteTime, throttleMs = 2000, now = Date.now()) {
    const lastWrite = lastWriteTime ? parseInt(lastWriteTime, 10) : 0;
    return now - lastWrite >= throttleMs;
}

export function topicAllowsMode(topic, strategyMode, backtestTopic = 'backtest-stream-data') {
    const mode = String(strategyMode || '').toUpperCase();
    const isBacktestTopic = topic === backtestTopic;
    if (isBacktestTopic) return mode === 'BACKTEST';
    // Live market feed updates LIVE and PAPER only
    return mode === 'LIVE' || mode === 'PAPER';
}

export function buildCacheFromDoc(doc) {
    if (!doc) return null;
    const mongoId = doc._id?.toString?.() || String(doc._id || '');
    return {
        positionMongoId: mongoId,
        mongoId,
        positionId: doc.position_id ? String(doc.position_id) : mongoId,
        symbol: String(doc.symbol || '').toUpperCase(),
        entryPrice: Number(doc.average_entry_price || doc.buy_price) || 0,
        buy_price: Number(doc.buy_price || doc.average_entry_price) || 0,
        direction: doc.direction || doc.type_of_position,
        type_of_position: doc.type_of_position || doc.direction,
        openSize: Number(doc.open_size || doc.quantity) || 0,
        quantity: Number(doc.quantity || doc.open_size) || 0,
        maxUp: Number(doc.max_up ?? doc.max_profit ?? 0),
        maxDown: Number(doc.max_down ?? doc.max_loss ?? 0),
        maxUpPct: Number(doc.max_up_pct ?? doc.max_profit_pct ?? 0),
        maxDownPct: Number(doc.max_down_pct ?? doc.max_loss_pct ?? 0),
        unrealisedPnl: Number(doc.unrealised_pnl ?? doc.unrealisedPnl ?? 0),
        unrealised_pnl: Number(doc.unrealised_pnl ?? doc.unrealisedPnl ?? 0),
        lastLtp: doc.last_ltp != null ? Number(doc.last_ltp) : (doc.lastLtp != null ? Number(doc.lastLtp) : 0),
        last_ltp: doc.last_ltp != null ? Number(doc.last_ltp) : (doc.lastLtp != null ? Number(doc.lastLtp) : null),
        lastTickAt: doc.last_tick_at ? new Date(doc.last_tick_at).getTime() : 0,
        strategyMode: doc.strategy_mode || null,
        strategy_mode: doc.strategy_mode || null,
        deploymentId: doc.deployment_id?.toString?.() || doc.deployment_id || null,
        deployment_id: doc.deployment_id?.toString?.() || doc.deployment_id || null,
        backtest_run_id: doc.backtest_run_id ? String(doc.backtest_run_id) : null,
        status: doc.status || 'OPEN',
    };
}
