import axios from 'axios';

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

function MSB(prevData, currentData, symbol, instrument_token, strategy_details) {
    if ( !prevData ) {
        // initialize
        let initialState = {
            isUp: null,
            prevHigh: { high: currentData.high, low: currentData.low },
            prevLow: { high: currentData.high, low: currentData.low }
        };
        return initialState;
    }
    let { isUp, prevHigh, prevLow } = prevData;
    let { isTest } = currentData;
    let { high, low, ltp } = currentData;
    if (isUp) {
        // check for break
        if (prevHigh.low > low) {
            prevLow.high = high;
            prevLow.low = low;
            isUp = false;
            // need to close long position
            if (isTest) {
                console.log(`MSB Test: Closing Live long position at ${low}`);
            } else {
                console.log(`MSB: Closing Test long position at ${low}`);
            }
            // need to find the open orders and close the open orders for the symbol
            // tigger place order API here
            const requestBody = {
                "quantity": 1,
                "product": "D",
                "validity": "DAY",
                "price": ltp,
                "tag": symbol,
                "instrument_token": instrument_token,
                "order_type": "MARKET",
                "transaction_type": "SELL",
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": false,
                strategy_details
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
                console.log(`MSB Test: Opening Live long position at ${high}`);
            } else {
                console.log(`MSB: Opening Test long position at ${high}`);
            }
            // tigger place order API here
            const requestBody = {
                "quantity": 1,
                "product": "D",
                "validity": "DAY",
                "price": ltp,
                "tag": symbol,
                "instrument_token": symbol,
                "order_type": "MARKET",
                "transaction_type": "BUY",
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": false,
                strategy_details
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
    return { isUp, prevHigh, prevLow };
}

export { MSB };