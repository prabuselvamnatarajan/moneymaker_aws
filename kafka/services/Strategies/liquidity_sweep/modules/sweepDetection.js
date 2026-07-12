import { computeRollingDelta, computeVolumeRate, computeBookImbalance } from './tickDelta.js';

function levelTolerance(level, params) {
    const pctTol = level * params.sweepTolerancePct;
    const tickTol = params.tickSize * params.sweepToleranceTicks;
    return Math.max(pctTol, tickTol);
}

function passesBookImbalance(tick, direction, params) {
    const imbalance = computeBookImbalance(tick);
    if (imbalance == null) {
        return true;
    }
    if (direction === 'up') {
        return imbalance >= params.bookImbalanceThreshold;
    }
    return imbalance <= (1 - params.bookImbalanceThreshold);
}

/**
 * Phase B — detect liquidity sweep through a key level.
 */
function detectSweep(state, tick, params) {
    if (state.machineState !== 'IDLE' && state.machineState !== 'COOLDOWN') {
        return null;
    }

    if (state.cooldownUntil && tick.timestamp < state.cooldownUntil) {
        return null;
    }

    const activeLevels = state.activeLevels || [];
    const tickBuffer = state.tickBuffer || [];
    const delta = computeRollingDelta(tickBuffer, params.deltaWindowTicks, params);
    const { volumeRate } = computeVolumeRate(
        tickBuffer,
        params.volumeRateWindowSec,
        tick.timestamp
    );

    const avgVolumeRate = state.metrics?.avgVolumeRate || volumeRate || 1;
    const avgAbsDelta = state.metrics?.avgAbsDelta || 1;
    const deltaThreshold = avgAbsDelta * params.deltaThresholdMultiplier;
    const volumeBurst = volumeRate > avgVolumeRate * params.burstMultiplier;

    for (const levelInfo of activeLevels) {
        const level = levelInfo.price;
        if (level == null || level <= 0) {
            continue;
        }
        const tolerance = levelTolerance(level, params);

        if (tick.ltp > level + tolerance && delta > deltaThreshold && volumeBurst) {
            if (params.requireBookImbalance && !passesBookImbalance(tick, 'up', params)) {
                continue;
            }
            return {
                level,
                levelType: levelInfo.type,
                direction: 'up',
                sweepExtreme: tick.ltp,
                sweepStartTime: tick.timestamp,
                sweepStartTick: tickBuffer.length,
                preSweepSide: 'below',
            };
        }

        if (tick.ltp < level - tolerance && delta < -deltaThreshold && volumeBurst) {
            if (params.requireBookImbalance && !passesBookImbalance(tick, 'down', params)) {
                continue;
            }
            return {
                level,
                levelType: levelInfo.type,
                direction: 'down',
                sweepExtreme: tick.ltp,
                sweepStartTime: tick.timestamp,
                sweepStartTick: tickBuffer.length,
                preSweepSide: 'above',
            };
        }
    }

    return null;
}

export { detectSweep, levelTolerance, passesBookImbalance };
