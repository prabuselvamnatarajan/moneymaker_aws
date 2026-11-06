import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Strategy } from '/app/strategy/Strategy.js';
import { buildTimeframeCandle } from './candleBuilder.js';
import {
    getBoughtQuantityWithTagFromRedis,
    setBoughtQuantityWithTagToRedis,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis,
} from '/app/redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';

function isRawTick(message) {
    return !!(
        message?.ltpc
        || message?.fullFeed
        || message?.marketFF
        || message?.indexFF
        || message?.firstLevelWithGreeks
    );
}

/**
 * Resolve candle + closedCandle for live ticks (buildTimeframeCandle) or
 * prebuilt test fixtures (high/low/ltp, optional closedCandle / isClosed).
 */
function resolveCandles(message, timeframe, existingCandleState) {
    if (isRawTick(message)) {
        const built = buildTimeframeCandle(message, timeframe, existingCandleState);
        if (built.candle) {
            built.candle.candleState = built.newCandleState;
        }
        return built;
    }

    let closedCandle;
    if (Object.prototype.hasOwnProperty.call(message, 'closedCandle')) {
        closedCandle = message.closedCandle;
    } else if (message?.isClosed === false) {
        closedCandle = null;
    } else if (message?.isClosed === true) {
        closedCandle = message;
    } else {
        closedCandle = message;
    }

    const candle = {
        high: message.high,
        low: message.low,
        ltp: message.ltp,
        timestamp: message.timestamp,
        isClosed: message.isClosed,
        candleState: message.candleState ?? existingCandleState,
    };

    return { candle, closedCandle, newCandleState: candle.candleState };
}

export class MsbPtsStrategy extends Strategy {
    static strategyName = 'msb_pts';
    static serializeByDeployment = true;
    static fatalOnMessageError = true;
    static lockOrders = true;
    static orderAttempts = 3;
    static includeClientOrderId = true;

    async executeStrategy(lastState, message, symbol, strategyDetails) {
        this.symbol = symbol;
        this.strategyDetails = strategyDetails || {};

        // Epoch mismatch: drop candle/swings (avoid old-TF semantics) but keep position for SL/target.
        // Only when the message carries a finite state_epoch (handleMessage always does after
        // assertFreshStateEpoch). Direct unit-test fixtures omit it and must keep state intact.
        let prevData = lastState;
        const messageEpoch = strategyDetails?.state_epoch;
        if (prevData
            && messageEpoch != null
            && Number.isFinite(Number(messageEpoch))
            && (prevData.state_epoch == null
                || Number(prevData.state_epoch) !== Number(messageEpoch))) {
            logger.error(
                `Resetting stale msb_pts candle epoch for ${symbol}: state_epoch=${prevData.state_epoch} message_epoch=${messageEpoch}`
            );
            const hasOpen = !!(prevData.position || prevData.lastBuyPrice);
            prevData = hasOpen
                ? {
                    isUp: null,
                    prevHigh: null,
                    prevLow: null,
                    lastBuyPrice: prevData.lastBuyPrice ?? null,
                    lastSellPrice: prevData.lastSellPrice ?? null,
                    position: prevData.position ?? null,
                    closedByTargetOrSl: prevData.closedByTargetOrSl ?? false,
                    candleState: null,
                    state_epoch: Number(messageEpoch),
                }
                : null;
        }

        const timeframe = strategyDetails.timeframe || '1m';
        strategyDetails.timeframe = timeframe;
        const existingCandleState = prevData?.candleState || null;
        const { candle, closedCandle } = resolveCandles(message, timeframe, existingCandleState);

        if (!candle || candle.high == null || candle.low == null || candle.ltp == null) {
            logger.warn(`Skipping ${symbol}: tick missing valid LTP/ltt or out-of-order (timeframe=${timeframe})`);
            return null;
        }

        logger.debug(`Processing ${timeframe} candle for symbol ${symbol}:`, candle);

        return this.runMsbPts(prevData, candle, closedCandle, symbol, strategyDetails);
    }

