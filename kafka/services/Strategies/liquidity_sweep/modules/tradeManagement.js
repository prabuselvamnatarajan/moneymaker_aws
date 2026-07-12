import axios from 'axios';
import { getAccountBalanceFromRedis, getBoughtQuantityWithTagFromRedis, setBoughtQuantityWithTagToRedis } from './redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';
import { findSecondaryTarget } from './filters.js';
import { logTradeEvent } from './signalLogger.js';

async function triggerOrder(requestBody) {
    if (!requestBody || requestBody.quantity <= 0) {
        logger.warn('Order quantity is zero or negative, skipping order trigger.');
        return;
    }
    const placeOrderApi = process.env.PLACEORDER_API;
    if (placeOrderApi) {
        try {
            const res = await axios.post(placeOrderApi, requestBody);
            logger.debug('Order API response:', res.data);
        } catch (err) {
            logger.error('Order API error:', err.message);
        }
    } else {
        logger.error('PLACEORDER_API env variable not set');
    }
}

async function computeOrderPayload(strategy_details, transaction_type, ltp, tag, quantityOverride) {
    let {
        account_id,
        use_full_amount = false,
        quantity = 1,
        lot_size,
        instrument_token,
        product = 'D',
        validity = 'DAY',
        order_type = 'MARKET',
        is_amo = false,
        slice = true,
        disclosed_quantity = 0,
        trigger_price = 0,
        commission_type = 'PERCENTAGE',
        commission_rate = 0,
    } = strategy_details;

    if (quantityOverride != null && quantityOverride > 0) {
        quantity = quantityOverride;
    } else if (transaction_type === 'BUY' && use_full_amount) {
        const current_acc_balance = await getAccountBalanceFromRedis(account_id);
        let maxAffordableValue = current_acc_balance;
        if (commission_type === 'FLAT') {
            maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
        } else if (commission_type === 'PERCENTAGE') {
            maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
        }
        maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);
        if (lot_size) {
            quantity = Math.floor(maxAffordableValue / (ltp * lot_size)) * lot_size;
        } else {
            quantity = Math.floor(maxAffordableValue / ltp);
        }
    }

    if (transaction_type === 'SELL' && use_full_amount && quantityOverride == null) {
        quantity = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
    }

    const isLive = strategy_details.strategy_mode === 'LIVE' || strategy_details.isTest === false;
    return {
        quantity,
        product,
        validity,
        price: (order_type === 'MARKET' && isLive) ? 0 : ltp,
        tag: tag ? tag.replace(/[^a-zA-Z0-9_-]/g, '_') : '',
        instrument_token,
        order_type,
        transaction_type,
        disclosed_quantity: Number(disclosed_quantity),
        trigger_price: Number(trigger_price),
        is_amo: String(is_amo) === 'true',
        slice: String(slice) === 'true',
        strategy_details,
    };
}

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

    const target = isLong ? entry + targetDist : entry - targetDist;
    const target1 = isLong ? entry + minTargetDist : entry - minTargetDist;

    return { entry, stop, target, target1, riskDistance, isLong };
}

async function computeRiskBasedQuantity(strategy_details, entry, riskDistance, params) {
    if (riskDistance <= 0 || entry <= 0) {
        return 1;
    }
    const balance = await getAccountBalanceFromRedis(strategy_details.account_id);
    const riskAmount = balance * params.accountRiskPerTrade;
    const qty = Math.floor(riskAmount / riskDistance);
    if (strategy_details.lot_size) {
        const lot = strategy_details.lot_size;
        return Math.max(Math.floor(qty / lot) * lot, lot);
    }
    return Math.max(qty, 1);
}

