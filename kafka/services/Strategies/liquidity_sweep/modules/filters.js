import { getActiveLevels } from './levelDetection.js';
import { computeVolumeRate } from './tickDelta.js';

/**
 * Phase E — pre-signal filters (time, liquidity, volatility).
 */
function getMinutesSinceOpen(timestamp, sessionOpenTs) {
    return (timestamp - sessionOpenTs) / (60 * 1000);
}

function getMinutesUntilSessionEnd(timestamp, params) {
    const d = new Date(timestamp);
    const end = new Date(timestamp);
    end.setHours(params.sessionEndHour, params.sessionEndMinute, 0, 0);
    return (end.getTime() - d.getTime()) / (60 * 1000);
}

function passesFilters(state, tick, params) {
    const sessionOpenTs = state.sessionMeta?.sessionOpenTs;
    if (!sessionOpenTs) {
        return { pass: true };
    }

    const minsSinceOpen = getMinutesSinceOpen(tick.timestamp, sessionOpenTs);
    if (minsSinceOpen < params.skipFirstMinutes) {
        return { pass: false, reason: 'opening_window' };
    }

    const minsUntilEnd = getMinutesUntilSessionEnd(tick.timestamp, params);
    if (minsUntilEnd < params.skipLastMinutes) {
        return { pass: false, reason: 'closing_window' };
    }

    const tickBuffer = state.tickBuffer || [];
    const { volumeRate } = computeVolumeRate(
        tickBuffer,
        params.volumeRateWindowSec,
        tick.timestamp
    );
    const avgTradedValuePerMin = volumeRate * tick.ltp * 60;
    if (params.minAvgTradedValuePerMin > 0 && avgTradedValuePerMin < params.minAvgTradedValuePerMin) {
        return { pass: false, reason: 'low_liquidity' };
    }

    const atr = state.sessionAtr;
    if (atr != null && tick.ltp > 0) {
        const atrPct = atr / tick.ltp;
        if (atrPct < params.atrLowPct) {
            return { pass: false, reason: 'volatility_too_low' };
        }
        if (atrPct > params.atrHighPct) {
            return { pass: false, reason: 'volatility_too_high' };
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