    async runMsbPts(prevData, currentData, closedCandle, symbol, strategy_details) {
        const currentCandleState = currentData.candleState || prevData?.candleState;
        let { high: tickHigh, low: tickLow, ltp } = currentData;
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
            const initHigh = closedCandle?.high ?? tickHigh;
            const initLow = closedCandle?.low ?? tickLow;
            isUp = null;
            prevHigh = { high: initHigh, low: initLow };
            prevLow = { high: initHigh, low: initLow };
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

        // 1. Check for Target or Stop Loss hit first (runs real-time on every tick LTP)
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
                const { placed, order } = await this.triggerOrder('SELL', {
                    price: ltp,
                    timestamp: currentData.timestamp,
                    tag: symbol,
                }, async () => {
                    await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                });
                if (placed) {
                    position = null;
                    lastBuyPrice = null;
                    lastSellPrice = null;
                    closedByTargetOrSl = true;
                } else if (order.quantity <= 0) {
                    logger.warn(`msb_pts: Skipping Target/SL SELL due to zero/negative quantity: ${order.quantity}`);
                } else {
                    logger.warn('msb_pts: Target/SL SELL failed; keeping position for retry');
                }
            } else if (position.direction === "SHORT") {
                if (isTest) {
                    logger.info(`msb_pts Test: Closing Test SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
                } else {
                    logger.info(`msb_pts: Closing Live SHORT position at ${ltp} via ${targetHit ? 'Target' : 'SL'} hit (entry: ${position.entryPrice})`);
                }
                const shortQty = await getShortQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
                const { placed, order } = await this.triggerOrder('BUY', {
                    price: ltp,
                    timestamp: currentData.timestamp,
                    tag: symbol,
                    quantity: shortQty > 0 ? shortQty : 0,
                }, async () => {
                    await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                });
                if (placed) {
                    position = null;
                    lastBuyPrice = null;
                    lastSellPrice = null;
                    closedByTargetOrSl = true;
                } else if (order.quantity <= 0) {
                    logger.warn(`msb_pts: Skipping Target/SL BUY due to zero/negative quantity: ${order.quantity}`);
                } else {
                    logger.warn('msb_pts: Target/SL BUY (cover short) failed; keeping position for retry');
                }
            }
        }

        if (!closedCandle) {
            // Intra-bar tick update: Target/SL handled; skip structure breakout evaluation until candle closes
            return { isUp, prevHigh, prevLow, lastBuyPrice, lastSellPrice, position, closedByTargetOrSl, candleState: currentCandleState };
        }

        const high = closedCandle.high;
        const low = closedCandle.low;

        // 2. Trend breakout logic (runs ONLY on closed timeframe candle)
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
                    const { placed, order } = await this.triggerOrder('BUY', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                    }, async (placedOrder) => {
                        await setBoughtQuantityWithTagToRedis(symbol, placedOrder.quantity, strategy_details.deployment_id);
                    });
                    if (placed) {
                        position = { direction: "LONG", entryPrice: ltp };
                        lastBuyPrice = ltp;
                        closedByTargetOrSl = false;
                        isUp = true;
                        prevHigh.high = high;
                        prevHigh.low = low;
                    } else {
                        logger.warn('msb_pts: Initial BUY failed; not opening position');
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
                    const { placed, order } = await this.triggerOrder('SELL', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                    }, async () => {
                        await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                    });
                    if (placed) {
                        position = null;
                        lastBuyPrice = null;
                    } else if (order.quantity <= 0) {
                        logger.warn(`msb_pts: Skipping trend-break SELL due to zero/negative quantity: ${order.quantity}`);
                    } else {
                        logger.warn('msb_pts: Trend-break SELL failed; keeping position for retry');
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
                    const shortQty = await getShortQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
                    const { placed, order } = await this.triggerOrder('BUY', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                        quantity: shortQty > 0 ? shortQty : 0,
                    }, async () => {
                        await setShortQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                    });
                    if (placed) {
                        position = null;
                        lastSellPrice = null;
                    } else if (order.quantity <= 0) {
                        logger.warn(`msb_pts: Skipping short cover due to zero/negative quantity: ${order.quantity}`);
                    } else {
                        logger.warn('msb_pts: Trend-break short cover failed; keeping position for retry');
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
                        const { placed, order } = await this.triggerOrder('BUY', {
                            price: ltp,
                            timestamp: currentData.timestamp,
                            tag: symbol,
                        }, async (placedOrder) => {
                            await setBoughtQuantityWithTagToRedis(symbol, placedOrder.quantity, strategy_details.deployment_id);
                        });
                        if (placed) {
                            position = { direction: "LONG", entryPrice: ltp };
                            lastBuyPrice = ltp;
                            closedByTargetOrSl = false;
                        } else {
                            logger.warn('msb_pts: BUY order failed; not opening LONG position');
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    new MsbPtsStrategy();
}
