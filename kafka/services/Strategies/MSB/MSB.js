const axios = require('axios');

function triggerOrder(requestBody) {
    const placeOrderApi = process.env.PLACEORDER_API;
    if (placeOrderApi) {
        axios.post(placeOrderApi, requestBody)
            .then(res => {
                console.log('Order API response:', res.data);
            })
            .catch(err => {
                console.error('Order API error:', err.message);
            });
    } else {
        console.error('PLACEORDER_API env variable not set');
    }
}

function MSB(prevData, currentData, symbol) {
    let { isUp, prevHigh, prevLow } = prevData;
    let { isTest } = currentData;
    let { high, low } = currentData;
    if (isUp) {
        // check for break
        if (prevHigh.low > low) {
            prevLow.high = high;
            prevLow.low = low;
            isUp = false;
            // need to close long position
            if (isTest) {
                console.log(`MSB: Closing Live long position at ${low}`);
            } else {
                console.log(`MSB: Closing Test long position at ${low}`);
            }
            // need to find the open orders and close the open orders for the symbol
            // tigger place order API here
            const requestBody = {
                "quantity": 1,
                "product": "D",
                "validity": "DAY",
                "price": 0,
                "tag": symbol,
                "instrument_token": symbol,
                "order_type": "MARKET",
                "transaction_type": "SELL",
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": false,
                isTest
            };
            triggerOrder(requestBody);
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
                console.log(`MSB: Opening Live long position at ${high}`);
            } else {
                console.log(`MSB: Opening Test long position at ${high}`);
            }
            // tigger place order API here
            const requestBody = {
                "quantity": 1,
                "product": "D",
                "validity": "DAY",
                "price": 0,
                "tag": symbol,
                "instrument_token": symbol,
                "order_type": "MARKET",
                "transaction_type": "BUY",
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": false,
                isTest
            };
            triggerOrder(requestBody);
        }
        else {
            // trend continuation
            if (prevLow.low > low) {
                prevLow.high = high;
                prevLow.low = low;
            }
        }
    }
}

module.exports = MSB;