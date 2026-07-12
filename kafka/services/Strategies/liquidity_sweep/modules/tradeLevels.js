import { findSecondaryTarget } from './filters.js';

function computeStopBuffer(sweepExtreme, params) {
    const pctBuffer = sweepExtreme * params.stopBufferPct;
    const tickBuffer = params.tickSize * params.stopBufferTicks;
    return Math.max(pctBuffer, tickBuffer);
}

function buildTradeLevels(signal, state, params) {
    const entry = signal.entryPrice;
    const buffer = computeStopBuffer(signal.sweepExtreme, params);
    const isLong = signal.direction === 'long';

    const stop = isLong
        ? signal.sweepExtreme - buffer
        : signal.sweepExtreme + buffer;

    const riskDistance = Math.abs(entry - stop);
    const minTargetDist = riskDistance * params.minRR;
    const maxTargetDist = riskDistance * params.maxRR;

    let targetDist = minTargetDist;
    const secondary = findSecondaryTarget(signal, state);
    if (secondary != null) {
        const secondaryDist = Math.abs(entry - secondary);
        if (secondaryDist > minTargetDist) {
            targetDist = Math.min(secondaryDist, maxTargetDist);
        }
    } else {
        targetDist = Math.min(minTargetDist, maxTargetDist);
    }

    const sufficientRR = targetDist >= minTargetDist && riskDistance > 0;
    const target = isLong ? entry + targetDist : entry - targetDist;
    const target1 = isLong ? entry + minTargetDist : entry - minTargetDist;

    return { entry, stop, target, target1, riskDistance, isLong, sufficientRR, targetDist };
}

function updateTrailingStop(position, ltp, params) {
    if (!position.partialTaken) {
        return;
    }
    const isLong = position.direction === 'long';
    const trailDist = position.riskDistance * params.trailOffsetR;
    const candidate = isLong ? ltp - trailDist : ltp + trailDist;

    if (position.trailStop == null) {
        position.trailStop = position.breakevenMoved ? position.entry : position.stop;
    }

    if (isLong) {
        position.trailStop = Math.max(position.trailStop, candidate);
    } else {
        position.trailStop = Math.min(position.trailStop, candidate);
    }
}

export { computeStopBuffer, buildTradeLevels, updateTrailingStop };
