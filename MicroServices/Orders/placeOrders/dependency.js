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

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

const DEPLOYMENT_MODES = ['LIVE', 'PAPER', 'BACKTEST'];
const SUPPORTED_EXTERNAL_BROKERS = ['upstox'];

/**
 * Decide where an order goes. Only a LIVE deployment on a LIVE account linked to
 * a supported external broker reaches the broker. PAPER and BACKTEST orders are
 * always booked internally (ledger only), whatever else the payload says.
 * A LIVE order whose account does not qualify is refused rather than booked
 * internally, because the strategy believes it is trading real money.
 * `isTest` is deliberately ignored: strategy_mode is the single source of truth.
 */
function resolveExecutionMode(strategyDetails) {
    const strategy_details = strategyDetails || {};
    const mode = strategy_details.strategy_mode;
    if (!DEPLOYMENT_MODES.includes(mode)) {
        throw httpError(400, `strategy_details.strategy_mode must be one of ${DEPLOYMENT_MODES.join(', ')}; got ${JSON.stringify(mode)}`);
    }
    if (mode !== 'LIVE') {
        return { mode, isBacktest: mode === 'BACKTEST', shouldCallExternalBroker: false };
    }
    if (strategy_details.account_type !== 'LIVE') {
        throw httpError(409, `LIVE order refused: account type is ${strategy_details.account_type || 'unknown'}, not LIVE`);
    }
    if (strategy_details.is_internal_broker !== false) {
        throw httpError(409, 'LIVE order refused: the account is not linked to an external broker');
    }
    if (!SUPPORTED_EXTERNAL_BROKERS.includes(strategy_details.external_broker_id)) {
        throw httpError(409, `LIVE order refused: broker ${JSON.stringify(strategy_details.external_broker_id || null)} is not supported yet (supported: ${SUPPORTED_EXTERNAL_BROKERS.join(', ')})`);
    }
    return { mode, isBacktest: false, shouldCallExternalBroker: true };
}

// ---------------------------------------------------------------------------
// Upstox Place Order V3 payload. Only the documented fields are sent; see
// system_flows/upstox_place_order_v3.md for the field reference.
// ---------------------------------------------------------------------------
const UPSTOX_PRODUCTS = ['I', 'D', 'MTF'];
const UPSTOX_VALIDITIES = ['DAY', 'IOC'];
const UPSTOX_ORDER_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL-M'];
const UPSTOX_TRANSACTION_TYPES = ['BUY', 'SELL'];
const PRICED_ORDER_TYPES = ['LIMIT', 'SL'];
const TRIGGERED_ORDER_TYPES = ['SL', 'SL-M'];

function enumField(value, allowed, name) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value;
    if (!allowed.includes(normalized)) {
        throw httpError(400, `Invalid ${name} ${JSON.stringify(value)}; expected one of ${allowed.join(', ')}`);
    }
    return normalized;
}

function toBool(value) {
    return value === true || value === 'true';
}

/**
 * Build the body for POST /v3/order/place from an order. Throws a 400 for any
 * value Upstox would reject, before the broker is called. Internal fields
 * (strategy_details, client_order_id, ltp, ...) are never sent.
 */
function buildBrokerOrderPayload(order = {}) {
    const order_type = enumField(order.order_type, UPSTOX_ORDER_TYPES, 'order_type');
    const transaction_type = enumField(order.transaction_type, UPSTOX_TRANSACTION_TYPES, 'transaction_type');
    const product = enumField(order.product, UPSTOX_PRODUCTS, 'product');
    const validity = enumField(order.validity, UPSTOX_VALIDITIES, 'validity');

    const quantity = Number(order.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw httpError(400, `Invalid quantity ${JSON.stringify(order.quantity)}; expected a positive integer`);
    }

    const instrument_token = typeof order.instrument_token === 'string' ? order.instrument_token.trim() : '';
    if (!instrument_token) {
        throw httpError(400, 'instrument_token is required for a broker order');
    }

    let price = 0;
    if (PRICED_ORDER_TYPES.includes(order_type)) {
        price = Number(order.price);
        if (!Number.isFinite(price) || price <= 0) {
            throw httpError(400, `${order_type} orders need a positive price; got ${JSON.stringify(order.price)}`);
        }
    }

    let trigger_price = 0;
    if (TRIGGERED_ORDER_TYPES.includes(order_type)) {
        trigger_price = Number(order.trigger_price);
        if (!Number.isFinite(trigger_price) || trigger_price <= 0) {
            throw httpError(400, `${order_type} orders need a positive trigger_price; got ${JSON.stringify(order.trigger_price)}`);
        }
    }

    const disclosed_quantity = order.disclosed_quantity == null ? 0 : Number(order.disclosed_quantity);
    if (!Number.isInteger(disclosed_quantity) || disclosed_quantity < 0 || disclosed_quantity > quantity) {
        throw httpError(400, `Invalid disclosed_quantity ${JSON.stringify(order.disclosed_quantity)}; expected an integer from 0 to quantity`);
    }

    const payload = {
        quantity,
        product,
        validity,
        price,
        instrument_token,
        order_type,
        transaction_type,
        disclosed_quantity,
        trigger_price,
        is_amo: toBool(order.is_amo),
        slice: toBool(order.slice),
    };
    if (typeof order.tag === 'string' && order.tag.trim()) {
        payload.tag = order.tag.trim();
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
    const clientOrderId = getClientOrderId(body);
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
 * because createTrade is idempotent on client_order_id, which every order must
 * carry (server.js rejects orders without one).
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

/** The id that makes ledger retries idempotent; strategies always send it. */
function getClientOrderId(body = {}) {
    return body.client_order_id || (body.strategy_details && body.strategy_details.client_order_id) || null;
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
  getClientOrderId,
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