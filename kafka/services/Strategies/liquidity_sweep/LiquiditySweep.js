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
import { decrementOpenPositions } from './redis_utils/concurrency.js';
import { logger } from '/app/utils/logUtils.js';

function createInitialState(tick, params, timeframe, stateEpoch) {
    const levelInit = createInitialLevelState(tick, params, timeframe);
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
        timeframe,
        state_epoch: stateEpoch,
    };
}

function handleDataGap(state, tick, symbol, strategy_details) {
    logger.warn(`[liquidity_sweep] Data gap detected for ${symbol}, resetting sweep state`);
    if (state.sweep) {
        logSweepOutcome(symbol, state.sweep, 'data_gap', tick, strategy_details);
    }
    return {
        ...resetSweepState(state, tick.timestamp),
        tickBuffer: [],
        sweep: null,
        pendingSignal: null,
        machineState: state.position
            ? 'IN_POSITION'
            : (state.cooldownUntil && tick.timestamp < state.cooldownUntil ? 'COOLDOWN' : 'IDLE'),
    };
}

async function maybeInitSessionLevels(state, tick, strategy_details, params, timeframe) {
    const sessionDate = getSessionDate(tick.timestamp);
    if (state.sessionMeta?.sessionDate === sessionDate && state.priorDayFetched) {
        return state;
    }

    const pdh = await fetchPriorDayOHLC(
        strategy_details.instrument_token,
        strategy_details.user_id,
        tick
    );

    const levelInit = createInitialLevelState(tick, params, timeframe);
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
        return resetSweepState({ ...state, pendingSignal: null, machineState: 'IDLE' }, tick.timestamp);
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
        return resetSweepState({ ...state, pendingSignal: null, machineState: 'IDLE' }, tick.timestamp);
    }

    return {
        ...state,
        position,
        machineState: 'IN_POSITION',
        pendingSignal: null,
        sweep: null,
    };
}

async function reconcileDiscardedOpenSlot(prev, strategy_details, symbol) {
    if (prev?.machineState === 'IN_POSITION' && strategy_details?.account_id) {
        logger.warn(
            `[liquidity_sweep] Releasing concurrency slot after discarding IN_POSITION state for ${symbol}`
        );
        await decrementOpenPositions(strategy_details.account_id);
    }
}

async function LiquiditySweep(prevState, rawMsg, symbol, strategy_details) {
    const params = resolveParams(strategy_details);
    // Default missing timeframe for rollout compatibility (legacy Redis routing)
    const timeframe = strategy_details?.timeframe || '1m';
    strategy_details.timeframe = timeframe;
    let stateEpoch = strategy_details.state_epoch;
    if (stateEpoch == null || !Number.isFinite(Number(stateEpoch))) {
        // assertFreshStateEpoch should have healed this; soft-default for safety
        stateEpoch = 1;
        strategy_details.state_epoch = 1;
        logger.warn(`[liquidity_sweep] state_epoch missing for ${symbol}; defaulting to 1`);
    }

    // Discard Redis state written before a timeframe reset (stale/missing epoch or timeframe).
    // Preserve open positions across rollout epoch adoption; release slot only when fully discarded.
    let usablePrev = prevState && Object.keys(prevState).length > 0 ? prevState : null;
    if (usablePrev) {
        const epochMismatch = usablePrev.state_epoch == null
            || Number(usablePrev.state_epoch) !== Number(stateEpoch);
        const tfMismatch = usablePrev.timeframe && usablePrev.timeframe !== timeframe;
        if (epochMismatch || tfMismatch) {
            logger.error(
                `[liquidity_sweep] Resetting stale Redis state for ${symbol}: state_epoch=${usablePrev.state_epoch} message_epoch=${stateEpoch} state_tf=${usablePrev.timeframe} deployment_tf=${timeframe}`
            );
            if (usablePrev.position && usablePrev.machineState === 'IN_POSITION') {
                // Keep live position / SL management across epoch or TF resets; drop candle/level buffers.
                // Stop/target are price levels — not timeframe-dependent.
                usablePrev = {
                    machineState: 'IN_POSITION',
                    position: usablePrev.position,
                    tickBuffer: [],
                    sweep: null,
                    pendingSignal: null,
                    cooldownUntil: usablePrev.cooldownUntil ?? null,
                    metrics: usablePrev.metrics || { avgAbsDelta: 1, avgVolumeRate: 1 },
                    lastLtt: usablePrev.lastLtt ?? null,
                    sessionAtr: null,
                    priorDayFetched: false,
                    timeframe,
                    state_epoch: Number(stateEpoch),
                };
            } else {
                await reconcileDiscardedOpenSlot(usablePrev, strategy_details, symbol);
                usablePrev = null;
            }
        }
    }

    const previousLtp = usablePrev?.tickBuffer?.length
        ? usablePrev.tickBuffer[usablePrev.tickBuffer.length - 1].ltp
        : null;

    const tick = parseTick(rawMsg, previousLtp);
    if (!tick || tick.ltp == null) {
        // Soft-skip: incomplete tick — server must not process.exit
        const err = new Error(`Tick missing LTP for ${symbol}`);
        err.name = 'BadTickError';
        throw err;
    }

    let state = usablePrev
        ? { ...usablePrev, timeframe, state_epoch: Number(stateEpoch) }
        : createInitialState(tick, params, timeframe, Number(stateEpoch));

    const sessionDate = getSessionDate(tick.timestamp);
    if (!state.priorDayFetched || state.sessionMeta?.sessionDate !== sessionDate) {
        state = await maybeInitSessionLevels(state, tick, strategy_details, params, timeframe);
    }

    if (isDataGap(tick.timestamp, state.lastLtt, params.gapThresholdSec)) {
        state = handleDataGap(state, tick, symbol, strategy_details);
    }
    state.lastLtt = tick.timestamp;

    state = updateLevels(state, tick, params, timeframe);
    state.activeLevels = getActiveLevels(state.levels);

    const enriched = enrichTick(tick, previousLtp, params);
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
                return resetSweepState({ ...state, pendingSignal: null }, tick.timestamp);
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
