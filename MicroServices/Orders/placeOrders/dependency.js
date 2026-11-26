import { Kafka } from 'kafkajs';
import retry from 'async-retry';

const base_url = 'https://api-hft.upstox.com/v3';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const NGINX_ADDRESS = process.env.NGINX_ADDRESS;
const BACKTEST_APP_URL = process.env.BACKTEST_APP_URL || '/backtestapp';
const BACKTEST_TRADE_URL = process.env.BACKTEST_TRADE_URL || '/api/trades';
const BACKTEST_SERVICE_TOKEN = process.env.BACKTEST_SERVICE_TOKEN;
const FUNDS_AND_MARGIN_API_URL = process.env.FUNDS_AND_MARGIN_API_URL || '/funds_and_margin';

const kafka = new Kafka({
    clientId: 'stock-app',
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 300,
      retries: 20
    }
  });

// ---------------------------------------------------------------------------
// Single long-lived Kafka producer, shared by every order for the life of the
// process. Concurrent callers share one in-flight connect. If a send fails or
// the producer disconnects, it is dropped and the next send reconnects.
// ---------------------------------------------------------------------------
let producer = null;
let connectingPromise = null;

function getProducer() {
    if (producer) return Promise.resolve(producer);
    if (!connectingPromise) {
        connectingPromise = (async () => {
            const p = kafka.producer();
            p.on(p.events.DISCONNECT, () => {
                if (producer === p) {
                    console.warn('Kafka producer disconnected; will reconnect on next send.');
                    producer = null;
                }
            });
            await p.connect();
            producer = p;
            console.log('Kafka producer connected.');
            return p;
        })().finally(() => {
            connectingPromise = null;
        });
    }
    return connectingPromise;
}

function dropProducer(p) {
    if (producer === p) producer = null;
    p.disconnect().catch(() => {});
}

/** Warm the producer at startup so the first order does not pay the connect cost. */
async function connectProducer() {
    try {
        await getProducer();
    } catch (err) {
        console.error('Initial Kafka producer connect failed (will retry on first send):', err.message);
    }
}

async function disconnectProducer() {
    const p = producer;
    producer = null;
    if (p) await p.disconnect().catch(() => {});
}

/**
 * Publish order details for the order-storer consumer. Never throws: order
 * history is not on the strategy's critical path.
 */
async function storeOrderDetails(symbol, order_details) {
    const topic = TARGET_TOPIC;
    if (order_details.Symbol_Name == null && order_details.tag) {
        order_details.Symbol_Name = order_details.tag;
    }

    try {
        await retry(async () => {
            const p = await getProducer();
            try {
                await p.send({
                    topic,
                    messages: [{ key: String(symbol), value: JSON.stringify(order_details) }],
                });
            } catch (err) {
                dropProducer(p);
                throw err;
            }
        }, {
            retries: 3,
            minTimeout: 200,
            onRetry: (error, attempt) => {
                console.log(`Retry attempt ${attempt} for topic ${topic} due to error: ${error.message}`);
            }
        });
    } catch (err) {
        console.error(`Failed to produce order details to topic ${topic} for ${symbol}:`, err.message);
    }
}

function resolveExecutionMode(strategyDetails) {
    const strategy_details = strategyDetails || {};
    const isLive = strategy_details.strategy_mode === 'LIVE' || strategy_details.isTest === false;
    const isInternalBroker = Boolean(strategy_details.is_internal_broker);
    const isBacktest = strategy_details.strategy_mode === 'BACKTEST' || (strategy_details.isTest === true && strategy_details.strategy_mode !== 'LIVE');
    return {
        isLive,
        isInternalBroker,
        isBacktest,
        shouldCallExternalBroker: isLive && !isInternalBroker
    };
}

function buildBrokerOrderPayload(orderFields) {
    const { ltp: _tickLtp, ...payload } = orderFields;
    if (payload.order_type === 'MARKET') {
        payload.price = 0;
    }
    return payload;
}

function isMissingPrice(price) {
    return price === 0 || price === '0' || price === undefined || price === null;
}

/**
 * Ledger price comes from the tick that triggered the order: body.price, or
 * body.ltp when price is zero/missing. No LTP lookup is made here.
 */
