import { AsyncLocalStorage } from 'node:async_hooks';
import { Kafka } from 'kafkajs';
import { initLogger, logger } from '/app/utils/logUtils.js';
import { calculateLatency } from '/app/utils/latencyUtil.js';
import {
    handleFatalError,
    registerFatalErrorHandlers,
    registerKafkaCrashHandler,
} from '/app/utils/kafkaErrorHandler.js';
import {
    StaleStateEpochError,
    constructRedisKey,
    getStrategyStateForSymbol,
    writeStrategyStateForSymbol,
    setBacktestCompleted,
    assertFreshStateEpoch,
} from './redisState.js';
import {
    computeOrderPayload as buildOrderPayload,
    placeOrderHttp,
    executeOrderWithLock,
} from './orders.js';

const STRATEGY_NAME_RE = /^[a-z][a-z0-9_]*$/;
const RECOVERABLE_CONFIG_RE =
    /Unsupported timeframe|timeframe is required|atrLookbackBars|volumeProfile\.interval|Invalid ATR/i;

/** Per-message context so concurrent deployments/symbols cannot clobber this.symbol / strategyDetails. */
const messageContext = new AsyncLocalStorage();

function envIsBacktest() {
    const raw = process.env.IS_BACKTEST;
    return raw === true || raw === 'true' || raw === '1';
}

function resolveIsBackTest(strategy_details = {}) {
    if (envIsBacktest() || strategy_details.strategy_mode === 'BACKTEST') {
        return true;
    }
    return strategy_details.isTest === true;
}

export class Strategy {
    /** @type {string} */
    static strategyName;

    /** Per-deployment message queue (MSB / msb_pts). */
    static serializeByDeployment = false;

    /** Exit process on unexpected message errors (MSB / msb_pts). */
    static fatalOnMessageError = false;

    /** Take Redis order lock around placeOrder (MSB / msb_pts). */
    static lockOrders = false;

    /** HTTP placeOrder attempts (MSB / msb_pts = 3, sweep = 1). */
    static orderAttempts = 1;

    /** Include client_order_id on order bodies (MSB / msb_pts). */
    static includeClientOrderId = false;

    constructor() {
        this.deploymentLocks = new Map();
        this.symbol = null;
        this.strategyDetails = null;
        this.isBackTest = false;
        this.initialise();
        this.main();
    }

    initialise() {
        const name = this.constructor.strategyName;
        if (!name || typeof name !== 'string' || !STRATEGY_NAME_RE.test(name)) {
            throw new Error(
                `Strategy.strategyName must match ${STRATEGY_NAME_RE}; got ${JSON.stringify(name)}`
            );
        }
        const envName = process.env.STRATEGY_NAME;
        if (envName && envName !== name) {
            throw new Error(
                `STRATEGY_NAME env (${envName}) does not match static strategyName (${name})`
            );
        }
        this.strategyName = name;
    }

    constructKafkaTopic() {
        const name = this.strategyName;
        return {
            live: `${name}_live_data`,
            backtest: `${name}_backtest_data`,
        };
    }

    resolveSubscribeTopic() {
        if (process.env.TARGET_TOPIC) {
            return process.env.TARGET_TOPIC;
        }
        const topics = this.constructKafkaTopic();
        const mode = (process.env.SERVICE_MODE || '').toLowerCase();
        if (mode === 'backtest' || envIsBacktest()) {
            return topics.backtest;
        }
        return topics.live;
    }

    /** Message-local symbol / strategyDetails / isBackTest (falls back to instance fields for unit tests). */
    messageCtx() {
        return messageContext.getStore() || {
            symbol: this.symbol,
            strategyDetails: this.strategyDetails,
            isBackTest: this.isBackTest,
        };
    }

    constructRedisKey(symbol, isTestMode, deploymentId) {
        const ctx = this.messageCtx();
        const resolvedSymbol = symbol ?? ctx.symbol;
        const resolvedTest = isTestMode ?? ctx.isBackTest;
        const depId = deploymentId ?? ctx.strategyDetails?.deployment_id;
        return constructRedisKey(this.strategyName, resolvedSymbol, resolvedTest, depId);
    }

