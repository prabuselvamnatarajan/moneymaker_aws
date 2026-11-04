import {
    getAccountBalanceFromRedis,
    getBoughtQuantityWithTagFromRedis,
    setBoughtQuantityWithTagToRedis,
} from '../redis_utils/account_utils.js';
import {
    reserveOpenSlot,
    releaseOpenSlot,
    decrementOpenPositions,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis,
} from '../redis_utils/concurrency.js';
import { logger } from '/app/utils/logUtils.js';
import { buildTradeLevels, updateTrailingStop } from './tradeLevels.js';
import { logTradeEvent } from './signalLogger.js';

/**
 * Sweep-specific quantity resolution (risk size is computed separately).
 * Short-cover and balance fallback (-0.05) run here before triggerOrder when
 * no explicit quantity was provided.
 */
async function resolveOrderQuantity(strategy_details, transaction_type, ltp, tag, quantityOverride) {
    let {
        account_id,
        use_full_amount = false,
        quantity = 1,
        no_of_lots = 1,
        lot_size,
        commission_type = 'PERCENTAGE',
        commission_rate = 0,
    } = strategy_details;

    const lot = Number(lot_size) > 0 ? Number(lot_size) : null;
    const lots = Number(no_of_lots) >= 1 ? Math.floor(Number(no_of_lots)) : 1;

    if (quantityOverride != null && quantityOverride > 0) {
        return quantityOverride;
    }

    if (transaction_type === 'BUY') {
        const shortQty = await getShortQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        if (shortQty > 0) {
            return shortQty;
        }
        if (use_full_amount) {
            const current_acc_balance = await getAccountBalanceFromRedis(account_id);
            let maxAffordableValue = current_acc_balance;
            if (commission_type === 'FLAT') {
                maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
            } else if (commission_type === 'PERCENTAGE') {
                maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
            }
            maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);
            if (lot) {
                return Math.floor(maxAffordableValue / (ltp * lot)) * lot;
            }
            return Math.floor(maxAffordableValue / ltp);
        }
        if (lot) {
            return lots * lot;
        }
        return quantity;
    }

    if (transaction_type === 'SELL') {
        quantity = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        if (quantity <= 0) {
            quantity = await getShortQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        }
        if (quantity <= 0) {
            if (use_full_amount) {
                const current_acc_balance = await getAccountBalanceFromRedis(account_id);
                let maxAffordableValue = current_acc_balance;
                if (commission_type === 'FLAT') {
                    maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
                } else if (commission_type === 'PERCENTAGE') {
                    maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
                }
                maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);
                if (lot) {
                    quantity = Math.floor(maxAffordableValue / (ltp * lot)) * lot;
                } else {
                    quantity = Math.floor(maxAffordableValue / ltp);
                }
            } else if (lot) {
                quantity = lots * lot;
            }
        }
        return quantity;
    }

    return quantity;
}

async function computeRiskBasedQuantity(strategy_details, entry, riskDistance, params) {
    const lot = Number(strategy_details.lot_size) > 0 ? Number(strategy_details.lot_size) : null;
    const lots = Number(strategy_details.no_of_lots) >= 1 ? Math.floor(Number(strategy_details.no_of_lots)) : 1;

    // When not using full balance / risk sizing with lot config, prefer fixed lot sizing
    if (!strategy_details.use_full_amount && lot) {
        return lots * lot;
    }

    if (riskDistance <= 0 || entry <= 0) {
        return lot ? lot : 1;
    }
    const balance = await getAccountBalanceFromRedis(strategy_details.account_id);
    const riskAmount = balance * params.accountRiskPerTrade;
    const qty = Math.floor(riskAmount / riskDistance);
    if (lot) {
        return Math.max(Math.floor(qty / lot) * lot, lot);
    }
    return Math.max(qty, 1);
}

