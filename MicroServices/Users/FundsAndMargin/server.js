import express from 'express';
import cors from 'cors';

import { getAuthorisedClient, resetAuthorisedClient } from './redis_utils/AuthoriseUpstoxClient.js';

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
        const apiInstance = new UpstoxClient.UserApi();
        const apiVersion = '2.0';

        apiInstance.getUserFundMargin(apiVersion, null, (error, data) => {
            if (error) {
                console.error('Failed to get FundsAndMargin:', error);
                resetAuthorisedClient();
                res.status(500).send('Internal Server Error');
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
