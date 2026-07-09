import express from 'express';
import cors from 'cors';

import { getAuthorisedClient, resetAuthorisedClient } from './redis_utils/AuthoriseUpstoxClient.js';


const app = express();
const port = process.env.PORT || 80;

app.use(cors());


app.get('/', async (req, res) => {
    try {
        const userId = req.query.userId || '';
        const UpstoxClient = await getAuthorisedClient(userId);

        let apiInstance = new UpstoxClient.UserApi();
        let apiVersion = "2.0"; 

        apiInstance.getUserFundMargin(apiVersion, null, (error, data, response) => {
        if (error) {
            console.error("Failed to get OrderBook:", error);
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