import express from 'express';
import cors from 'cors';
import { getAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';
import { get_WS_URL } from './websocket.js';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

app.get('/', async (req, res) => {
    try {
        let symbols = req.query.symbol;
        console.log(symbols);
        if (!Array.isArray(symbols)) {
            symbols = [symbols];
        }
        console.log(symbols);
        const access_token = await getAccessTokenFromRedis();
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