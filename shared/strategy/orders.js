import axios from 'axios';
import {
    getAccountBalanceFromRedis,
    getBoughtQuantityWithTagFromRedis,
    acquireOrderLockInRedis,
    releaseOrderLockInRedis,
} from '/app/redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';

/**
 * Shared order body construction.
 * Explicit quantity is used as given. With no quantity:
 * - SELL uses bought quantity only
 * - BUY uses MSB full-balance / lots / fixed-quantity rules (+ 1e-5 before flooring)
 * client_order_id is added only when includeClientOrderId is true.
 */
export async function computeOrderPayload({
    strategyDetails,
    transactionType,
    price: ltp,
    tag,
    timestamp,
    quantity: quantityOverride,
    includeClientOrderId = false,
} = {}) {
    const strategy_details = strategyDetails || {};
    let {
        account_id,
        use_full_amount = false,
        quantity = 1,
        no_of_lots = 1,
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

    const lot = Number(lot_size) > 0 ? Number(lot_size) : null;
    const lots = Number(no_of_lots) >= 1 ? Math.floor(Number(no_of_lots)) : 1;
    const isBacktest =
        strategy_details.strategy_mode === 'BACKTEST' || strategy_details.isTest === true;

    if (quantityOverride != null && Number(quantityOverride) >= 0 && Number.isFinite(Number(quantityOverride))) {
        quantity = Number(quantityOverride);
    } else if (transactionType === 'SELL') {
        // Exit long: only sell when Redis holdings exist (never invent qty)
        const boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        quantity = boughtQty > 0 ? boughtQty : 0;
    } else if (transactionType === 'BUY') {
        if (use_full_amount) {
            const current_acc_balance = await getAccountBalanceFromRedis(
                account_id,
                strategy_details.deployment_id,
                isBacktest
            );
            if (current_acc_balance != null && current_acc_balance >= 0) {
                let maxAffordableValue = current_acc_balance;
                if (commission_type === 'FLAT') {
                    maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
                } else if (commission_type === 'PERCENTAGE') {
                    maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
                }
                maxAffordableValue = Math.max(0, maxAffordableValue + 1e-5);

                if (lot) {
                    quantity = Math.floor(maxAffordableValue / (ltp * lot)) * lot;
                } else {
                    quantity = Math.floor(maxAffordableValue / ltp);
                }
            } else {
                quantity = lot ? (lots * lot) : (strategy_details.quantity || 1);
            }
        } else if (lot) {
            quantity = lots * lot;
        } else {
            quantity = Number(strategy_details.quantity) > 0 ? Number(strategy_details.quantity) : 1;
        }
    }

    if (timestamp) {
        strategy_details.execution_time = new Date(timestamp).toISOString();
    }

    const cleanTag = tag ? tag.replace(/[^a-zA-Z0-9_-]/g, '_') : 'symbol';
    const orderPayLoad = {
        quantity,
        product,
        validity,
        price: ltp,
        tag: cleanTag,
        instrument_token,
        order_type,
        transaction_type: transactionType,
        disclosed_quantity: Number(disclosed_quantity),
        trigger_price: Number(trigger_price),
        is_amo: String(is_amo) === 'true',
        slice: String(slice) === 'true',
        strategy_details,
    };

    if (includeClientOrderId) {
        const tsMs = timestamp ? new Date(timestamp).getTime() : Date.now();
        orderPayLoad.client_order_id =
            `${strategy_details.deployment_id || 'manual'}_${cleanTag}_${transactionType}_${tsMs}`;
    }

    return orderPayLoad;
}

export async function placeOrderHttp(requestBody, retries = 1) {
    if (!requestBody || requestBody.quantity <= 0) {
        logger.warn('Order quantity is zero or negative, skipping order trigger.');
        return false;
    }
    const placeOrderApi = process.env.PLACEORDER_API;
    if (!placeOrderApi) {
        logger.error('PLACEORDER_API env variable not set');
        return false;
    }
    const attempts = Math.max(1, Number(retries) || 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const res = await axios.post(placeOrderApi, requestBody);
            if (res.status >= 200 && res.status < 300) {
                logger.debug('Order API response:', res.data);
                return true;
            }
            logger.error(`Order API non-success status on attempt ${attempt}: ${res.status}`);
        } catch (err) {
            logger.error(`Order API error on attempt ${attempt}/${attempts}: ${err.message}`);
        }
        if (attempt < attempts) {
            await new Promise((res) => setTimeout(res, 50 * attempt));
        }
    }
    return false;
}

export async function executeOrderWithLock(symbol, deploymentId, orderFn) {
    const lockAcquired = await acquireOrderLockInRedis(symbol, deploymentId);
    if (!lockAcquired) {
        logger.warn(
            `Order placement already in-flight for ${symbol} (deployment: ${deploymentId}). Skipping duplicate tick trigger.`
        );
        return false;
    }
    try {
        return await orderFn();
    } finally {
        await releaseOrderLockInRedis(symbol, deploymentId);
    }
}
