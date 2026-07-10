import express from 'express';
import cors from 'cors';

import { getAuthorisedClient, resetAuthorisedClient } from './redis_utils/AuthoriseUpstoxClient.js';


const app = express();
const port = process.env.PORT || 80;

app.use(cors());


app.get('/', async (req, res) => {
    try {
        const UpstoxClient = await getAuthorisedClient(req.query.userId || '');
        let marketQuoteApiInstance = new UpstoxClient.MarketQuoteV3Api();
        marketQuoteApiInstance.getLtp({instrumentKey: req.query.symbol || 'NSE_INDEX|Nifty 50'}, (error, data, response) => {
            if (error) {
                console.error("Failed to get LTP:", error);
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