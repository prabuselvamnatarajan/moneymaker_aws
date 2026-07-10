import axios from 'axios';
import { getAccountBalanceFromRedis, getBoughtQuantityWithTagFromRedis, setBoughtQuantityWithTagToRedis } from './redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';

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

async function computeOrderPayload(strategy_details, transaction_type, ltp, tag) {
    let { 
        account_id, 
        use_full_amount = false, 
        quantity = 1, 
        lot_size, 
        instrument_token, 
        product = "D", 
        validity = "DAY", 
        order_type = "MARKET",
        is_amo = false,
        slice = true,
        disclosed_quantity = 0,
        trigger_price = 0,
        commission_type = "PERCENTAGE",
        commission_rate = 0
    } = strategy_details;
    if ( transaction_type == "BUY" && use_full_amount) {
        let current_acc_balance = await getAccountBalanceFromRedis(account_id);
        let maxAffordableValue = current_acc_balance;
        if (commission_type === "FLAT") {
            maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
        } else if (commission_type === "PERCENTAGE") {
            maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
        }
        // Subtract a tiny safety buffer of 0.05 to prevent floating-point or rounding-off failures
        maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);

        if (lot_size) {
            quantity = Math.floor(maxAffordableValue / (ltp * lot_size)) * lot_size;
        } else {
            quantity = Math.floor(maxAffordableValue / ltp);
        }
    }
    if (transaction_type == "SELL" && use_full_amount) {
        // For SELL orders, quantity should be determined based on holdings.
        // so we get the last bought quantity from redis with the tag.
        quantity = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
    }
    const isLive = strategy_details.strategy_mode === 'LIVE' || strategy_details.isTest === false;
    let orderPayLoad = {
        quantity,
        product,
        validity,
        price: (order_type === "MARKET" && isLive) ? 0 : ltp,
        tag: tag ? tag.replace(/[^a-zA-Z0-9_-]/g, "_") : "",
        instrument_token,
        order_type,
        transaction_type,
        disclosed_quantity: Number(disclosed_quantity),
        trigger_price: Number(trigger_price),
        is_amo: String(is_amo) === 'true',
        slice: String(slice) === 'true',
        strategy_details
    };
    return orderPayLoad;
}

async function MSB(prevData, currentData, symbol, strategy_details) {
    if ( !prevData ) {
        // initialize
        let initialState = {
            isUp: null,
            prevHigh: { high: currentData.high, low: currentData.low },
            prevLow: { high: currentData.high, low: currentData.low }
        };
        return initialState;
    }
    let { isUp, prevHigh, prevLow } = prevData;
    let { isTest } = strategy_details;
    let { high, low, ltp } = currentData;
    if (isUp) {
        // check for break
        if (prevHigh.low > low) {
            prevLow.high = high;
            prevLow.low = low;
            isUp = false;
            // need to close long position
            if (isTest) {
                logger.info(`MSB Test: Closing Test long position at ${low}`);
            } else {
                logger.info(`MSB: Closing Live long position at ${low}`);
            }

            let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
            } else {
                logger.warn(`MSB: Skipping SELL order due to zero/negative quantity: ${requestBody?.quantity}`);
            }
        }
        else {
            // trend continuation
            if (prevHigh.high < high) {
                prevHigh.high = high;
                prevHigh.low = low;
            }
        }
    } else {
        // check for break
        if (prevLow.high < high) {
            prevHigh.high = high;
            prevHigh.low = low;
            isUp = true;
            // need to open long position
            if (isTest) {
                logger.info(`MSB Test: Opening Test long position at ${high}`);
            } else {
                logger.info(`MSB: Opening Live long position at ${high}`);
            }

            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
                await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
            } else {
                logger.warn(`MSB: Skipping BUY order due to zero/negative quantity: ${requestBody?.quantity}`);
            }
        }
        else {
            // trend continuation
            if (prevLow.low > low) {
                prevLow.high = high;
                prevLow.low = low;
            }
        }
    }
    return { isUp, prevHigh, prevLow };
}

export { MSB };