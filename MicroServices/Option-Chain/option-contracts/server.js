import express from 'express';
import cors from 'cors';

import {
    getAuthorisedClient,
    resetAuthorisedClient,
    invalidateUserAccessToken,
} from './redis_utils/AuthoriseUpstoxClient.js';
import {
    validateContractsRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from './requestHelper.js';

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
        const validation = validateContractsRequest(req.query);
        if (validation.error) {
            return res.status(validation.status).send(validation.error);
        }
        const { userId, symbol, options } = validation;

        const UpstoxClient = await getAuthorisedClient(userId);
        const apiInstance = new UpstoxClient.OptionsApi();

        apiInstance.getOptionContracts(symbol, options, async (error, data) => {
            if (error) {
                console.error('Failed to get Option Contracts:', error);
                resetAuthorisedClient();
                const handled = handleApiCallbackError(error);
                if (handled.invalidateToken) {
                    await invalidateUserAccessToken(userId).catch(() => {});
                }
                return res.status(handled.statusCode).send(handled.body);
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

