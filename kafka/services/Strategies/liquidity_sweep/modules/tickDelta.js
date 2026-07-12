/**
 * Tick aggressor classification and rolling delta / volume rate metrics.
 */

function getDeltaWeight(tick, params = {}) {
    const weight = tick.sideConfidence === 'low'
        ? (params.lowConfidenceDeltaWeight ?? 0.5)
        : 1.0;
    return weight;
}

function weightedSignedQty(tick, params = {}) {
    const base = tick.signedQty || 0;
    return base * getDeltaWeight(tick, params);
}

function classifyTickSide(tick) {
    const { ltp, bestBid, bestAsk, previousLtp, confidence } = tick;

    if (bestAsk != null && ltp >= bestAsk) {
        return { side: 'buy', confidence: confidence || 'high' };
    }
    if (bestBid != null && ltp <= bestBid) {
        return { side: 'sell', confidence: confidence || 'high' };
    }
    if (previousLtp != null) {
        if (ltp > previousLtp) {
            return { side: 'buy', confidence: 'low' };
        }
        if (ltp < previousLtp) {
            return { side: 'sell', confidence: 'low' };
        }
        return { side: 'neutral', confidence: 'low' };
    }
    return { side: 'neutral', confidence: 'low' };
}

function enrichTick(tick, previousLtp) {
    const classified = classifyTickSide({ ...tick, previousLtp });
    const signedQty = classified.side === 'buy'
        ? tick.ltq
        : classified.side === 'sell'
            ? -tick.ltq
            : 0;

    return {
        ...tick,
        previousLtp,
        side: classified.side,
        sideConfidence: classified.confidence,
        signedQty,
        timestamp: tick.timestamp || tick.ltt,
    };
}

function pushTickBuffer(tickBuffer, enrichedTick, maxSize) {
    const buffer = [...(tickBuffer || []), enrichedTick];
    return buffer.slice(-maxSize);
}

function computeRollingDelta(tickBuffer, windowTicks, params = {}) {
    const window = (tickBuffer || []).slice(-windowTicks);
    return window.reduce((sum, t) => sum + weightedSignedQty(t, params), 0);
}

function computeVolumeRate(tickBuffer, windowSec, nowTs) {
    const cutoff = nowTs - windowSec * 1000;
    const window = (tickBuffer || []).filter((t) => t.timestamp >= cutoff);
    if (window.length === 0) {
        return { tickRate: 0, volumeRate: 0, tickCount: 0 };
    }
    const elapsedSec = Math.max((nowTs - window[0].timestamp) / 1000, 0.001);
    const totalVolume = window.reduce((sum, t) => sum + (t.ltq || 0), 0);
    return {
        tickRate: window.length / elapsedSec,
        volumeRate: totalVolume / elapsedSec,
        tickCount: window.length,
    };
}

function updateMetrics(metrics, tickBuffer, params) {
    const window = tickBuffer || [];
    const deltas = [];
    for (let i = params.deltaWindowTicks; i <= window.length; i++) {
        deltas.push(Math.abs(computeRollingDelta(window.slice(0, i), params.deltaWindowTicks, params)));
    }
    const avgAbsDelta = deltas.length > 0
        ? deltas.reduce((a, b) => a + b, 0) / deltas.length
        : 1;

    const lastTs = window.length > 0 ? window[window.length - 1].timestamp : Date.now();
    const { volumeRate } = computeVolumeRate(window, params.volumeRateWindowSec, lastTs);
    const avgVolumeRate = metrics?.avgVolumeRate
        ? metrics.avgVolumeRate * 0.95 + volumeRate * 0.05
        : volumeRate || 1;

    return {
        avgAbsDelta: Math.max(avgAbsDelta, 1),
        avgVolumeRate: Math.max(avgVolumeRate, 0.001),
        lastVolumeRate: volumeRate,
    };
}

function computeBookImbalance(tick) {
    const tbq = tick.tbq;
    const tsq = tick.tsq;
    if (tbq == null || tsq == null || tbq + tsq <= 0) {
        return null;
    }
    return tbq / (tbq + tsq);
}

export {
    classifyTickSide,
    enrichTick,
    pushTickBuffer,
    computeRollingDelta,
    computeVolumeRate,
    updateMetrics,
    computeBookImbalance,
    getDeltaWeight,
    weightedSignedQty,
};
