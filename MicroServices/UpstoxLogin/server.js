import express from 'express';
import cors from 'cors';

import { get_new_access_token, start_app_upstox } from './login.js';

const app = express();
const port = process.env.PORT || 80; // Use port from environment variables
app.use(cors());

app.get('/', async (req, res) => {
    const { code, state } = req.query;

    if (code) {
        try {
            console.log('Calling get_new_access_token with code:', code, 'and state (userId):', state);
            await get_new_access_token(code, state || '');
            res.send("Success!!!");
        } catch (error) {
            console.error('Error getting access token or performing operation:', error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        console.log('No code received, redirecting to Upstox login for user:', req.query.userId || '');
        try {
            const redirectUrl = await start_app_upstox(req.query.userId || '');
            res.redirect(redirectUrl);
        } catch (err) {
            console.error('Error redirecting to Upstox authorization dialog:', err);
            res.status(500).send('Internal Server Error: ' + err.message);
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});