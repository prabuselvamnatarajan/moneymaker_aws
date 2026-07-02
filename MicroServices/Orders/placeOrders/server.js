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
        const access_token = await getAccessTokenFromRedis();
        const body = req.body;

        let { strategy_details, ...filteredBody } = body;

        console.log('Request Body:', body);

        let result = null;

        if (!strategy_details.isTest) {
            filteredBody.order_type === 'MARKET' && (filteredBody.price = 0);
            result = await placeOrders(access_token, JSON.stringify(filteredBody));
            let new_balance = await getLiveAccountBalance();
            await setAccountBalanceToRedis(strategy_details.account_id, new_balance);
        } else {
            let orderResponse = await triggerBackTestApp(body);
            let { data: { closing_balance } = {} } = orderResponse || {};
            if (closing_balance !== undefined && closing_balance !== null) {
                await setAccountBalanceToRedis(strategy_details.account_id, closing_balance);
            } else {
                console.warn('⚠️ Warning: Received invalid closing balance from BackTestApp:', closing_balance);
            }
            result = 'Test Mode: Order not placed.';
        }
        
        storeOrderDetails(body.instrument_token, body);
        res.send(result);
    } catch (e) {
        console.error(e);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});