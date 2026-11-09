import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Strategy } from '/app/strategy/Strategy.js';
import { buildTimeframeCandle } from './candleBuilder.js';
import {
    getBoughtQuantityWithTagFromRedis,
    setBoughtQuantityWithTagToRedis,
} from '/app/redis_utils/account_utils.js';
import { logger } from '/app/utils/logUtils.js';

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
 * Resolve candle + closedCandle for centralized timeframe snapshots, live ticks, or
 * prebuilt test fixtures.
 */
function resolveCandles(message, timeframe, existingCandleState) {
    // 1. Centralized multi-timeframe snapshot from timeframeConstructor
    if (message?.timeframes && typeof message.timeframes === 'object') {
        const tfData = message.timeframes[timeframe] || Object.values(message.timeframes)[0];
        if (tfData) {
            const candle = {
                open: tfData.open,
                high: tfData.high,
                low: tfData.low,
                close: tfData.close,
                ltp: message.ltp ?? tfData.close,
                volume: tfData.volume ?? 0,
                timestamp: tfData.endTime ? new Date(tfData.endTime).toISOString() : (message.eventTimestamp ? new Date(message.eventTimestamp).toISOString() : message.timestamp),
                isClosed: false,
                candleState: tfData,
            };
            const closedCandle = tfData.closedCandle || null;
            return { candle, closedCandle, newCandleState: tfData };
        }
    }

    if (isRawTick(message)) {
        const built = buildTimeframeCandle(message, timeframe, existingCandleState);
        if (built.candle) {
            built.candle.candleState = built.newCandleState;
        }
        return built;
    }

    // Prebuilt candle / tick fixture (unit tests)
    let closedCandle;
    if (Object.prototype.hasOwnProperty.call(message, 'closedCandle')) {
        closedCandle = message.closedCandle;
    } else if (message?.isClosed === false) {
        closedCandle = null;
    } else if (message?.isClosed === true) {
        closedCandle = message;
    } else {
        // Fixtures without isClosed are treated as closed bars
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

export class MsbStrategy extends Strategy {
    static strategyName = 'msb';
    static serializeByDeployment = true;
    static fatalOnMessageError = true;
    static lockOrders = true;
    static orderAttempts = 3;
    static includeClientOrderId = true;

    async executeStrategy(lastState, message, symbol, strategyDetails) {
        this.symbol = symbol;
        this.strategyDetails = strategyDetails || {};

        // Epoch mismatch: drop candle/swing state so old-TF swings cannot drive new-TF entries.
        // BUY path refuses when bought_quantity is still present, so holdings are not doubled.
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
                `Discarding stale MSB Redis state for ${symbol}: state_epoch=${prevData.state_epoch} message_epoch=${messageEpoch}`
            );
            prevData = null;
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

        return this.runMsb(prevData, candle, closedCandle, symbol, strategyDetails);
    }

    async runMsb(prevData, currentData, closedCandle, symbol, strategy_details) {
        const { high: tickHigh, low: tickLow, ltp, candleState } = currentData;
        const currentCandleState = candleState || prevData?.candleState;

        if (!closedCandle) {
            // Intra-bar tick update: preserve state and candleState, skip structure break evaluation
            return {
                isUp: prevData?.isUp ?? null,
                prevHigh: prevData?.prevHigh ?? null,
                prevLow: prevData?.prevLow ?? null,
                candleState: currentCandleState,
            };
        }

        const high = closedCandle.high;
        const low = closedCandle.low;

        if (!isValidState(prevData)) {
            if (prevData) {
                logger.warn('MSB: Recovering from invalid/empty strategy state — re-initializing swing points');
            }
            return {
                isUp: null,
                prevHigh: { high, low },
                prevLow: { high, low },
                candleState: currentCandleState,
            };
        }

        let { isUp, prevHigh, prevLow } = prevData;
        let { isTest } = strategy_details;

        if (isUp === null) {
            // Trend is not established yet
            if (prevLow.high < high) {
                prevHigh.high = high;
                prevHigh.low = low;
                isUp = true;
                const existingHoldings = await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
                if (existingHoldings > 0) {
                    logger.warn(
                        `MSB: Skipping BUY — holdings already present in Redis (${existingHoldings}). Waiting for exit signal.`
                    );
                } else {
                    if (isTest) {
                        logger.info(`MSB Test: Opening Test long position at ${high}`);
                    } else {
                        logger.info(`MSB: Opening Live long position at ${high}`);
                    }

                    const { placed, order } = await this.triggerOrder('BUY', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                    }, async (placedOrder) => {
                        await setBoughtQuantityWithTagToRedis(symbol, placedOrder.quantity, strategy_details.deployment_id);
                    });
                    if (!placed) {
                        if (order.quantity <= 0) {
                            logger.warn(`MSB: Skipping BUY order due to zero/negative quantity: ${order.quantity}`);
                        } else {
                            logger.warn('MSB: BUY order failed; not updating bought_quantity');
                        }
                    }
                }
            } else if (prevHigh.low > low) {
                prevLow.high = high;
                prevLow.low = low;
                isUp = false;
                logger.info(`MSB: Established initial trend DOWN at ${low}.`);
            } else {
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
                    const { placed, order } = await this.triggerOrder('SELL', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                    }, async () => {
                        await setBoughtQuantityWithTagToRedis(symbol, 0, strategy_details.deployment_id);
                    });
                    if (!placed) {
                        if (order.quantity <= 0) {
                            logger.warn(`MSB: Skipping SELL order due to zero/negative quantity: ${order.quantity}`);
                        } else {
                            logger.warn('MSB: SELL order failed; keeping bought_quantity for retry');
                        }
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
                // need to open long position — refuse if Redis already shows holdings
                // (e.g. TF/state reset preserved bought_quantity while strategy state was wiped)
                const existingHoldings = await getBoughtQuantityWithTagFromRedis(symbol, strategy_details.deployment_id);
                if (existingHoldings > 0) {
                    logger.warn(
                        `MSB: Skipping BUY — holdings already present in Redis (${existingHoldings}). Waiting for exit signal.`
                    );
                } else {
                    if (isTest) {
                        logger.info(`MSB Test: Opening Test long position at ${high}`);
                    } else {
                        logger.info(`MSB: Opening Live long position at ${high}`);
                    }

                    const { placed, order } = await this.triggerOrder('BUY', {
                        price: ltp,
                        timestamp: currentData.timestamp,
                        tag: symbol,
                    }, async (placedOrder) => {
                        await setBoughtQuantityWithTagToRedis(symbol, placedOrder.quantity, strategy_details.deployment_id);
                    });
                    if (!placed) {
                        if (order.quantity <= 0) {
                            logger.warn(`MSB: Skipping BUY order due to zero/negative quantity: ${order.quantity}`);
                        } else {
                            logger.warn('MSB: BUY order failed; not updating bought_quantity');
                        }
                    }
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
        return { isUp, prevHigh, prevLow, candleState: currentCandleState };
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    new MsbStrategy();
}
