import axios from 'axios';
import { 
    getAccountBalanceFromRedis, 
    getBoughtQuantityWithTagFromRedis, 
    setBoughtQuantityWithTagToRedis,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis,
    acquireOrderLockInRedis,
    releaseOrderLockInRedis
} from './redis_utils/account_utils.js';
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

async function executeOrderWithLock(symbol, deploymentId, orderFn) {
    const lockAcquired = await acquireOrderLockInRedis(symbol, deploymentId);
    if (!lockAcquired) {
        logger.warn(`msb_pts: Order placement already in-flight for ${symbol} (deployment: ${deploymentId}). Skipping duplicate tick trigger.`);
        return false;
    }
    try {
        return await orderFn();
    } finally {
        await releaseOrderLockInRedis(symbol, deploymentId);
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

    const computeAffordableQty = async () => {
        let current_acc_balance = await getAccountBalanceFromRedis(account_id);
        let maxAffordableValue = current_acc_balance;
        if (commission_type === "FLAT") {
            maxAffordableValue = Math.max(0, current_acc_balance - commission_rate);
        } else if (commission_type === "PERCENTAGE") {
            maxAffordableValue = current_acc_balance / (1 + (commission_rate / 100));
        }
        maxAffordableValue = Math.max(0, maxAffordableValue + 1e-5);
        if (lot) {
            return Math.floor(maxAffordableValue / (ltp * lot)) * lot;
        }
        return Math.floor(maxAffordableValue / ltp);
    };

    if (transaction_type === "BUY") {
        // Closing a SHORT takes priority
        let shortQty = await getShortQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        if (shortQty > 0) {
            quantity = shortQty;
        } else if (use_full_amount) {
            quantity = await computeAffordableQty();
        } else if (lot) {
            quantity = lots * lot;
        } else {
            quantity = Number(strategy_details.quantity) > 0 ? Number(strategy_details.quantity) : 1;
        }
    } else if (transaction_type === "SELL") {
        // Closing a LONG takes priority
        let boughtQty = await getBoughtQuantityWithTagFromRedis(tag, strategy_details.deployment_id);
        if (boughtQty > 0) {
            quantity = boughtQty;
        } else if (use_full_amount) {
            quantity = await computeAffordableQty();
        } else if (lot) {
            quantity = lots * lot;
        } else {
            quantity = Number(strategy_details.quantity) > 0 ? Number(strategy_details.quantity) : 1;
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

async function MSB(prevData, currentData, symbol, strategy_details) {
    const currentCandleState = currentData.candleState || prevData?.candleState;
    let { high, low, ltp } = currentData;
    let { isTest } = strategy_details;

    let isUp;
    let prevHigh;
    let prevLow;
    let lastBuyPrice;
    let lastSellPrice;
    let position;
    let closedByTargetOrSl = false;

    const swingsInvalid = !prevData || Object.keys(prevData).length === 0
        || !prevData.prevHigh || prevData.prevHigh.high === null || prevData.prevHigh.high === undefined
        || !prevData.prevLow || prevData.prevLow.high === null || prevData.prevLow.high === undefined;

    if (swingsInvalid) {
        // Re-initialize swings but preserve any open position / entry so SL/target exits survive state recovery.
        // Fall through to target/SL checks on this same tick (do not delay exit by one bar).
        const preservedPosition = prevData?.position
            || (prevData?.lastBuyPrice ? { direction: "LONG", entryPrice: prevData.lastBuyPrice } : null);
        isUp = null;
        prevHigh = { high, low };
        prevLow = { high, low };
        lastBuyPrice = preservedPosition?.direction === "LONG"
            ? (preservedPosition.entryPrice ?? prevData?.lastBuyPrice ?? null)
            : (prevData?.lastBuyPrice ?? null);
        lastSellPrice = prevData?.lastSellPrice ?? null;
        position = preservedPosition;
        closedByTargetOrSl = prevData?.closedByTargetOrSl ?? false;
    } else {
        ({ isUp, prevHigh, prevLow, lastBuyPrice, lastSellPrice, position, closedByTargetOrSl = false } = prevData);
    }

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
                const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                    const placed = await triggerOrder(requestBody);
                    if (placed) {
                        await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                        position = null;
                        lastBuyPrice = null;
                        lastSellPrice = null;
                        closedByTargetOrSl = true;
                    } else {
                        logger.warn('msb_pts: Target/SL SELL failed; keeping position for retry');
                    }
                    return placed;
                });
            } else {
                logger.warn(`msb_pts: Skipping Target/SL SELL due to zero/negative quantity: ${requestBody?.quantity}`);
            }
        } else if (position.direction === "SHORT") {
            if (isTest) {
                logger.info(`msb_pts Test: Closing Test SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            } else {
                logger.info(`msb_pts: Closing Live SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
            }
            let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
            if (requestBody && requestBody.quantity > 0) {
                const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                    const placed = await triggerOrder(requestBody);
                    if (placed) {
                        await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                        position = null;
                        lastBuyPrice = null;
                        lastSellPrice = null;
                        closedByTargetOrSl = true;
                    } else {
                        logger.warn('msb_pts: Target/SL BUY (cover short) failed; keeping position for retry');
                    }
                    return placed;
                });
            } else {
                logger.warn(`msb_pts: Skipping Target/SL BUY due to zero/negative quantity: ${requestBody?.quantity}`);
            }
        }
    }

    // 2. Trend breakout logic
    if (isUp === null) {
        // Trend is not established yet
        if (prevLow.high < high) {
            const existingHoldings = await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
            if (existingHoldings > 0 || position) {
                // Recover LONG awareness after state wipe that preserved bought_quantity
                if (!position) {
                    position = { direction: "LONG", entryPrice: lastBuyPrice || ltp };
                    lastBuyPrice = position.entryPrice;
                    logger.warn(
                        `msb_pts: Skipping initial BUY — holdings already present (${existingHoldings}). Restored LONG state.`
                    );
                }
                isUp = true;
                prevHigh.high = high;
                prevHigh.low = low;
            } else {
                logger.info(`msb_pts: Established initial trend UP at ${high}. Opening LONG position.`);
                let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
                if (requestBody && requestBody.quantity > 0) {
                    const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                        const placed = await triggerOrder(requestBody);
                        if (placed) {
                            await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
                            position = { direction: "LONG", entryPrice: ltp };
                            lastBuyPrice = ltp;
                            closedByTargetOrSl = false;
                            isUp = true;
                            prevHigh.high = high;
                            prevHigh.low = low;
                        } else {
                            logger.warn('msb_pts: Initial BUY failed; not opening position');
                        }
                        return placed;
                    });
                }
            }
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
            if (closedByTargetOrSl) {
                logger.info(`msb_pts: Skip duplicate exit order for LONG. Position already closed by Target/SL.`);
                closedByTargetOrSl = false;
                position = null;
                lastBuyPrice = null;
            } else if (position && position.direction === "LONG") {
                logger.info(`msb_pts: Closing LONG position at ${ltp} on trend break DOWN`);
                let requestBody = await computeOrderPayload(strategy_details, "SELL", ltp, symbol, currentData.timestamp);
                if (requestBody && requestBody.quantity > 0) {
                    const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                        const placed = await triggerOrder(requestBody);
                        if (placed) {
                            await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                            position = null;
                            lastBuyPrice = null;
                        } else {
                            logger.warn('msb_pts: Trend-break SELL failed; keeping position for retry');
                        }
                        return placed;
                    });
                } else {
                    logger.warn(`msb_pts: Skipping trend-break SELL due to zero/negative quantity: ${requestBody?.quantity}`);
                }
            } else if (!position) {
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
            if (closedByTargetOrSl) {
                logger.info(`msb_pts: Skip duplicate exit order for SHORT. Position already closed by Target/SL.`);
                closedByTargetOrSl = false;
                position = null;
                lastSellPrice = null;
            } else if (position && position.direction === "SHORT") {
                logger.info(`msb_pts: Closing SHORT position at ${ltp} on trend break UP`);
                let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
                if (requestBody && requestBody.quantity > 0) {
                    const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                        const placed = await triggerOrder(requestBody);
                        if (placed) {
                            await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                            position = null;
                            lastSellPrice = null;
                        } else {
                            logger.warn('msb_pts: Trend-break short cover failed; keeping position for retry');
                        }
                        return placed;
                    });
                } else {
                    logger.warn(`msb_pts: Skipping short cover due to zero/negative quantity: ${requestBody?.quantity}`);
                }
            } else if (!position) {
                lastSellPrice = null;
            }

            // Open LONG position (entry signal) only when flat and Redis has no leftover holdings
            if (!position) {
                const existingHoldings = await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
                if (existingHoldings > 0) {
                    position = { direction: "LONG", entryPrice: lastBuyPrice || ltp };
                    lastBuyPrice = position.entryPrice;
                    logger.warn(
                        `msb_pts: Skipping trend-break BUY — holdings already present (${existingHoldings}). Restored LONG state.`
                    );
                } else {
                    logger.info(`msb_pts: Opening LONG position at ${ltp} on trend break UP`);
                    let requestBody = await computeOrderPayload(strategy_details, "BUY", ltp, symbol, currentData.timestamp);
                    if (requestBody && requestBody.quantity > 0) {
                        const orderPlaced = await executeOrderWithLock(symbol, strategy_details.deployment_id, async () => {
                            const placed = await triggerOrder(requestBody);
                            if (placed) {
                                await setBoughtQuantityWithTagToRedis(symbol, requestBody.quantity, strategy_details.deployment_id);
                                position = { direction: "LONG", entryPrice: ltp };
                                lastBuyPrice = ltp;
                                closedByTargetOrSl = false;
                            } else {
                                logger.warn('msb_pts: BUY order failed; not opening LONG position');
                            }
                            return placed;
                        });
                    }
                }
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

    return { isUp, prevHigh, prevLow, lastBuyPrice, lastSellPrice, position, closedByTargetOrSl, candleState: currentCandleState };
}

export { MSB };