async function tryExecuteEntry(strategy, signal, state, symbol, strategy_details, params, openedAt) {
    const levels = buildTradeLevels(signal, state, params);
    if (!levels.sufficientRR) {
        logTradeEvent(symbol, 'skipped_insufficient_rr', {
            targetDist: levels.targetDist,
            minRequired: levels.riskDistance * params.minRR,
        }, strategy_details);
        return { position: null, reason: 'insufficient_rr' };
    }

    const qty = await computeRiskBasedQuantity(
        strategy_details,
        levels.entry,
        levels.riskDistance,
        params
    );

    const transactionType = levels.isLong ? 'BUY' : 'SELL';
    const quantity = await resolveOrderQuantity(
        strategy_details,
        transactionType,
        levels.entry,
        symbol,
        qty
    );

    if (!quantity || quantity <= 0) {
        return { position: null, reason: 'zero_qty' };
    }

    const slotReserved = await reserveOpenSlot(strategy_details.account_id, params.maxConcurrentTrades);
    if (!slotReserved) {
        logTradeEvent(symbol, 'skipped_max_concurrent', { max: params.maxConcurrentTrades }, strategy_details);
        return { position: null, reason: 'max_concurrent' };
    }

    const { placed, order } = await strategy.triggerOrder(transactionType, {
        price: levels.entry,
        quantity,
        tag: symbol,
        timestamp: openedAt,
    });
    if (!placed) {
        await releaseOpenSlot(strategy_details.account_id);
        logTradeEvent(symbol, 'skipped_order_failed', { transactionType }, strategy_details);
        return { position: null, reason: 'order_failed' };
    }

    if (levels.isLong) {
        await setBoughtQuantityWithTagToRedis(symbol, order.quantity, strategy_details.deployment_id);
    } else {
        await setShortQuantityWithTagToRedis(symbol, order.quantity, strategy_details.deployment_id);
    }

    logTradeEvent(symbol, 'OPEN', {
        direction: signal.direction,
        entry: levels.entry,
        stop: levels.stop,
        target: levels.target,
        qty: order.quantity,
    }, strategy_details);

    return {
        position: {
            direction: signal.direction,
            entry: levels.entry,
            stop: levels.stop,
            target: levels.target,
            target1: levels.target1,
            riskDistance: levels.riskDistance,
            qty: order.quantity,
            remainingQty: order.quantity,
            openedAt: openedAt || Date.now(),
            breakevenMoved: false,
            partialTaken: false,
            trailStop: null,
        },
        reason: null,
    };
}

async function openPosition(strategy, signal, state, symbol, strategy_details, params, openedAt) {
    const result = await tryExecuteEntry(strategy, signal, state, symbol, strategy_details, params, openedAt);
    return result.position;
}

async function closePosition(strategy, position, ltp, symbol, strategy_details, reason, qtyOverride, timestamp) {
    const isLong = position.direction === 'long';
    const closeQty = qtyOverride ?? position.remainingQty ?? position.qty;
    const transactionType = isLong ? 'SELL' : 'BUY';

    const quantity = await resolveOrderQuantity(
        strategy_details,
        transactionType,
        ltp,
        symbol,
        closeQty
    );

    if (!quantity || quantity <= 0) {
        logger.warn(`[liquidity_sweep] Skipping close (${reason}): zero quantity`);
        return false;
    }

    const { placed, order } = await strategy.triggerOrder(transactionType, {
        price: ltp,
        quantity,
        tag: symbol,
        timestamp,
    });
    if (!placed) {
        logTradeEvent(symbol, 'close_failed', { reason, ltp, qty: quantity }, strategy_details);
        return false;
    }

    if (isLong) {
        const remaining = Math.max(0, (await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id)) - quantity);
        await setBoughtQuantityWithTagToRedis(symbol, remaining, strategy_details.deployment_id);
    } else {
        const remaining = Math.max(0, (await getShortQuantityWithTagFromRedis(symbol, strategy_details.deployment_id)) - quantity);
        await setShortQuantityWithTagToRedis(symbol, remaining, strategy_details.deployment_id);
    }
    logTradeEvent(symbol, 'CLOSE', { reason, ltp, qty: order.quantity }, strategy_details);
    return true;
}