function buildTradePayload(body) {
    const strategy_details = body.strategy_details || {};
    let price = body.price;
    if (isMissingPrice(price) && !isMissingPrice(body.ltp)) {
        price = body.ltp;
    }
    const clientOrderId = body.client_order_id || strategy_details.client_order_id;
    return {
        type_of_order: body.transaction_type,
        price,
        quantity: body.quantity,
        ...strategy_details,
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
    };
}

async function placeOrders(access_token, body) {
    const url = `${base_url}/order/place`;
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
    };

    console.log('In API Call Body:', body);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body,
        });
        const data = await res.json();
        console.log('Response from Upstox:', data);
        if (data.status !== 'success') {
            const errorMsg = data.errors ? JSON.stringify(data.errors) : 'Unknown broker error';
            throw new Error(`Upstox order placement failed: ${errorMsg}`);
        }
        return data;
    } catch (err) {
        console.error('Error placing order to Upstox:', err.message);
        throw err;
    }
}

async function triggerBackTestApp(body) {
    const url = `${NGINX_ADDRESS}${BACKTEST_APP_URL}${BACKTEST_TRADE_URL}`;

    try {
        let { strategy_details = {} } = body;

        const testAPIBody = buildTradePayload(body);
        console.log('Triggering Test API Call Body:', testAPIBody);
        console.log('URL:', url);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (BACKTEST_SERVICE_TOKEN) {
            headers['X-Service-Token'] = BACKTEST_SERVICE_TOKEN;
        }
        const callerUserId = strategy_details.user_id || testAPIBody.user_id;
        if (callerUserId) {
            headers['X-User-Id'] = String(callerUserId);
        }
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(testAPIBody),
        });
        let data;
        try {
            data = await res.json();
        } catch {
            data = null;
        }
        console.log('Response from BackTestApp:', data);
        if (!res.ok) {
            const message =
                (data && (data.message || data.error)) ||
                `BackTestApp createTrade failed with status ${res.status}`;
            const err = new Error(message);
            err.statusCode = res.status;
            throw err;
        }
        return data;
    } catch (err) {
        console.error('Error triggering BackTestApp:', err.message);
        throw err;
    }
}

/**
 * Record the trade in BackTestApp, retrying network/5xx failures. Safe to retry
 * because createTrade is idempotent on client_order_id (see ensureClientOrderId).
 * 4xx responses are not retried.
 */
async function recordTradeInLedger(body, retries = 2) {
    return retry(async (bail) => {
        try {
            return await triggerBackTestApp(body);
        } catch (err) {
            if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
                bail(err);
                return undefined;
            }
            throw err;
        }
    }, {
        retries,
        minTimeout: 100,
        maxTimeout: 500,
        onRetry: (error, attempt) => {
            console.warn(`Retrying BackTestApp trade record (attempt ${attempt}): ${error.message}`);
        },
    });
}

/**
 * Every order carries a client_order_id so that ledger retries (and strategy
 * placeOrder retries) never create a duplicate trade.
 */
function ensureClientOrderId(body) {
    const strategy_details = body.strategy_details || {};
    if (!body.client_order_id && !strategy_details.client_order_id) {
        const tag = body.tag || body.instrument_token || 'symbol';
        body.client_order_id =
            `${strategy_details.deployment_id || 'manual'}_${tag}_${body.transaction_type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    return body;
}

/**
 * How the live path orders the broker call and the ledger write.
 * parallel (default): both start together and are awaited together.
 * sequential: broker first; the ledger is written only after the broker accepts.
 */
function resolveLedgerMode() {
    return (process.env.ORDER_LEDGER_MODE || 'parallel').toLowerCase() === 'sequential'
        ? 'sequential'
        : 'parallel';
}

async function getLiveAccountBalance(userId) {
    if (!userId) {
        throw new Error('userId is required to fetch live account balance');
    }
    const url = `${NGINX_ADDRESS}${FUNDS_AND_MARGIN_API_URL}?userId=${userId}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const { data } = await response.json();
        console.log('Live Account Balance Response:', data);
        return data.equity.availableMargin;
    } catch (error) {
        console.error('Error fetching live account balance:', error);
        throw error;
    }
}


export {
  resolveExecutionMode,
  resolveLedgerMode,
  ensureClientOrderId,
  recordTradeInLedger,
  connectProducer,
  disconnectProducer,
  buildBrokerOrderPayload,
  buildTradePayload,
  placeOrders,
  storeOrderDetails,
  triggerBackTestApp,
  getLiveAccountBalance
};