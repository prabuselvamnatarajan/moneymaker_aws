import { Kafka } from 'kafkajs';
import retry from 'async-retry';

const base_url = 'https://api-hft.upstox.com/v2';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const NGINX_ADDRESS = process.env.NGINX_ADDRESS;
const BACKTEST_APP_URL = process.env.BACKTEST_APP_URL || '/backtestapp';
const BACKTEST_TRADE_URL = process.env.BACKTEST_TRADE_URL || '/api/trade';
const FUNDS_AND_MARGIN_API_URL = process.env.FUNDS_AND_MARGIN_API_URL || '/funds_and_margin';

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

async function storeOrderDetails(symbol, order_details) {
    const producer = kafka.producer();
    await producer.connect();

    const topic = TARGET_TOPIC;
    console.log(`Processing ${symbol} details:`, order_details);
    console.log(`Topic : ${topic}`);

    // Fetch additional data from Nginx API (load-balanced)
    try {
        let getLTP_URL = `${NGINX_ADDRESS}/ltp?symbol=${symbol}`; // Use Nginx reverse proxy
        const ltpResponse = await fetch(getLTP_URL); // Use Nginx reverse proxy
        const ltpData = await ltpResponse.json();

        if (ltpData.status === 'success' && ltpData.data) {
            const property = Object.entries(ltpData.data).find(([key, item]) => item.instrument_token.includes(symbol));
            if (property) {
                const [propertyName, propertyValue] = property;
                order_details.ltp = propertyValue.last_price; // Add the last_price as ltp
                order_details.Symbol_Name = propertyName; // Add the property name as Symbol_Name
            } else {
                order_details.ltp = null; // Fallback if symbol not found
                order_details.Symbol_Name = null; // Fallback if symbol not found
            }
        } else {
            order_details.ltp = null; // Fallback in case of error or invalid status
            order_details.Symbol_Name = null; // Fallback in case of error or invalid status
        }
    } catch (error) {
        console.error(`Failed to fetch LTP for symbol ${symbol}:`, error.message);
        order_details.ltp = null; // Fallback in case of error
        order_details.Symbol_Name = null; // Fallback in case of error
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

async function placeOrders(access_token, body) {

    const url = `${base_url}/order/place`;
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
    };

    try {
        console.log('In API Call Body:', body);
        const response = fetch(url, {
            method: 'POST',
            headers: headers,
            body
        }).then(res => res.json()).then(data => {
            console.log('Response:', data);
            return data;
        }).catch(error => { console.error('Error:', error); });
        // console.log(response.data);
        return response;
    } catch (err) {
        console.error('Error:', err);
        throw new Error('Failed Make Order ...');
    }
}

async function triggerBackTestApp(body) {

    const url = `${NGINX_ADDRESS}${BACKTEST_APP_URL}${BACKTEST_TRADE_URL}`;

    try {
        
        let { strategy_details } = body;
        let testAPIBody = {
            "type_of_order": body.transaction_type,
            "price": body.price,
            "quantity": body.quantity,
            ...strategy_details
        }
        console.log('Triggering Test API Call Body:', testAPIBody);
        console.log('URL:', url);
        const response = fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testAPIBody), 
        }).then(res => res.json()).then(data => {
            console.log('Response:', data);
            return data;
        }).catch(error => { console.error('Error:', error); });
        // console.log(response.data);
        return response;
    } catch (err) {
        console.error('Error:', err);
        throw new Error('Failed Make Order ...');
    }
}

async function getLiveAccountBalance() {
    const url = `${NGINX_ADDRESS}${FUNDS_AND_MARGIN_API_URL}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json();
        console.log('Live Account Balance Response:', data);
        return data.equity.availableMargin;
    } catch (error) {
        console.error('Error fetching live account balance:', error);
    }
}


export {
  placeOrders,
  storeOrderDetails,
  triggerBackTestApp,
  getLiveAccountBalance
};