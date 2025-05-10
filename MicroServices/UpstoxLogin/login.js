const axios = require('axios');
require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const url = 'https://api.upstox.com/v2/login/authorization/token';
const headers = {
    'accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
};

async function get_new_access_token(code) {
    if (!code) {
        throw new Error('The "code" parameter is required but was not provided. Ensure the authorization code is passed correctly.');
    }

    console.log(`Processing code: ${code}`); // Log the received code

    const data = {
        'code': code, // change on every request
        'client_id': process.env.CLIENT_ID,
        'client_secret': process.env.CLIENT_SECRET,
        'redirect_uri': process.env.REDIRECT_URI,
        'grant_type': 'authorization_code'
    };

    try {
        console.log('Environment Variables:', {
            CLIENT_ID: process.env.CLIENT_ID,
            CLIENT_SECRET: process.env.CLIENT_SECRET,
            REDIRECT_URI: process.env.REDIRECT_URI,
            MONGODB_URI: process.env.MONGODB_URI,
            MONGODB_DB_NAME: process.env.MONGODB_DB_NAME
        }); // Log environment variables to ensure they are defined

        console.log('Sending request to Upstox API with data:', data); // Log the request data
        const response = await axios.post(url, new URLSearchParams(data), { headers });

        console.log('Response Data:', response.data); // Log the full response data to check for missing properties
        console.log('Received response from Upstox API:', response.data); // Log the full response for debugging

        // Validate the response structure
        if (!response.data || typeof response.data.access_token !== 'string') {
            console.error('Invalid response structure:', response.data); // Log the invalid response
            throw new Error('Invalid response from Upstox API. Ensure the API is returning the correct data.');
        }

        const access_token = response.data.access_token;

        console.log(`Access Token: ${access_token}`);
        await checkAndUpdateCredentials({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            redirect_uri: process.env.REDIRECT_URI,
            access_token
        });
        return access_token;
    } catch (error) {
        console.error(`Error obtaining access token: ${error.message}`);
        throw new Error('Failed to obtain access token. Please check the provided "code" and API configuration.');
    }
}

function start_app_upstox() {

    const client_id = process.env.CLIENT_ID;
    const redirect_uri = process.env.REDIRECT_URI;
    
    if (!client_id || !redirect_uri) {
        throw new Error('CLIENT_ID and REDIRECT_URI must be defined in the environment variables.');
    }
    
    return `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}`;
}


async function checkAndUpdateCredentials(credentials) {
    const uri = process.env.MONGODB_URI; // MongoDB connection string
    const dbName = process.env.MONGODB_DB_NAME;

    if (!uri || !dbName) {
        throw new Error('MONGODB_URI and MONGODB_DB_NAME must be defined in the environment variables.');
    }

    console.log('MongoDB URI:', uri); // Log the MongoDB URI for debugging
    console.log('MongoDB Database Name:', dbName); // Log the database name for debugging

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const database = client.db(dbName);
        const collection = database.collection('credentials');

        const query = {
            client_id: credentials.client_id,
            redirect_uri: credentials.redirect_uri
        };

        const existingEntry = await collection.findOne(query);

        if (existingEntry) {
            // Update the access_token of the existing entry
            await collection.updateOne(query, { $set: { access_token: credentials.access_token } });
            console.log('Access token updated in MongoDB');
        } else {
            // Add a new entry
            await collection.insertOne(credentials);
            console.log('New credentials stored in MongoDB');
        }

        // Use the shared directory path from environment variables
        const sharedDir = process.env.SHARED_DIR || '/shared';
        const sharedFilePath = path.join(sharedDir, 'access_token.txt');
        fs.writeFileSync(sharedFilePath, credentials.access_token, 'utf8');
        console.log(`Access token written to file: ${sharedFilePath}`);
    } catch (error) {
        if (error.codeName === 'Unauthorized') {
            console.error('MongoDB authentication failed. Please check your credentials in the MONGODB_URI.');
        } else {
            console.error('Error checking/updating credentials in MongoDB:', error);
        }
    } finally {
        await client.close();
    }
}

module.exports = {
    get_new_access_token,
    start_app_upstox,
    checkAndUpdateCredentials
};
