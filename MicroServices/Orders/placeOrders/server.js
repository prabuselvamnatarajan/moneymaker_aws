import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());
app.use(express.json());

import { storeOrderDetails, placeOrders, triggerBackTestApp, getLiveAccountBalance } from './dependency.js';
import { getAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';
import { setAccountBalanceToRedis } from './redis_utils/account_utils.js';

app.post('/', async (req, res) => {
    try {
        const body = req.body;

        // 1. Input Validation
        if (!body.instrument_token || body.price === undefined || body.quantity === undefined || !body.transaction_type || !body.strategy_details || !body.strategy_details.user_id) {
            return res.status(400).send('Bad Request: Missing required order fields (instrument_token, price, quantity, transaction_type, strategy_details with user_id)');
        }

        const { strategy_details = {}, ...filteredBody } = body;
        const access_token = await getAccessTokenFromRedis(strategy_details.user_id);

        console.log('Request Body:', body);

        let result = null;
        let orderResponse = null;

        // Determine if the deployment strategy mode is LIVE and if it has an external broker
        const isLive = strategy_details.strategy_mode === 'LIVE' || strategy_details.isTest === false;
        const isInternalBroker = strategy_details.is_internal_broker === true;

        if (isLive && !isInternalBroker) {
            // Live External Order: Call Upstox broker FIRST
            filteredBody.order_type === 'MARKET' && (filteredBody.price = 0);
            result = await placeOrders(access_token, JSON.stringify(filteredBody));
            
            // Only if Upstox order succeeds, record the trade in our internal app (BackTestApp)
            try {
                orderResponse = await triggerBackTestApp(body);
                let { data: { closing_balance } = {} } = orderResponse || {};
                if (closing_balance !== undefined && closing_balance !== null) {
                    await setAccountBalanceToRedis(strategy_details.account_id, closing_balance);
                }
            } catch (err) {
                console.error('Failed to record successful live trade in BackTestApp:', err);
            }

            // Sync live account balance
            let new_balance = await getLiveAccountBalance(strategy_details.user_id);
            if (new_balance !== undefined && new_balance !== null) {
                await setAccountBalanceToRedis(strategy_details.account_id, new_balance);
            }
        } else {
            // Test Mode or Internal Broker: Record trade in our internal app FIRST
            orderResponse = await triggerBackTestApp(body);
            let { data: { closing_balance } = {} } = orderResponse || {};
            if (closing_balance !== undefined && closing_balance !== null) {
                await setAccountBalanceToRedis(strategy_details.account_id, closing_balance);
            } else {
                console.warn('⚠️ Warning: Received invalid closing balance from BackTestApp:', closing_balance);
            }

            if (isInternalBroker) {
                result = 'Internal Broker Mode: Order recorded internally.';
            } else {
                result = 'Test Mode: Order not placed with external broker.';
            }
        }
        
        storeOrderDetails(body.instrument_token, body);
        res.send(result || orderResponse);
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message || 'Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});