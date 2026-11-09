import express from 'express';
import cors from 'cors';

import { get_new_access_token, start_app_upstox } from './login.js';

const app = express();
const port = process.env.PORT || 80;
app.use(cors());

app.get('/', async (req, res) => {
    const { code, state, userId, brokerId } = req.query;

    if (code) {
        try {
            if (!state || !String(state).trim()) {
                throw new Error('OAuth callback missing required state (userId). Restart login from the Brokers page.');
            }

            console.log('Calling get_new_access_token with code and state (userId):', state);
            const stateParts = String(state).trim().split(':');
            const targetUserId = stateParts[0];
            const targetBrokerId = stateParts[1] || null;

            await get_new_access_token(code, targetUserId, targetBrokerId);
            res.send('Success!!!');
        } catch (error) {
            console.error('Error getting access token or performing operation:', error);
            res.status(500).send(error.message || 'Internal Server Error');
        }
        return;
    }

    try {
        if (!userId || !String(userId).trim()) {
            throw new Error('userId query parameter is required to start Upstox OAuth login.');
        }

        console.log('Redirecting to Upstox login for user:', userId, 'brokerId:', brokerId);
        const redirectUrl = await start_app_upstox(userId, brokerId);
        res.redirect(redirectUrl);
    } catch (err) {
        console.error('Error redirecting to Upstox authorization dialog:', err);
        res.status(500).send(`Internal Server Error: ${err.message}`);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