async function openPosition(signal, state, symbol, strategy_details, params, openedAt) {
    const levels = buildTradeLevels(signal, state, params);
    const qty = await computeRiskBasedQuantity(
        strategy_details,
        levels.entry,
        levels.riskDistance,
        params
    );

    const transactionType = levels.isLong ? 'BUY' : 'SELL';
    const requestBody = await computeOrderPayload(
        strategy_details,
        transactionType,
        levels.entry,
        symbol,
        qty
    );

    if (requestBody?.quantity > 0) {
        await triggerOrder(requestBody);
        if (levels.isLong) {
            await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
        }
        logTradeEvent(symbol, 'OPEN', {
            direction: signal.direction,
            entry: levels.entry,
            stop: levels.stop,
            target: levels.target,
            qty: requestBody.quantity,
        });
    }

    return {
        direction: signal.direction,
        entry: levels.entry,
        stop: levels.stop,
        target: levels.target,
        target1: levels.target1,
        riskDistance: levels.riskDistance,
        qty: requestBody?.quantity || qty,
        remainingQty: requestBody?.quantity || qty,
        openedAt: openedAt || Date.now(),
        breakevenMoved: false,
        partialTaken: false,
    };
}

async function closePosition(position, ltp, symbol, strategy_details, reason, qtyOverride) {
    const isLong = position.direction === 'long';
    const closeQty = qtyOverride ?? position.remainingQty ?? position.qty;
    const transactionType = isLong ? 'SELL' : 'BUY';

    const requestBody = await computeOrderPayload(
        strategy_details,
        transactionType,
        ltp,
        symbol,
        closeQty
    );

    if (requestBody?.quantity > 0) {
        await triggerOrder(requestBody);
        logTradeEvent(symbol, 'CLOSE', { reason, ltp, qty: requestBody.quantity });
    }
}

async function manageOpenPosition(state, tick, symbol, strategy_details, params) {
    const position = state.position;
    if (!position) {
        return state;
    }

    const isLong = position.direction === 'long';
    const ltp = tick.ltp;
    const elapsedMin = (tick.timestamp - position.openedAt) / (60 * 1000);

    // Time stop
    if (elapsedMin >= params.timeStopMinutes) {
        const profitR = isLong
            ? (ltp - position.entry) / position.riskDistance
            : (position.entry - ltp) / position.riskDistance;
        if (profitR < params.breakevenAtR) {
            await closePosition(position, ltp, symbol, strategy_details, 'time_stop');
            return enterCooldown(state, params, tick.timestamp);
        }
    }

    // Breakeven at 1R
    if (!position.breakevenMoved) {
        const profitR = isLong
            ? (ltp - position.entry) / position.riskDistance
            : (position.entry - ltp) / position.riskDistance;
        if (profitR >= params.breakevenAtR) {
            position.stop = position.entry;
            position.breakevenMoved = true;
            logTradeEvent(symbol, 'BREAKEVEN', { stop: position.stop });
        }
    }

    // Stop hit
    const stopHit = isLong ? ltp <= position.stop : ltp >= position.stop;
    if (stopHit) {
        await closePosition(position, ltp, symbol, strategy_details, 'stop_loss');
        return enterCooldown(state, params, tick.timestamp);
    }

    // Partial exit at target1
    if (!position.partialTaken) {
        const target1Hit = isLong ? ltp >= position.target1 : ltp <= position.target1;
        if (target1Hit) {
            const partialQty = Math.floor(position.remainingQty * params.partialExitPct);
            if (partialQty > 0) {
                await closePosition(position, ltp, symbol, strategy_details, 'partial_target1', partialQty);
                position.remainingQty -= partialQty;
                position.partialTaken = true;
                logTradeEvent(symbol, 'PARTIAL', { qty: partialQty, remaining: position.remainingQty });
            }
        }
    }

    // Full target
    const targetHit = isLong ? ltp >= position.target : ltp <= position.target;
    if (targetHit && position.remainingQty > 0) {
        await closePosition(position, ltp, symbol, strategy_details, 'target', position.remainingQty);
        return enterCooldown(state, params, tick.timestamp);
    }

    return { ...state, position };
}

function enterCooldown(state, params, timestamp) {
    return {
        ...state,
        machineState: 'COOLDOWN',
        position: null,
        sweep: null,
        pendingSignal: null,
        cooldownUntil: timestamp + params.cooldownMinutes * 60 * 1000,
    };
}

export {
    triggerOrder,
    computeOrderPayload,
    buildTradeLevels,
    openPosition,
    manageOpenPosition,
    enterCooldown,
    closePosition,
};
