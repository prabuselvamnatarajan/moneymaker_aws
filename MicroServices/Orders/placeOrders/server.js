import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());
app.use(express.json());

import {
    storeOrderDetails,
    placeOrders,
    recordTradeInLedger,
    getLiveAccountBalance,
    buildBrokerOrderPayload,
    resolveExecutionMode,
    connectProducer,
    disconnectProducer,
} from './dependency.js';
import { getAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';
import { setAccountBalanceToRedis } from './redis_utils/account_utils.js';
import { resolveBalanceAfterLiveOrder } from './resolveBalanceAfterLiveOrder.js';
import { isMissingRequiredOrderFields, isMissingClientOrderId } from './orderValidation.js';
import { createOrderFlow } from './orderFlow.js';

const { handleLiveBrokerOrder, handleInternalOrder } = createOrderFlow({
    getAccessTokenFromRedis,
    placeOrders,
    recordTradeInLedger,
    getLiveAccountBalance,
    setAccountBalanceToRedis,
    buildBrokerOrderPayload,
    resolveBalanceAfterLiveOrder,
});

app.post('/', async (req, res) => {
    const body = req.body;
    const strategy_details = body.strategy_details || {};

    if (isMissingRequiredOrderFields(body)) {
        return res.status(400).send('Bad Request: Missing required order fields (instrument_token, price, quantity, transaction_type, strategy_details with user_id)');
    }

    if (isMissingClientOrderId(body)) {
        return res.status(400).send('Bad Request: client_order_id is required (reuse the same id when retrying an order)');
    }

    if ((body.price === null || body.price <= 0) && !(body.ltp > 0)) {
        console.warn(`⚠️ Warning: Incoming order has no price or tick LTP (${body.price}).`);
    }

    try {
        console.log('Request Body:', body);

        // Throws 400/409 for an unknown mode or a LIVE order on an account that
        // cannot reach a supported broker. PAPER/BACKTEST never reach the broker.
        const { shouldCallExternalBroker, isBacktest } = resolveExecutionMode(strategy_details);
        const result = shouldCallExternalBroker
            ? await handleLiveBrokerOrder(body, strategy_details, isBacktest)
            : await handleInternalOrder(body, strategy_details, isBacktest);

        res.send(result);

        // Order history only; nothing on the strategy's next tick reads it.
        storeOrderDetails(body.instrument_token, body);
    } catch (e) {
        console.error(e);
        const status = e.statusCode || 500;
        res.status(status).send(e.message || 'Internal Server Error');
    }
});

if (process.env.NODE_ENV !== 'test') {
    connectProducer();
    const server = app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
    const shutdown = () => {
        server.close(() => {
            disconnectProducer().finally(() => process.exit(0));
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

export default app;
