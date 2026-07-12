import { resolveParams } from './config/defaultParams.js';
import { parseTick, isDataGap } from './utils/tickParser.js';
import { updateLevels, getActiveLevels, createInitialLevelState } from './modules/levelDetection.js';
import { enrichTick, pushTickBuffer, updateMetrics } from './modules/tickDelta.js';
import { detectSweep } from './modules/sweepDetection.js';
import { processAbsorption, resetSweepState } from './modules/absorption.js';
import { passesFilters } from './modules/filters.js';
import { openPosition, manageOpenPosition, enterCooldown } from './modules/tradeManagement.js';
import { logSweepOutcome } from './modules/signalLogger.js';
import { logger } from '/app/utils/logUtils.js';

function createInitialState(tick, params) {
    const levelInit = createInitialLevelState(tick, params);
    return {
        machineState: 'IDLE',
        tickBuffer: [],
        ...levelInit,
        activeLevels: getActiveLevels(levelInit.levels),
        sweep: null,
        position: null,
        pendingSignal: null,
        cooldownUntil: null,
        metrics: { avgAbsDelta: 1, avgVolumeRate: 1 },
        lastLtt: tick.timestamp,
        sessionAtr: null,
    };
}

function handleDataGap(state, tick, symbol) {
    logger.warn(`[liquidity_sweep] Data gap detected for ${symbol}, resetting sweep state`);
    if (state.sweep) {
        logSweepOutcome(symbol, state.sweep, 'data_gap', tick);
    }
    return {
        ...resetSweepState(state),
        tickBuffer: [],
        sweep: null,
        machineState: state.position ? 'IN_POSITION' : (state.cooldownUntil && tick.timestamp < state.cooldownUntil ? 'COOLDOWN' : 'IDLE'),
    };
}

async function LiquiditySweep(prevState, rawMsg, symbol, strategy_details) {
    const params = resolveParams(strategy_details);
    const previousLtp = prevState?.tickBuffer?.length
        ? prevState.tickBuffer[prevState.tickBuffer.length - 1].ltp
        : null;

    const tick = parseTick(rawMsg, previousLtp);
    if (!tick || tick.ltp == null) {
        return prevState || {};
    }

    let state = prevState && Object.keys(prevState).length > 0
        ? { ...prevState }
        : createInitialState(tick, params);

    if (isDataGap(tick.timestamp, state.lastLtt, params.gapThresholdSec)) {
        state = handleDataGap(state, tick, symbol);
    }
    state.lastLtt = tick.timestamp;

    state = updateLevels(state, tick, params);
    state.activeLevels = getActiveLevels(state.levels);

    const enriched = enrichTick(tick, previousLtp);
    state.tickBuffer = pushTickBuffer(state.tickBuffer, enriched, params.tickBufferSize);
    state.metrics = updateMetrics(state.metrics, state.tickBuffer, params);

    // Cooldown expiry
    if (state.machineState === 'COOLDOWN' && state.cooldownUntil && tick.timestamp >= state.cooldownUntil) {
        state.machineState = 'IDLE';
        state.cooldownUntil = null;
    }

    // Manage open position
    if (state.machineState === 'IN_POSITION' && state.position) {
        state = await manageOpenPosition(state, tick, symbol, strategy_details, params);
        return state;
    }

    // Process active sweep
    if (state.machineState === 'SWEEP_ACTIVE') {
        const { state: newState, signal } = processAbsorption(state, tick, params, symbol);
        state = newState;

        if (signal) {
            const filterResult = passesFilters(state, tick, params);
            if (!filterResult.pass) {
                logger.info(`[liquidity_sweep] Signal filtered: ${filterResult.reason}`, { symbol });
                state = resetSweepState(state);
                return state;
            }

            const position = await openPosition(signal, state, symbol, strategy_details, params, tick.timestamp);
            state.position = position;
            state.machineState = 'IN_POSITION';
            state.sweep = null;
            state.pendingSignal = null;
        }
        return state;
    }

    // Detect new sweep (IDLE only)
    if (state.machineState === 'IDLE') {
        const filterResult = passesFilters(state, tick, params);
        if (!filterResult.pass) {
            return state;
        }

        const sweep = detectSweep(state, tick, params);
        if (sweep) {
            state.machineState = 'SWEEP_ACTIVE';
            state.sweep = { ...sweep, tickCount: 0 };
            logger.info(`[liquidity_sweep] SWEEP_ACTIVE detected`, { symbol, sweep });
        }
    }

    return state;
}

export { LiquiditySweep };
