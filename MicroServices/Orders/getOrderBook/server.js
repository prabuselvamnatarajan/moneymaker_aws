import express from 'express';
import cors from 'cors';

import {
    getAuthorisedClient,
    resetAuthorisedClient,
    invalidateUserAccessToken,
} from './redis_utils/AuthoriseUpstoxClient.js';
import { extractUpstoxErrorMessage } from './utils.js';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

function sendAuthError(res, e) {
    const status = e.statusCode || 500;
    const message = e.message || 'Internal Server Error';
    if (status >= 500) {
        console.error(e);
    } else {
        console.warn(message);
    }
    res.status(status).send(message);
}

app.get('/', async (req, res) => {
    try {
        const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        if (!userId) {
            return res.status(400).send('Bad Request: userId is required');
        }

        const UpstoxClient = await getAuthorisedClient(userId);
        const apiInstance = new UpstoxClient.OrderApi();
        const apiVersion = '2.0';

        apiInstance.getOrderBook(apiVersion, async (error, data) => {
            if (error) {
                console.error('Failed to get OrderBook:', error);
                resetAuthorisedClient();
                const status = error.status || error.statusCode;
                if (status === 401 || status === 403) {
                    await invalidateUserAccessToken(userId).catch(() => {});
                    return res.status(401).send(
                        'Unauthorized: Invalid or expired Upstox access token — re-authenticate via Brokers page.'
                    );
                }
                return res.status(500).send(`Internal Server Error: ${extractUpstoxErrorMessage(error)}`);
            } else {
                console.log('API called successfully. Returned data: ' + JSON.stringify(data));
                res.send(data);
            }
        });
    } catch (e) {
        resetAuthorisedClient();
        sendAuthError(res, e);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
