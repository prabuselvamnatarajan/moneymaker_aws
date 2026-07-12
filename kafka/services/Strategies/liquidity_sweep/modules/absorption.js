import { computeRollingDelta } from './tickDelta.js';
import { logSweepOutcome } from './signalLogger.js';

/**
 * Phase C — absorption / rejection confirmation while SWEEP_ACTIVE.
 */
function processAbsorption(state, tick, params, symbol) {
    const sweep = state.sweep;
    if (!sweep) {
        return { state, signal: null };
    }

    sweep.tickCount = (sweep.tickCount || 0) + 1;
    const prevExtreme = sweep.sweepExtreme;
    const elapsedSec = (tick.timestamp - sweep.sweepStartTime) / 1000;
    const delta = computeRollingDelta(state.tickBuffer, params.deltaWindowTicks);
    const invalidationDist = prevExtreme * params.invalidationMargin;

    // Invalidation — genuine breakout (check before updating extreme)
    if (sweep.direction === 'up' && tick.ltp > prevExtreme + invalidationDist) {
        logSweepOutcome(symbol, sweep, 'invalidated_continuation', tick);
        return {
            state: resetSweepState(state),
            signal: null,
        };
    }
    if (sweep.direction === 'down' && tick.ltp < prevExtreme - invalidationDist) {
        logSweepOutcome(symbol, sweep, 'invalidated_continuation', tick);
        return {
            state: resetSweepState(state),
            signal: null,
        };
    }

    sweep.sweepExtreme = sweep.direction === 'up'
        ? Math.max(sweep.sweepExtreme, tick.ltp)
        : Math.min(sweep.sweepExtreme, tick.ltp);

    // Timeout
    if (sweep.tickCount > params.rejectionMaxTicks || elapsedSec > params.rejectionMaxTimeSec) {
        logSweepOutcome(symbol, sweep, 'timeout', tick);
        return {
            state: resetSweepState(state),
            signal: null,
        };
    }

    // Rejection confirmed
    const reentered = sweep.direction === 'up'
        ? tick.ltp <= sweep.level
        : tick.ltp >= sweep.level;

    const deltaFlipped = sweep.direction === 'up'
        ? delta < 0
        : delta > 0;

    if (reentered && deltaFlipped) {
        logSweepOutcome(symbol, sweep, 'rejection_confirmed', tick);
        const signal = {
            direction: sweep.direction === 'up' ? 'short' : 'long',
            entryPrice: tick.ltp,
            sweepExtreme: sweep.sweepExtreme,
            level: sweep.level,
            levelType: sweep.levelType,
        };
        return {
            state: { ...state, machineState: 'SIGNAL_TRIGGERED', pendingSignal: signal },
            signal,
        };
    }

    return { state: { ...state, sweep }, signal: null };
}

function resetSweepState(state) {
    return {
        ...state,
        machineState: state.cooldownUntil && Date.now() < state.cooldownUntil ? 'COOLDOWN' : 'IDLE',
        sweep: null,
        pendingSignal: null,
    };
}

export { processAbsorption, resetSweepState };
