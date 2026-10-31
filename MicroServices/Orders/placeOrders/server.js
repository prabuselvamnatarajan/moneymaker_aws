import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());
app.use(express.json());

import { storeOrderDetails, placeOrders, triggerBackTestApp, getLiveAccountBalance, buildBrokerOrderPayload } from './dependency.js';
import { getAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';
import { setAccountBalanceToRedis } from './redis_utils/account_utils.js';
import { resolveBalanceAfterLiveOrder } from './resolveBalanceAfterLiveOrder.js';
import { isMissingRequiredOrderFields } from './orderValidation.js';

app.post('/', async (req, res) => {
    const body = req.body;
    const strategy_details = body.strategy_details || {};

    if (!body.instrument_token || body.price === undefined || body.quantity === undefined || !body.transaction_type || !body.strategy_details || !body.strategy_details.user_id) {
        return res.status(400).send('Bad Request: Missing required order fields (instrument_token, price, quantity, transaction_type, strategy_details with user_id)');
    }

    if (body.price === null || body.price <= 0) {
        console.warn(`⚠️ Warning: Incoming order price is missing or zero (${body.price}). BackTestApp will attempt LTP fallback.`);
    }

    try {
        console.log('Request Body:', body);

        let result = null;
        let orderResponse = null;

        const isLive = strategy_details.strategy_mode === 'LIVE' || strategy_details.isTest === false;
        const isInternalBroker = strategy_details.is_internal_broker === true;
        const isBacktest = strategy_details.strategy_mode === 'BACKTEST' || (strategy_details.isTest === true && strategy_details.strategy_mode !== 'LIVE');

        if (isLive && !isInternalBroker) {
            // Throws 401 if token missing/expired — no silent fallback.
            const access_token = await getAccessTokenFromRedis(strategy_details.user_id);

            // Zero MARKET price only for the broker payload; keep original body.price for ledger/analysis.
            const brokerPayload = buildBrokerOrderPayload(body);
            result = await placeOrders(access_token, JSON.stringify(brokerPayload));

            let ledgerClosingBalance = null;
            try {
                orderResponse = await triggerBackTestApp(body);
                let { data: { closing_balance } = {} } = orderResponse || {};
                ledgerClosingBalance = closing_balance;
                if (closing_balance !== undefined && closing_balance !== null) {
                    await setAccountBalanceToRedis(strategy_details.account_id, closing_balance, strategy_details.deployment_id, isBacktest);
                }
            } catch (err) {
                console.error('Failed to record successful live trade in BackTestApp:', err);
            }

            let liveBalance = null;
            try {
                liveBalance = await getLiveAccountBalance(strategy_details.user_id);
            } catch (err) {
                console.error('Failed to fetch live account balance after order (keeping ledger balance):', err.message || err);
            }

            const { balanceToStore, balanceSource } = resolveBalanceAfterLiveOrder(ledgerClosingBalance, liveBalance);

            if (balanceToStore !== null) {
                await setAccountBalanceToRedis(strategy_details.account_id, balanceToStore, strategy_details.deployment_id, isBacktest);
                if (balanceSource === 'ledger_kept_over_zero_live') {
                    console.warn(
                        `Keeping ledger balance ${ledgerClosingBalance} for account ${strategy_details.account_id}; live availableMargin was ${liveBalance}`
                    );
                }
            }
        } else {
            orderResponse = await triggerBackTestApp(body);
            let { data: { closing_balance } = {} } = orderResponse || {};
            if (closing_balance !== undefined && closing_balance !== null) {
                await setAccountBalanceToRedis(strategy_details.account_id, closing_balance, strategy_details.deployment_id, isBacktest);
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
        const status = e.statusCode || 500;
        res.status(status).send(e.message || 'Internal Server Error');
    }
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

export default app;
