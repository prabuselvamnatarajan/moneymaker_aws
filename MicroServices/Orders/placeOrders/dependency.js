import { Kafka } from 'kafkajs';
import retry from 'async-retry';

const base_url = 'https://api-hft.upstox.com/v3';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const NGINX_ADDRESS = process.env.NGINX_ADDRESS;
const BACKTEST_APP_URL = process.env.BACKTEST_APP_URL || '/backtestapp';
const BACKTEST_TRADE_URL = process.env.BACKTEST_TRADE_URL || '/api/trade';
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

async function fetchLTP(symbol, userId) {
    if (!userId || !symbol) {
        return null;
    }
    try {
        let getLTP_URL = `${NGINX_ADDRESS}/ltp?symbol=${symbol}&userId=${userId}`; // Use Nginx reverse proxy
        console.log(`Fetching LTP from URL: ${getLTP_URL}`);
        const ltpResponse = await fetch(getLTP_URL); // Use Nginx reverse proxy
        const ltpData = await ltpResponse.json();

        if (ltpData.status === 'success' && ltpData.data) {
            const property = Object.entries(ltpData.data).find(([key, item]) => item.instrumentToken.includes(symbol));
            if (property) {
                const [propertyName, propertyValue] = property;
                return {
                    ltp: propertyValue.lastPrice,
                    symbolName: propertyName
                };
            }
        }
    } catch (error) {
        console.error(`Failed to fetch LTP for symbol ${symbol}:`, error.message);
    }
    return null;
}

async function storeOrderDetails(symbol, order_details) {
    const producer = kafka.producer();
    await producer.connect();

    const topic = TARGET_TOPIC;
    console.log(`Processing ${symbol} details:`, order_details);
    console.log(`Topic : ${topic}`);

    try {
        const userId = order_details.strategy_details ? order_details.strategy_details.user_id : '';
        const ltpInfo = await fetchLTP(symbol, userId);
        if (ltpInfo) {
            order_details.ltp = ltpInfo.ltp;
            order_details.Symbol_Name = ltpInfo.symbolName;
        } else {
            order_details.ltp = null;
            order_details.Symbol_Name = null;
        }
    } catch (error) {
        console.error(`Failed to fetch LTP in storeOrderDetails for symbol ${symbol}:`, error.message);
        order_details.ltp = null;
        order_details.Symbol_Name = null;
    }

    await retry(async () => {
        await producer.send({
            topic,
            messages: [{ key: symbol, value: JSON.stringify(order_details) }], // Serialize order_details
        });
    }, {
        retries: 5,
        minTimeout: 1000,
        onRetry: (error, attempt) => {
            console.log(`Retry attempt ${attempt} for topic ${topic} due to error: ${error.message}`);
        }
    });

    await producer.disconnect();
}

function buildBrokerOrderPayload(orderFields) {
    const payload = { ...orderFields };
    if (payload.order_type === 'MARKET') {
        payload.price = 0;
    }
    return payload;
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
            body
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

        let price = body.price;
        // Resolve missing/zero price via LTP in all modes so live MARKET orders
        // still record a usable execution price for deployment analysis.
        if (price === 0 || price === '0' || price === undefined || price === null) {
            const ltpInfo = await fetchLTP(body.instrument_token, strategy_details.user_id);
            if (ltpInfo && ltpInfo.ltp) {
                price = ltpInfo.ltp;
            }
        }

        const clientOrderId = body.client_order_id || strategy_details.client_order_id;
        let testAPIBody = {
            "type_of_order": body.transaction_type,
            "price": price,
            "quantity": body.quantity,
            ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
            ...strategy_details
        }
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
  buildBrokerOrderPayload,
  placeOrders,
  storeOrderDetails,
  triggerBackTestApp,
  getLiveAccountBalance
};