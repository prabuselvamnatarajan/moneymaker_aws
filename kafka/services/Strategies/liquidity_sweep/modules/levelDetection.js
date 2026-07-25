/**
 * Phase A — key level detection (PDH/PDL, VWAP, opening range, HVN).
 */

import { getSessionDate, getSessionOpenTs } from './sessionTime.js';
import {
    timeframeToMs,
    resolveAtrLookbackBars,
    normalizeAtrTo1m,
} from './timeframeUtil.js';

function priceBucket(price, bucketSizePct) {
    if (!price || price <= 0) {
        return 0;
    }
    const bucketSize = price * bucketSizePct;
    return Math.round(price / bucketSize) * bucketSize;
}

function resolveBarTimestamp(tick) {
    const raw = tick?.barTimestamp ?? tick?.ltt ?? tick?.timestamp;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function createInitialLevelState(tick, params, timeframe) {
    if (!timeframe) {
        throw new Error('timeframe is required for level state');
    }
    const intervalMs = timeframeToMs(timeframe);
    const sessionDate = getSessionDate(tick.timestamp);
    const sessionOpenTs = getSessionOpenTs(tick.timestamp);
    const ohlc1d = tick.ohlc1d || {};
    const barTime = resolveBarTimestamp(tick) || tick.timestamp;
    const barTs = Math.floor(barTime / intervalMs) * intervalMs;

    return {
        levels: {
            prevDayHigh: ohlc1d.high ?? tick.ltp,
            prevDayLow: ohlc1d.low ?? tick.ltp,
            sessionVWAP: tick.ltp,
            orHigh: tick.ltp,
            orLow: tick.ltp,
            hvn: [],
        },
        sessionMeta: {
            sessionDate,
            sessionOpenTs,
            openingRangeEndTs: sessionOpenTs + params.openingRangeMinutes * 60 * 1000,
            vwapNumerator: (tick.ltp || 0) * (tick.ltq || 1),
            vwapDenominator: tick.ltq || 1,
        },
        volumeProfile: {
            interval: timeframe,
            buckets: {},
            bucketTimestamps: {},
            currentBar: {
                // Bucket from tick time (ltpc.ltt → tick.timestamp), never I1 OHLC
                ts: barTs,
                high: tick.ltp,
                low: tick.ltp,
                close: tick.ltp,
                volume: tick.ltq || 0,
            },
            lastBarTs: barTs,
            minuteBars: [],
        },
    };
}

function updateVwap(sessionMeta, tick) {
    const qty = tick.ltq || 0;
    if (qty <= 0) {
        return sessionMeta.sessionVWAP ?? tick.ltp;
    }
    sessionMeta.vwapNumerator = (sessionMeta.vwapNumerator || 0) + tick.ltp * qty;
    sessionMeta.vwapDenominator = (sessionMeta.vwapDenominator || 0) + qty;
    return sessionMeta.vwapDenominator > 0
        ? sessionMeta.vwapNumerator / sessionMeta.vwapDenominator
        : tick.ltp;
}

function updateOpeningRange(levels, sessionMeta, tick) {
    if (tick.timestamp <= sessionMeta.openingRangeEndTs) {
        levels.orHigh = Math.max(levels.orHigh ?? tick.ltp, tick.ltp);
        levels.orLow = Math.min(levels.orLow ?? tick.ltp, tick.ltp);
    }
}

function addVolumeToProfile(volumeProfile, tick, params) {
    const bucket = priceBucket(tick.ltp, params.bucketSizePct);
    const qty = tick.ltq || 0;
    if (qty <= 0) {
        return;
    }
    volumeProfile.buckets[bucket] = (volumeProfile.buckets[bucket] || 0) + qty;
    volumeProfile.bucketTimestamps[bucket] = tick.timestamp;
}

function pruneOldBuckets(volumeProfile, tick, params) {
    const cutoff = tick.timestamp - params.hvnWindowMinutes * 60 * 1000;
    for (const [bucket, ts] of Object.entries(volumeProfile.bucketTimestamps || {})) {
        if (ts < cutoff) {
            delete volumeProfile.buckets[bucket];
            delete volumeProfile.bucketTimestamps[bucket];
        }
    }
}

function computeHvnLevels(volumeProfile, topN = 3) {
    const entries = Object.entries(volumeProfile.buckets || {})
        .map(([price, vol]) => ({ price: Number(price), vol }))
        .sort((a, b) => b.vol - a.vol);
    return entries.slice(0, topN).map((e) => e.price);
}

function assertVolumeProfileInterval(volumeProfile, timeframe) {
    if (!volumeProfile) return false;
    if (volumeProfile.interval && volumeProfile.interval !== timeframe) {
        // Soft signal — caller resets profile instead of crashing the consumer
        return false;
    }
    return true;
}

function updateMinuteBar(volumeProfile, tick, timeframe) {
    const intervalMs = timeframeToMs(timeframe);
    // Construct TF bars from trade time (barTimestamp/ltt) — do not use I1 OHLC ts
    const barTime = resolveBarTimestamp(tick) || tick.timestamp;
    const barTs = Math.floor(barTime / intervalMs) * intervalMs;
    const current = volumeProfile.currentBar;
    volumeProfile.interval = timeframe;

    // Ignore stale/out-of-order ticks that would rewind or corrupt the forming bar
    if (current && Number.isFinite(current.ts) && barTs < current.ts) {
        return false;
    }

    if (!current || current.ts !== barTs) {
        if (current && current.ts) {
            volumeProfile.minuteBars = [
                ...(volumeProfile.minuteBars || []).slice(-(200)),
                { ...current },
            ];
        }
        volumeProfile.currentBar = {
            ts: barTs,
            high: tick.ltp,
            low: tick.ltp,
            close: tick.ltp,
            volume: tick.ltq || 0,
        };
        volumeProfile.lastBarTs = barTs;
        return true;
    }

    current.high = Math.max(current.high, tick.ltp);
    current.low = Math.min(current.low, tick.ltp);
    current.close = tick.ltp;
    current.volume += tick.ltq || 0;
    return false;
}

function computeSessionAtr(minuteBars, lookback = 14) {
    const bars = (minuteBars || []).slice(-lookback);
    if (bars.length < 2) {
        return null;
    }
    let sum = 0;
    for (let i = 1; i < bars.length; i++) {
        const prevClose = bars[i - 1].close ?? bars[i - 1].high;
        sum += Math.abs(bars[i].close - prevClose);
    }
    return sum / (bars.length - 1);
}

function getActiveLevels(levels) {
    const result = [];
    const { prevDayHigh, prevDayLow, sessionVWAP, orHigh, orLow, hvn } = levels;

    if (prevDayHigh != null) result.push({ type: 'prevDayHigh', price: prevDayHigh });
    if (prevDayLow != null) result.push({ type: 'prevDayLow', price: prevDayLow });
    if (sessionVWAP != null) result.push({ type: 'sessionVWAP', price: sessionVWAP });
    if (orHigh != null) result.push({ type: 'orHigh', price: orHigh });
    if (orLow != null) result.push({ type: 'orLow', price: orLow });
    for (let i = 0; i < (hvn || []).length; i++) {
        result.push({ type: `hvn_${i + 1}`, price: hvn[i] });
    }
    return result;
}

function updateLevels(state, tick, params, timeframe) {
    if (!timeframe) {
        throw new Error('timeframe is required for updateLevels');
    }

    let { levels, sessionMeta, volumeProfile } = state;
    const sessionDate = getSessionDate(tick.timestamp);

    if (!sessionMeta || sessionMeta.sessionDate !== sessionDate) {
        const init = createInitialLevelState(tick, params, timeframe);
        return { ...state, ...init };
    }

    if (!assertVolumeProfileInterval(volumeProfile, timeframe)) {
        // Interval mismatch after TF change — rebuild level state cleanly
        const init = createInitialLevelState(tick, params, timeframe);
        return { ...state, ...init };
    }

    levels = { ...levels };
    sessionMeta = { ...sessionMeta };
    volumeProfile = {
        ...volumeProfile,
        interval: timeframe,
        buckets: { ...(volumeProfile.buckets || {}) },
        bucketTimestamps: { ...(volumeProfile.bucketTimestamps || {}) },
        minuteBars: [...(volumeProfile.minuteBars || [])],
    };

    if (levels.prevDayHigh == null && tick.ohlc1d?.high != null) {
        levels.prevDayHigh = tick.ohlc1d.high;
        levels.prevDayLow = tick.ohlc1d.low;
    }

    levels.sessionVWAP = updateVwap(sessionMeta, tick);
    updateOpeningRange(levels, sessionMeta, tick);
    addVolumeToProfile(volumeProfile, tick, params);

    const barClosed = updateMinuteBar(volumeProfile, tick, timeframe);
    if (barClosed) {
        pruneOldBuckets(volumeProfile, tick, params);
        levels.hvn = computeHvnLevels(volumeProfile, 3);
    }

    const lookbackBars = resolveAtrLookbackBars(timeframe, params.atrLookbackBars);
    const rawAtr = computeSessionAtr(volumeProfile.minuteBars, lookbackBars);
    // Filters compare against 1m-tuned atrLowPct/atrHighPct — normalize magnitude
    const sessionAtr = normalizeAtrTo1m(rawAtr, timeframe);

    return {
        ...state,
        levels,
        sessionMeta,
        volumeProfile,
        sessionAtr,
        timeframe,
    };
}

export {
    createInitialLevelState,
    updateLevels,
    getActiveLevels,
    getSessionDate,
    computeSessionAtr,
    priceBucket,
    normalizeAtrTo1m,
    resolveAtrLookbackBars,
};
