import express from 'express';
import cors from 'cors';

import { getAuthorisedClient, resetAuthorisedClient } from './redis_utils/AuthoriseUpstoxClient.js';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

app.get('/', async (req, res) => {
    try {

        let { symbol = "NSE_INDEX|Nifty 50", expiry } = req.query;
        let options = expiry ? { expiryDate: expiry } : null;

        const UpstoxClient = await getAuthorisedClient();

        let apiInstance  = new UpstoxClient.OptionsApi();

        apiInstance.getOptionContracts(symbol, options, (error, data, response) => {
            if (error) {
                console.error("Failed to get Option Contracts:", error);
                resetAuthorisedClient();
                res.status(500).send('Internal Server Error');
            } else {
                console.log('API called successfully. Returned data: ' + JSON.stringify(data));
                res.send(data);
            }
        });
    } catch (e) {
        console.error(e);
        resetAuthorisedClient();
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});