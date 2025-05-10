const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

const { get_WS_URL } = require('./websocket.js');

app.get('/', async (req, res) => {
    try {
        let symbols = req.query.symbol;
        console.log(symbols);
        if (!Array.isArray(symbols)) {
            symbols = [symbols];
        }
        console.log(symbols);
        const access_token = fs.readFileSync('/shared/access_token.txt', 'utf8').trim();
        get_WS_URL({ access_token, symbol: symbols });
        res.send("Varataa Mamee tuuurrrr....");
    } catch (e) {
        console.error(e);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});