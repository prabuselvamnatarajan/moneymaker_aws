import axios from 'axios';
import { getAccountBalanceFromRedis, getBoughtQuantityWithTagFromRedis, setBoughtQuantityWithTagToRedis } from './redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';

async function triggerOrder(requestBody) {
    if (!requestBody || requestBody.quantity <= 0) {
        logger.warn('Order quantity is zero or negative, skipping order trigger.');
        return false;
    }
    const placeOrderApi = process.env.PLACEORDER_API;
    if (!placeOrderApi) {
        logger.error('PLACEORDER_API env variable not set');
        return false;
    }
    try {
        const res = await axios.post(placeOrderApi, requestBody);
        if (res.status >= 200 && res.status < 300) {
            logger.debug('Order API response:', res.data);
            return true;
        }
        logger.error(`Order API non-success status: ${res.status}`);
        return false;
    } catch (err) {
        logger.error('Order API error:', err.message);
        return false;
    }
}

async function computeOrderPayload(strategy_details, transaction_type, ltp, tag, timestamp) {
    let { 
        account_id, 
        use_full_amount = false, 
        quantity = 1,
        no_of_lots = 1,
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

    const lot = Number(lot_size) > 0 ? Number(lot_size) : null;
    const lots = Number(no_of_lots) >= 1 ? Math.floor(Number(no_of_lots)) : 1;

    if (transaction_type === "SELL") {
        // Exit long: only sell when Redis holdings exist (never invent qty)
        const boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        quantity = boughtQty > 0 ? boughtQty : 0;
    } else if (transaction_type === "BUY") {
        if (use_full_amount) {
            let current_acc_balance = await getAccountBalanceFromRedis(account_id);
            let maxAffordableValue = current_acc_balance;
            if (commission_type === "FLAT") {
                maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
            } else if (commission_type === "PERCENTAGE") {
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

    if (timestamp) {
        strategy_details.execution_time = new Date(timestamp).toISOString();
    }
    let orderPayLoad = {
        quantity,
        product,
        validity,
        price: ltp,
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

function isValidSwing(swing) {
    return swing
        && typeof swing.high === 'number'
        && typeof swing.low === 'number';
}

function isValidState(prevData) {
    return prevData
        && isValidSwing(prevData.prevHigh)
        && isValidSwing(prevData.prevLow);
}

async function MSB(prevData, currentData, symbol, strategy_details) {
    const { high, low, ltp } = currentData;

    if (!isValidState(prevData)) {
        if (prevData) {
            logger.warn('MSB: Recovering from invalid/empty strategy state — re-initializing swing points');
        }
        return {
            isUp: null,
            prevHigh: { high, low },
            prevLow: { high, low },
        };
    }

    let { isUp, prevHigh, prevLow } = prevData;
    let { isTest } = strategy_details;
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

            const holdings = await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
            if (holdings <= 0) {
                logger.warn('MSB: Skipping SELL — no holdings in Redis');
            } else {
                let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol, currentData.timestamp);
                if (requestBody && requestBody.quantity > 0) {
                    const orderPlaced = await triggerOrder(requestBody);
                    if (orderPlaced) {
                        await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                    } else {
                        logger.warn('MSB: SELL order failed; leaving bought_quantity unchanged for retry');
                    }
                } else {
                    logger.warn(`MSB: Skipping SELL order due to zero/negative quantity: ${requestBody?.quantity}`);
                }
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

            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                const orderPlaced = await triggerOrder(requestBody);
                if (orderPlaced) {
                    await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
                } else {
                    logger.warn('MSB: BUY order failed; not updating bought_quantity');
                }
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

export { MSB, isValidState };