    async getLastSymbolStateFromRedis() {
        const ctx = this.messageCtx();
        return getStrategyStateForSymbol(
            this.strategyName,
            ctx.symbol,
            ctx.isBackTest,
            ctx.strategyDetails?.deployment_id
        );
    }

    async setLastSymbolStateToRedis(newState) {
        const ctx = this.messageCtx();
        return writeStrategyStateForSymbol(
            this.strategyName,
            ctx.symbol,
            ctx.isBackTest,
            newState,
            ctx.strategyDetails?.deployment_id
        );
    }

    async computeOrderPayload(type, overrides = {}) {
        const ctx = this.messageCtx();
        return buildOrderPayload({
            strategyDetails: overrides.strategyDetails ?? ctx.strategyDetails,
            transactionType: type,
            price: overrides.price,
            tag: overrides.tag ?? ctx.symbol,
            timestamp: overrides.timestamp,
            quantity: overrides.quantity,
            includeClientOrderId: this.constructor.includeClientOrderId === true,
        });
    }

    async placeOrder(order) {
        const ctx = this.messageCtx();
        const attempts = this.constructor.orderAttempts ?? 1;
        const place = () => placeOrderHttp(order, attempts);
        if (this.constructor.lockOrders) {
            return executeOrderWithLock(
                ctx.symbol,
                ctx.strategyDetails?.deployment_id,
                place
            );
        }
        return place();
    }

    /**
     * Build payload and place. Returns { placed, order } so children can update
     * bought/short quantity exactly as they do today.
     */
    async triggerOrder(type, overrides = {}) {
        const order = await this.computeOrderPayload(type, overrides);
        const placed = await this.placeOrder(order);
        return { placed, order };
    }

    /**
     * Children replace this only. Return value is the new symbol state.
     * Return null to skip the Redis write (bad tick / nothing to store).
     */
    async executeStrategy(_lastState, _message, _symbol, _strategyDetails) {
        throw new Error(`${this.constructor.name}.executeStrategy() must be implemented`);
    }

    async handleMessageForDeployment(deploymentId, fn) {
        if (!deploymentId || !this.constructor.serializeByDeployment) {
            return fn();
        }
        const previousPromise = this.deploymentLocks.get(deploymentId) || Promise.resolve();
        let resolveLock;
        const currentPromise = new Promise((res) => {
            resolveLock = res;
        });
        this.deploymentLocks.set(deploymentId, currentPromise);

        try {
            await previousPromise;
            return await fn();
        } finally {
            resolveLock();
            if (this.deploymentLocks.get(deploymentId) === currentPromise) {
                this.deploymentLocks.delete(deploymentId);
            }
        }
    }

