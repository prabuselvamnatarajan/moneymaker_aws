import axios from 'axios';
import { getAccountBalanceFromRedis, getBoughtQuantityWithTagFromRedis, setBoughtQuantityWithTagToRedis } from './redis_utils/account_utils.js';
import { logger } from '../../../../MicroServices/Shared/utils/logUtils.js';

async function triggerOrder(requestBody) {
    const placeOrderApi = process.env.PLACEORDER_API;
    if (placeOrderApi) {
        axios.post(placeOrderApi, requestBody)
            .then(res => {
                logger.debug('Order API response:', res.data);
            })
            .catch(err => {
                logger.error('Order API error:', err.message);
            });
    } else {
        logger.error('PLACEORDER_API env variable not set');
    }
}

async function computeOrderPayload(strategy_details, transaction_type, ltp, tag) {
    let { account_id, use_full_amount = false, quantity = 1, lot_size, instrument_token, product = "D", validity = "DAY", order_type = "MARKET" } = strategy_details;
    if ( transaction_type == "BUY" && use_full_amount) {
        let current_acc_balance = await getAccountBalanceFromRedis(account_id);
        if (lot_size) {
            quantity = Math.floor(current_acc_balance / (ltp * lot_size)) * lot_size;
        } else {
            quantity = Math.floor(current_acc_balance / ltp);
        }
    }
    if (transaction_type == "SELL" && use_full_amount) {
        // For SELL orders, quantity should be determined based on holdings.
        // so we get the last bought quantity from redis with the tag.
        quantity = await getBoughtQuantityWithTagFromRedis(tag);
    };
    let orderPayLoad = {
        quantity,
        product,
        validity,
        "price": ltp,
        tag,
        instrument_token,
        order_type,
        transaction_type,
        "disclosed_quantity": 0,
        "trigger_price": 0,
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
                logger.info(`MSB Test: Closing Live long position at ${low}`);
            } else {
                logger.info(`MSB: Closing Test long position at ${low}`);
            }

            let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol);
            await triggerOrder(requestBody);
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
                logger.info(`MSB Test: Opening Live long position at ${high}`);
            } else {
                logger.info(`MSB: Opening Test long position at ${high}`);
            }

            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol);
            await triggerOrder(requestBody);
            await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity);
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