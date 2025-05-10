const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

const { getFullMarketQuote } = require('./dependency.js');


app.get('/', async (req, res) => {
    try {
        const access_token = fs.readFileSync('/shared/access_token.txt', 'utf8').trim();
        const result = await getFullMarketQuote(access_token, req.query.symbol || 'NSE_INDEX|Nifty 50');
        res.send(result);
    } catch (e) {
        console.error(e);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});