import express from 'express';
import cors from 'cors';

import { get_new_access_token, start_app_upstox } from './login.js';

const app = express();
const port = process.env.PORT || 80; // Use port from environment variables
app.use(cors());

app.get('/', async (req, res) => {
    const { code } = req.query;

    if (code) {
        try {
            console.log('Calling get_new_access_token with code:', code); // Log before calling the function
            await get_new_access_token(code);
            res.send("Success!!!");
        } catch (error) {
            console.error('Error getting access token or performing operation:', error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        console.log('No code received, redirecting to Upstox login.');
        res.redirect(start_app_upstox());
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});