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
};

export function resolveParams(strategy_details = {}) {
    const nested = strategy_details.params || {};
    const merged = { ...DEFAULT_PARAMS, ...nested };

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
    ];

    for (const key of directKeys) {
        if (strategy_details[key] !== undefined) {
            merged[key] = strategy_details[key];
        }
    }

    return merged;
}
