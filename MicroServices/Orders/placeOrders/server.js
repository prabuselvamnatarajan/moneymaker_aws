const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 80;

app.use(cors());
app.use(express.json());

const { storeOrderDetails, placeOrders, triggerBackTestApp } = require('./dependency.js');

app.post('/', async (req, res) => {
    try {
        const access_token = fs.readFileSync('/shared/access_token.txt', 'utf8').trim();
        const body = req.body;

        let { strategy_details, ...filteredBody } = body;

        console.log('Request Body:', body);

        let result = null;

        if (!strategy_details.isTest) {
            result = await placeOrders(access_token, JSON.stringify(filteredBody));
        } else {
            await triggerBackTestApp(body);
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