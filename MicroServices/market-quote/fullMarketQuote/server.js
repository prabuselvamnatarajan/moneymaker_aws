import express from 'express';
import cors from 'cors';

import {
    getAuthorisedClient,
    resetAuthorisedClient,
    invalidateUserAccessToken,
} from './redis_utils/AuthoriseUpstoxClient.js';
import {
    validateMarketQuoteRequest,
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
        const validated = validateMarketQuoteRequest(req.query);
        if (validated.error) {
            return res.status(validated.status).send(validated.error);
        }
        const { userId, symbol } = validated;

        const UpstoxClient = await getAuthorisedClient(userId);
        const apiInstance = new UpstoxClient.MarketQuoteApi();
        const apiVersion = '2.0';

        apiInstance.getFullMarketQuote(symbol, apiVersion, async (error, data) => {
            if (error) {
                console.error('Failed to get FullMarketQuote:', error);
                resetAuthorisedClient();
                const errResult = handleApiCallbackError(error);
                if (errResult.invalidateToken) {
                    await invalidateUserAccessToken(userId).catch(() => {});
                }
                return res.status(errResult.statusCode).send(errResult.body);
            }
            console.log('API called successfully. Returned data: ' + JSON.stringify(data));
            res.send(data);
        });
    } catch (e) {
        resetAuthorisedClient();
        sendAuthError(res, e);
    }
}); else {
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
