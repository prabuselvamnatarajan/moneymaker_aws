import { resolveParams } from './config/defaultParams.js';
import { parseTick, isDataGap } from './modules/tickParser.js';
import { updateLevels, getActiveLevels, createInitialLevelState, getSessionDate } from './modules/levelDetection.js';
import { enrichTick, pushTickBuffer, updateMetrics } from './modules/tickDelta.js';
import { detectSweep } from './modules/sweepDetection.js';
import { processAbsorption, resetSweepState } from './modules/absorption.js';
import { passesFilters } from './modules/filters.js';
import { tryExecuteEntry, manageOpenPosition } from './modules/tradeManagement.js';
import { logSweepOutcome } from './modules/signalLogger.js';
import { fetchPriorDayOHLC } from './modules/sessionInit.js';
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
        priorDayFetched: false,
    };
}

function handleDataGap(state, tick, symbol, strategy_details) {
    logger.warn(`[liquidity_sweep] Data gap detected for ${symbol}, resetting sweep state`);
    if (state.sweep) {
        logSweepOutcome(symbol, state.sweep, 'data_gap', tick, strategy_details);
    }
    return {
        ...resetSweepState(state),
        tickBuffer: [],
        sweep: null,
        pendingSignal: null,
        machineState: state.position
            ? 'IN_POSITION'
            : (state.cooldownUntil && tick.timestamp < state.cooldownUntil ? 'COOLDOWN' : 'IDLE'),
    };
}

async function maybeInitSessionLevels(state, tick, strategy_details, params) {
    const sessionDate = getSessionDate(tick.timestamp);
    if (state.sessionMeta?.sessionDate === sessionDate && state.priorDayFetched) {
        return state;
    }

    const pdh = await fetchPriorDayOHLC(
        strategy_details.instrument_token,
        strategy_details.user_id,
        tick
    );

    const levelInit = createInitialLevelState(tick, params);
    return {
        ...state,
        ...levelInit,
        levels: {
            ...levelInit.levels,
            prevDayHigh: pdh.prevDayHigh,
            prevDayLow: pdh.prevDayLow,
        },
        priorDayFetched: true,
    };
}

async function attemptEntry(state, tick, symbol, strategy_details, params) {
    const signal = { ...state.pendingSignal, entryPrice: tick.ltp };
    const filterResult = passesFilters(state, tick, params);
    if (!filterResult.pass) {
        logger.info(`[liquidity_sweep] Signal filtered: ${filterResult.reason}`, { symbol });
        return resetSweepState({ ...state, pendingSignal: null, machineState: 'IDLE' });
    }

    const { position, reason } = await tryExecuteEntry(
        signal,
        state,
        symbol,
        strategy_details,
        params,
        tick.timestamp
    );

    if (!position) {
        logger.info(`[liquidity_sweep] Entry skipped: ${reason}`, { symbol });
        return resetSweepState({ ...state, pendingSignal: null, machineState: 'IDLE' });
    }

    return {
        ...state,
        position,
        machineState: 'IN_POSITION',
        pendingSignal: null,
        sweep: null,
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

    const sessionDate = getSessionDate(tick.timestamp);
    if (!state.priorDayFetched || state.sessionMeta?.sessionDate !== sessionDate) {
        state = await maybeInitSessionLevels(state, tick, strategy_details, params);
    }

    if (isDataGap(tick.timestamp, state.lastLtt, params.gapThresholdSec)) {
        state = handleDataGap(state, tick, symbol, strategy_details);
    }
    state.lastLtt = tick.timestamp;

    state = updateLevels(state, tick, params);
    state.activeLevels = getActiveLevels(state.levels);

    const enriched = enrichTick(tick, previousLtp);
    state.tickBuffer = pushTickBuffer(state.tickBuffer, enriched, params.tickBufferSize);
    state.metrics = updateMetrics(state.metrics, state.tickBuffer, params);

    if (state.machineState === 'COOLDOWN' && state.cooldownUntil && tick.timestamp >= state.cooldownUntil) {
        state.machineState = 'IDLE';
        state.cooldownUntil = null;
    }

    if (state.machineState === 'IN_POSITION' && state.position) {
        state = await manageOpenPosition(state, tick, symbol, strategy_details, params);
        return state;
    }

    if (state.machineState === 'PENDING_ENTRY' && state.pendingSignal) {
        return attemptEntry(state, tick, symbol, strategy_details, params);
    }

    if (state.machineState === 'SWEEP_ACTIVE') {
        const { state: newState, signal } = processAbsorption(state, tick, params, symbol, strategy_details);
        state = newState;

        if (signal) {
            const filterResult = passesFilters(state, tick, params);
            if (!filterResult.pass) {
                logger.info(`[liquidity_sweep] Signal filtered: ${filterResult.reason}`, { symbol });
                return resetSweepState({ ...state, pendingSignal: null });
            }

            if (params.entryOnNextTick) {
                state.pendingSignal = signal;
                state.machineState = 'PENDING_ENTRY';
                return state;
            }

            return attemptEntry({ ...state, pendingSignal: signal }, tick, symbol, strategy_details, params);
        }
        return state;
    }

    if (state.machineState === 'IDLE') {
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