async function finalizeClose(state, tick, symbol, strategy_details, params) {
    await decrementOpenPositions(strategy_details.account_id);
    return enterCooldown(state, params, tick.timestamp);
}

async function manageOpenPosition(strategy, state, tick, symbol, strategy_details, params) {
    const position = state.position;
    if (!position) {
        return state;
    }

    const isLong = position.direction === 'long';
    const ltp = tick.ltp;
    const elapsedMin = (tick.timestamp - position.openedAt) / (60 * 1000);

    if (elapsedMin >= params.timeStopMinutes) {
        const profitR = isLong
            ? (ltp - position.entry) / position.riskDistance
            : (position.entry - ltp) / position.riskDistance;
        if (profitR < params.breakevenAtR) {
            const closed = await closePosition(strategy, position, ltp, symbol, strategy_details, 'time_stop', null, tick.timestamp);
            if (closed) {
                return finalizeClose(state, tick, symbol, strategy_details, params);
            }
            return { ...state, position };
        }
    }

    if (!position.breakevenMoved) {
        const profitR = isLong
            ? (ltp - position.entry) / position.riskDistance
            : (position.entry - ltp) / position.riskDistance;
        if (profitR >= params.breakevenAtR) {
            position.stop = position.entry;
            position.breakevenMoved = true;
            logTradeEvent(symbol, 'BREAKEVEN', { stop: position.stop }, strategy_details);
        }
    }

    updateTrailingStop(position, ltp, params);

    const effectiveStop = position.partialTaken && position.trailStop != null
        ? (isLong ? Math.max(position.stop, position.trailStop) : Math.min(position.stop, position.trailStop))
        : position.stop;

    const stopHit = isLong ? ltp <= effectiveStop : ltp >= effectiveStop;
    if (stopHit) {
        const closed = await closePosition(
            strategy,
            position,
            ltp,
            symbol,
            strategy_details,
            position.partialTaken ? 'trail_stop' : 'stop_loss',
            null,
            tick.timestamp
        );
        if (closed) {
            return finalizeClose(state, tick, symbol, strategy_details, params);
        }
        return { ...state, position };
    }

    if (!position.partialTaken) {
        const target1Hit = isLong ? ltp >= position.target1 : ltp <= position.target1;
        if (target1Hit) {
            let partialQty = Math.floor(position.remainingQty * params.partialExitPct);
            const lot = Number(strategy_details.lot_size) > 0 ? Number(strategy_details.lot_size) : null;
            if (lot) {
                partialQty = Math.floor(partialQty / lot) * lot;
            }
            if (partialQty <= 0 && position.remainingQty > 1) {
                partialQty = lot ? Math.min(lot, position.remainingQty) : 1;
            }
            if (partialQty > 0) {
                const closed = await closePosition(strategy, position, ltp, symbol, strategy_details, 'partial_target1', partialQty, tick.timestamp);
                if (closed) {
                    position.remainingQty -= partialQty;
                    position.partialTaken = true;
                    position.trailStop = position.breakevenMoved ? position.entry : position.stop;
                    logTradeEvent(symbol, 'PARTIAL', { qty: partialQty, remaining: position.remainingQty }, strategy_details);
                }
            }
        }
    }

    const targetHit = isLong ? ltp >= position.target : ltp <= position.target;
    if (targetHit && position.remainingQty > 0) {
        const closed = await closePosition(strategy, position, ltp, symbol, strategy_details, 'target', position.remainingQty, tick.timestamp);
        if (closed) {
            return finalizeClose(state, tick, symbol, strategy_details, params);
        }
        return { ...state, position };
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
    resolveOrderQuantity,
    openPosition,
    tryExecuteEntry,
    manageOpenPosition,
    enterCooldown,
    closePosition,
};
export { buildTradeLevels, updateTrailingStop } from './tradeLevels.js';
