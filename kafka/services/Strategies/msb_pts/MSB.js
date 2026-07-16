import axios from 'axios';
import { 
    getAccountBalanceFromRedis, 
    getBoughtQuantityWithTagFromRedis, 
    setBoughtQuantityWithTagToRedis,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis 
} from './redis_utils/account_utils.js';
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

async function computeOrderPayload(strategy_details, transaction_type, ltp, tag, timestamp) {
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

    if (use_full_amount) {
        if (transaction_type === "BUY") {
            // Check if we are closing a SHORT position
            let shortQty = await getShortQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
            if (shortQty > 0) {
                quantity = shortQty;
            } else {
                // Opening a LONG position
                let current_acc_balance = await getAccountBalanceFromRedis(account_id);
                let maxAffordableValue = current_acc_balance;
                if (commission_type === "FLAT") {
                    maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
                } else if (commission_type === "PERCENTAGE") {
                    maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
                }
                maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);

                if (lot_size) {
                    quantity = Math.floor(maxAffordableValue / (ltp * lot_size)) * lot_size;
                } else {
                    quantity = Math.floor(maxAffordableValue / ltp);
                }
            }
        } else if (transaction_type === "SELL") {
            // Check if we are closing a LONG position
            let boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
            if (boughtQty > 0) {
                quantity = boughtQty;
            } else {
                // Opening a SHORT position
                let current_acc_balance = await getAccountBalanceFromRedis(account_id);
                let maxAffordableValue = current_acc_balance;
                if (commission_type === "FLAT") {
                    maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
                } else if (commission_type === "PERCENTAGE") {
                    maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
                }
                maxAffordableValue = Math.max(0, maxAffordableValue - 0.05);

                if (lot_size) {
                    quantity = Math.floor(maxAffordableValue / (ltp * lot_size)) * lot_size;
                } else {
                    quantity = Math.floor(maxAffordableValue / ltp);
                }
            }
        }
    } else {
        // If not use_full_amount, fetch correct quantity for exits
        if (transaction_type === "BUY") {
            let shortQty = await getShortQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
            if (shortQty > 0) {
                quantity = shortQty;
            }
        } else if (transaction_type === "SELL") {
            let boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
            if (boughtQty > 0) {
                quantity = boughtQty;
            }
        }
    }

    if (timestamp) {
        strategy_details.execution_time = new Date(timestamp).toISOString();
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
    if (!prevData || Object.keys(prevData).length === 0) {
        // initialize
        let initialState = {
            isUp: null,
            prevHigh: { high: currentData.high, low: currentData.low },
            prevLow: { high: currentData.high, low: currentData.low },
            lastBuyPrice: null,
            lastSellPrice: null,
            position: null,
            closedByTargetOrSl: false
        };
        return initialState;
    }

    let { isUp, prevHigh, prevLow, lastBuyPrice, lastSellPrice, position, closedByTargetOrSl = false } = prevData;
    let { isTest } = strategy_details;
    let { high, low, ltp } = currentData;

    let target_type = strategy_details.target_type || "POINTS";
    let target_pts = strategy_details.target_pts !== undefined ? strategy_details.target_pts : 500;
    let sl_pts = strategy_details.sl_pts !== undefined ? strategy_details.sl_pts : 500;
    let target_pct = strategy_details.target_pct !== undefined ? strategy_details.target_pct : 2;
    let sl_pct = strategy_details.sl_pct !== undefined ? strategy_details.sl_pct : 2;
    let advance_trade_decision = strategy_details.advance_trade_decision !== undefined ? strategy_details.advance_trade_decision : true;

    // Check if previous schema's lastBuyPrice is set but new position object is not initialized
    if (lastBuyPrice && !position) {
        position = { direction: "LONG", entryPrice: lastBuyPrice };
    }

    // 1. Check for Target or Stop Loss hit first
    let targetHit = false;
    let slHit = false;

    if (advance_trade_decision && position) {
        if (position.direction === "LONG") {
            if (target_type === "PERCENTAGE") {
                targetHit = ltp >= position.entryPrice * (1 + target_pct / 100);
                slHit = ltp <= position.entryPrice * (1 - sl_pct / 100);
            } else {
                targetHit = ltp >= position.entryPrice + target_pts;
                slHit = ltp <= position.entryPrice - sl_pts;
            }
        } else if (position.direction === "SHORT") {
            if (target_type === "PERCENTAGE") {
                targetHit = ltp <= position.entryPrice * (1 - target_pct / 100);
                slHit = ltp >= position.entryPrice * (1 + sl_pct / 100);
            } else {
                targetHit = ltp <= position.entryPrice - target_pts;
                slHit = ltp >= position.entryPrice + sl_pts;
            }
        }
    }

    if (targetHit || slHit) {
        if (position.direction === "LONG") {
            if (isTest) {
                logger.info(`msb_pts Test: Closing Test LONG position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            } else {
                logger.info(`msb_pts: Closing Live LONG position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            }
            let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
            }
            await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
        } else if (position.direction === "SHORT") {
            if (isTest) {
                logger.info(`msb_pts Test: Closing Test SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            } else {
                logger.info(`msb_pts: Closing Live SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            }
            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
            }
            await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
        }

        position = null;
        lastBuyPrice = null;
        lastSellPrice = null;
        closedByTargetOrSl = true;
    }

    // 2. Trend breakout logic
    if (isUp === null) {
        // Trend is not established yet
        if (prevLow.high < high) {
            isUp = true;
            logger.info(`msb_pts: Established initial trend UP at ${high}. Opening LONG position.`);
            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
                await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
                position = { direction: "LONG", entryPrice: ltp };
                lastBuyPrice = ltp;
                closedByTargetOrSl = false;
            }
            prevHigh.high = high;
            prevHigh.low = low;
        } else if (prevHigh.low > low) {
            isUp = false;
            logger.info(`msb_pts: Established initial trend DOWN at ${low}.`);
            prevLow.high = high;
            prevLow.low = low;
        } else {
            // Update both trackers in range
            if (prevHigh.high < high) {
                prevHigh.high = high;
                prevHigh.low = low;
            }
            if (prevLow.low > low) {
                prevLow.high = high;
                prevLow.low = low;
            }
        }
    } else if (isUp) {
        // Up trend
        if (prevHigh.low > low) {
            // Trend broke down
            isUp = false;

            // Handle LONG exit
            if (position && position.direction === "LONG") {
                if (closedByTargetOrSl) {
                    logger.info(`msb_pts: Skip duplicate exit order for LONG. Position already closed by Target/SL.`);
                    closedByTargetOrSl = false;
                } else {
                    logger.info(`msb_pts: Closing LONG position at ${ltp} on trend break DOWN`);
                    let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol, currentData.timestamp);
                    if (requestBody && requestBody.quantity > 0) {
                        await triggerOrder(requestBody);
                    }
                    await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                }
                position = null;
                lastBuyPrice = null;
            }

            prevLow.high = high;
            prevLow.low = low;
        } else {
            // Trend continuation
            if (prevHigh.high < high) {
                prevHigh.high = high;
                prevHigh.low = low;
            }
        }
    } else {
        // Down trend
        if (prevLow.high < high) {
            // Trend broke up
            isUp = true;

            // Handle SHORT exit (if any short position was active)
            if (position && position.direction === "SHORT") {
                if (closedByTargetOrSl) {
                    logger.info(`msb_pts: Skip duplicate exit order for SHORT. Position already closed by Target/SL.`);
                    closedByTargetOrSl = false;
                } else {
                    logger.info(`msb_pts: Closing SHORT position at ${ltp} on trend break UP`);
                    let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
                    if (requestBody && requestBody.quantity > 0) {
                        await triggerOrder(requestBody);
                    }
                    await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                }
                position = null;
                lastSellPrice = null;
            }

            // Open LONG position (entry signal)
            logger.info(`msb_pts: Opening LONG position at ${ltp} on trend break UP`);
            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                await triggerOrder(requestBody);
                await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
                position = { direction: "LONG", entryPrice: ltp };
                lastBuyPrice = ltp;
                closedByTargetOrSl = false;
            }

            prevHigh.high = high;
            prevHigh.low = low;
        } else {
            // Trend continuation
            if (prevLow.low > low) {
                prevLow.high = high;
                prevLow.low = low;
            }
        }
    }

    return { isUp, prevHigh, prevLow, lastBuyPrice, lastSellPrice, position, closedByTargetOrSl };
}

export { MSB };
