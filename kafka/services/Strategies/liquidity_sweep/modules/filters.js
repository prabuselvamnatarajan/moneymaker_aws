import { getActiveLevels } from './levelDetection.js';
import { computeVolumeRate, computeBookImbalance } from './tickDelta.js';
import { getSessionEndTs } from './sessionTime.js';

/**
 * Phase E — pre-signal filters (time, liquidity, volatility).
 */
function getMinutesSinceOpen(timestamp, sessionOpenTs) {
    return (timestamp - sessionOpenTs) / (60 * 1000);
}

function getMinutesUntilSessionEnd(timestamp, params) {
    const endTs = getSessionEndTs(timestamp, params.sessionEndHour, params.sessionEndMinute);
    return (endTs - timestamp) / (60 * 1000);
}

function passesFilters(state, tick, params) {
    const sessionOpenTs = state.sessionMeta?.sessionOpenTs;
    if (!sessionOpenTs) {
        return { pass: true };
    }

    const minsSinceOpen = getMinutesSinceOpen(tick.timestamp, sessionOpenTs);
    if (params.skipFirstMinutes > 0 && minsSinceOpen < params.skipFirstMinutes) {
        return { pass: false, reason: 'opening_window' };
    }

    const minsUntilEnd = getMinutesUntilSessionEnd(tick.timestamp, params);
    if (params.skipLastMinutes > 0 && minsUntilEnd < params.skipLastMinutes) {
        return { pass: false, reason: 'closing_window' };
    }

    const tickBuffer = state.tickBuffer || [];
    const { volumeRate } = computeVolumeRate(
        tickBuffer,
        params.volumeRateWindowSec,
        tick.timestamp,
        params
    );
    const avgTradedValuePerMin = volumeRate * tick.ltp * 60;
    if (params.minAvgTradedValuePerMin > 0 && avgTradedValuePerMin < params.minAvgTradedValuePerMin) {
        return { pass: false, reason: 'low_liquidity' };
    }

    const atr = state.sessionAtr;
    // Fail closed when ATR gate is configured but session ATR is not ready yet
    // (e.g. after TF/epoch reset before enough bars close).
    if (params.atrLowPct > 0 && (atr == null || !Number.isFinite(atr))) {
        return { pass: false, reason: 'volatility_atr_unavailable' };
    }
    if (atr != null && Number.isFinite(atr) && tick.ltp > 0) {
        const atrPct = atr / tick.ltp;
        if (params.atrLowPct > 0 && atrPct < params.atrLowPct) {
            return { pass: false, reason: 'volatility_too_low' };
        }
        if (atrPct > params.atrHighPct) {
            return { pass: false, reason: 'volatility_too_high' };
        }
    }

    if (params.requireBookImbalance) {
        const imbalance = computeBookImbalance(tick);
        if (imbalance != null) {
            const mid = params.bookImbalanceThreshold;
            const inExtreme = imbalance >= mid || imbalance <= (1 - mid);
            if (!inExtreme) {
                return { pass: false, reason: 'book_imbalance_weak' };
            }
        }
    }

    return { pass: true };
}

function findSecondaryTarget(signal, state) {
    const levels = getActiveLevels(state.levels || {});
    const entry = signal.entryPrice;
    const isLong = signal.direction === 'long';

    const opposing = levels
        .map((l) => l.price)
        .filter((p) => isLong ? p < entry : p > entry)
        .sort((a, b) => isLong ? b - a : a - b);

    return opposing[0] ?? null;
}

export { passesFilters, findSecondaryTarget };