    async handleMessage(kafkaMessage) {
        const rawKey = kafkaMessage.key ? kafkaMessage.key.toString() : '';
        let msg;
        try {
            msg = JSON.parse(kafkaMessage.value.toString());
        } catch (err) {
            logger.error(`Failed to parse message value JSON for ${rawKey}:`, err.message);
            return;
        }

        let strategy_details = msg.strategy_details || {};
        const deploymentId = strategy_details.deployment_id || 'default';

        await this.handleMessageForDeployment(deploymentId, async () => {
            try {
                const symbol = String(
                    msg.symbol || msg.symbol_name || strategy_details.symbol || rawKey.split(':')[0]
                ).toUpperCase();
                if (!symbol) {
                    logger.warn('Received Kafka message without symbol key, skipping.');
                    return;
                }

                console.log(`msg: ${JSON.stringify(msg)}`);

                const isBackTest = resolveIsBackTest(strategy_details);
                if (
                    isBackTest
                    && msg.run_id
                    && strategy_details.backtest_run_id
                    && String(msg.run_id) !== String(strategy_details.backtest_run_id)
                ) {
                    logger.info(
                        `Discarding stale backtest message in ${this.strategyName} strategy. Msg run_id: ${msg.run_id}, Active: ${strategy_details.backtest_run_id}`
                    );
                    return;
                }

                if (msg.done) {
                    logger.info(
                        `Received done signal for symbol ${symbol} with last_ltp=${msg.last_ltp}, skipping processing.`
                    );
                    if (strategy_details.deployment_id) {
                        const runId = msg.run_id || strategy_details.backtest_run_id || null;
                        await setBacktestCompleted(strategy_details.deployment_id, runId, {
                            lastLtp: msg.last_ltp,
                            lastTickAt: msg.last_tick_at,
                        });
                    }
                    return;
                }

                const beforeLatency = calculateLatency(symbol, msg);
                msg.latency = {
                    ...msg.latency,
                    ...(beforeLatency != null ? { beforeStrategyExecution: beforeLatency } : {}),
                };

                if (isBackTest) {
                    strategy_details.isTest = true;
                }

                try {
                    await assertFreshStateEpoch(strategy_details);
                } catch (err) {
                    if (err?.name === 'StaleStateEpochError') {
                        logger.error(err.message);
                        return;
                    }
                    throw err;
                }

                // Default missing timeframe for rollout compatibility (legacy Redis routing)
                const timeframe = strategy_details.timeframe || '1m';
                strategy_details.timeframe = timeframe;

                // Also keep instance fields for children/tests that set/read them directly.
                this.symbol = symbol;
                this.strategyDetails = strategy_details;
                this.isBackTest = isBackTest;

                await messageContext.run(
                    { symbol, strategyDetails: strategy_details, isBackTest },
                    async () => {
                        const lastState = await this.getLastSymbolStateFromRedis();
                        const newState = await this.executeStrategy(
                            lastState,
                            msg,
                            symbol,
                            strategy_details
                        );

                        if (newState != null) {
                            newState.state_epoch = Number(strategy_details.state_epoch);
                            newState.timeframe = timeframe;
                            await this.setLastSymbolStateToRedis(newState);
                        }

                        const afterLatency = calculateLatency(symbol, msg);
                        if (afterLatency != null) {
                            msg.latency.afterStrategyExecution = afterLatency;
                        }
                        logger.debug('Latency:', msg.latency);
                    }
                );
            } catch (error) {
                if (error?.name === 'StaleStateEpochError') {
                    logger.error(error.message);
                    return;
                }
                if (error?.name === 'BadTickError') {
                    logger.warn(error.message);
                    return;
                }
                if (error?.message && RECOVERABLE_CONFIG_RE.test(error.message)) {
                    logger.error(
                        `Skipping recoverable config/data error: ${error.message}`
                    );
                    return;
                }
                if (this.constructor.fatalOnMessageError) {
                    handleFatalError(error, 'message handling');
                    return;
                }
                logger.error(`Error processing message (continuing):`, error);
            }
        });
    }

    async connectWithRetry(target, name = 'Client', retries = 30, delay = 5000) {
        for (let i = 0; i < retries; i++) {
            try {
                await target.connect();
                logger.info(`Successfully connected to ${name}.`);
                return;
            } catch (err) {
                logger.warn(
                    `Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`
                );
                await new Promise((res) => setTimeout(res, delay));
            }
        }
        throw new Error(`Failed to connect to ${name} after maximum retries.`);
    }

    async main() {
        if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test_env') {
            return;
        }

        registerFatalErrorHandlers();

        const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
        const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
        const topic = this.resolveSubscribeTopic();

        const kafka = new Kafka({
            clientId: `${this.strategyName}-app`,
            brokers: KAFKA_BROKERS,
            retry: {
                initialRetryTime: 300,
                retries: 20,
            },
        });

        try {
            await initLogger();
            const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
            registerKafkaCrashHandler(consumer);

            await this.connectWithRetry(consumer, 'Kafka Consumer');
            logger.info(`Subscribing to topic: ${topic}`);
            await consumer.subscribe({ topic, fromBeginning: false });

            await consumer.run({
                eachMessage: async ({ message }) => {
                    await this.handleMessage(message);
                },
            });
        } catch (err) {
            handleFatalError(err, 'consumer startup');
        }
    }
}

export { StaleStateEpochError };
