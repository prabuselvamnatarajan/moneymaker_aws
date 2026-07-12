export const DEFAULT_PARAMS = {
    burstMultiplier: 2.5,
    deltaThresholdMultiplier: 1.5,
    sweepTolerancePct: 0.0005,
    sweepToleranceTicks: 3,
    deltaWindowTicks: 5,
    rejectionMaxTicks: 8,
    rejectionMaxTimeSec: 8,
    invalidationMargin: 0.0018,
    stopBufferPct: 0.002,
    stopBufferTicks: 5,
    minRR: 2.0,
    maxRR: 3.0,
    accountRiskPerTrade: 0.0075,
    cooldownMinutes: 5,
    openingRangeMinutes: 15,
    hvnWindowMinutes: 45,
    bucketSizePct: 0.0005,
    minAvgTradedValuePerMin: 500000,
    tickBufferSize: 50,
    volumeRateWindowSec: 10,
    gapThresholdSec: 3,
    tickSize: 0.05,
    // Phase 2 filters & trade management
    skipFirstMinutes: 5,
    skipLastMinutes: 15,
    sessionEndHour: 15,
    sessionEndMinute: 30,
    timeStopMinutes: 12,
    breakevenAtR: 1.0,
    partialExitPct: 0.5,
    atrLookbackBars: 14,
    atrLowPct: 0.001,
    atrHighPct: 0.05,
    entryOnNextTick: true,
    lowConfidenceDeltaWeight: 0.5,
    bookImbalanceThreshold: 0.55,
    requireBookImbalance: false,
    trailOffsetR: 0.5,
    maxConcurrentTrades: 1,
    useLtqProxy: false,
    useTickRateVolumeProxy: false,
};

/** Relaxed defaults for backtest / index tick replay (sparse ltq, gaps between ticks). */
export const BACKTEST_PARAM_OVERRIDES = {
    minAvgTradedValuePerMin: 0,
    gapThresholdSec: 300,
    burstMultiplier: 1.2,
    deltaThresholdMultiplier: 0.8,
    skipFirstMinutes: 0,
    skipLastMinutes: 0,
    atrLowPct: 0,
    rejectionMaxTicks: 30,
    rejectionMaxTimeSec: 120,
    useLtqProxy: true,
    useTickRateVolumeProxy: true,
};

function isBacktestContext(strategy_details = {}) {
    return strategy_details.strategy_mode === 'BACKTEST'
        || process.env.IS_BACKTEST === 'true';
}

export function resolveParams(strategy_details = {}) {
    const nested = strategy_details.params || {};
    const base = isBacktestContext(strategy_details)
        ? { ...DEFAULT_PARAMS, ...BACKTEST_PARAM_OVERRIDES }
        : { ...DEFAULT_PARAMS };
    const merged = { ...base, ...nested };

    const directKeys = [
        'burstMultiplier', 'deltaThresholdMultiplier', 'sweepTolerancePct',
        'sweepToleranceTicks', 'deltaWindowTicks', 'rejectionMaxTicks',
        'rejectionMaxTimeSec', 'invalidationMargin', 'stopBufferPct',
        'stopBufferTicks', 'minRR', 'maxRR', 'accountRiskPerTrade',
        'cooldownMinutes', 'openingRangeMinutes', 'hvnWindowMinutes',
        'bucketSizePct', 'minAvgTradedValuePerMin', 'tickBufferSize',
        'volumeRateWindowSec', 'gapThresholdSec', 'tickSize',
        'skipFirstMinutes', 'skipLastMinutes', 'sessionEndHour',
        'sessionEndMinute', 'timeStopMinutes', 'breakevenAtR',
        'partialExitPct', 'atrLookbackBars', 'atrLowPct', 'atrHighPct',
        'entryOnNextTick', 'lowConfidenceDeltaWeight', 'bookImbalanceThreshold',
        'requireBookImbalance', 'trailOffsetR', 'maxConcurrentTrades',
        'useLtqProxy', 'useTickRateVolumeProxy',
    ];

    for (const key of directKeys) {
        if (strategy_details[key] !== undefined) {
            merged[key] = strategy_details[key];
        }
    }

    return merged;
}
