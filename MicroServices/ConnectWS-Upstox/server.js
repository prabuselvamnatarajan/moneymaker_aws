import express from 'express';
import cors from 'cors';
import { getOrgAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';
import { get_WS_URL, initRedisSubscriber } from './websocket.js';

const app = express();
const port = process.env.PORT || 80;

app.use(cors());

initRedisSubscriber().catch(err => {
    console.error('Failed to initialize Redis Subscriber in server.js:', err);
});

app.get('/', async (req, res) => {
    try {
        let symbols = req.query.symbol;
        console.log(symbols);
        if (!Array.isArray(symbols)) {
            symbols = [symbols];
        }
        console.log(symbols);
        // Throws 503 if org token missing — no silent fallback.
        const access_token = await getOrgAccessTokenFromRedis();
        get_WS_URL({ access_token, symbol: symbols });
        res.send("Varataa Mamee tuuurrrr....");
    } catch (e) {
        console.error(e);
        const status = e.statusCode || 500;
        res.status(status).send(e.message || 'Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
