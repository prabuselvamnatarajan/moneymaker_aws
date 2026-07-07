import axios from 'axios';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { RedisClient, RedisString } from './redis_utils/redis_operations/index.js';

dotenv.config();

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisString;

const url = 'https://api.upstox.com/v2/login/authorization/token';
const headers = {
    'accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
};

async function start_app_upstox(userId = '') {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI must be defined in the environment variables.');
    }
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('BacktestApp');
        const collection = db.collection('brokers');
        
        const query = userId ? { user_id: userId, external_broker_id: 'upstox' } : { external_broker_id: 'upstox' };
        const broker = await collection.findOne(query);
        
        if (!broker || !broker.credentials) {
            throw new Error(`Upstox broker configuration not found for user: ${userId}`);
        }
        
        const { client_id, redirect_uri } = broker.credentials;
        if (!client_id || !redirect_uri) {
            throw new Error('client_id and redirect_uri must be defined in broker credentials.');
        }
        
        let url = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}`;
        if (userId) {
            url += `&state=${encodeURIComponent(userId)}`;
        }
        return url;
    } finally {
        await client.close();
    }
}

async function get_new_access_token(code, userId = '') {
    if (!code) {
        throw new Error('The "code" parameter is required but was not provided. Ensure the authorization code is passed correctly.');
    }

    console.log(`Processing code: ${code}`);

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI must be defined in the environment variables.');
    }

    const client = new MongoClient(uri);
    let broker;
    try {
        await client.connect();
        const db = client.db('BacktestApp');
        const collection = db.collection('brokers');
        
        const query = userId ? { user_id: userId, external_broker_id: 'upstox' } : { external_broker_id: 'upstox' };
        broker = await collection.findOne(query);
        if (!broker || !broker.credentials) {
            throw new Error(`Upstox broker configuration not found for user: ${userId}`);
        }
    } finally {
        await client.close();
    }

    const { client_id, client_secret, redirect_uri } = broker.credentials;

    const data = {
        'code': code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    };

    try {
        console.log('Sending request to Upstox API with data:', data);
        const response = await axios.post(url, new URLSearchParams(data), { headers });

        console.log('Response Data:', response.data);

        if (!response.data || typeof response.data.access_token !== 'string') {
            console.error('Invalid response structure:', response.data);
            throw new Error('Invalid response from Upstox API. Ensure the API is returning the correct data.');
        }

        const access_token = response.data.access_token;
        console.log(`Access Token: ${access_token}`);

        let credentials = {
            client_id,
            client_secret,
            redirect_uri,
            access_token,
            user_id: userId
        };

        await checkAndUpdateCredentials(credentials, userId);
        await setAccessTokenInRedis(credentials, userId);
        await publishBrokerUpdate(userId);
        return access_token;
    } catch (error) {
        console.error(`Error obtaining access token: ${error.message}`);
        throw new Error('Failed to obtain access token. Please check the provided "code" and API configuration.');
    }
}

async function checkAndUpdateCredentials(credentials, userId = '') {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI must be defined in the environment variables.');
    }

    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('BacktestApp');
        const collection = db.collection('brokers');

        const query = userId ? { user_id: userId, external_broker_id: 'upstox' } : { external_broker_id: 'upstox' };
        const existingEntry = await collection.findOne(query);

        if (existingEntry) {
            await collection.updateOne(query, { 
                $set: { 
                    access_token: credentials.access_token,
                    created_at: new Date()
                } 
            });
            console.log(`Access token updated in MongoDB brokers collection for user: ${userId}`);
        } else {
            const newBroker = {
                name: 'Upstox',
                is_internal: false,
                user_id: userId,
                external_broker_id: 'upstox',
                credentials: {
                    client_id: credentials.client_id,
                    client_secret: credentials.client_secret,
                    redirect_uri: credentials.redirect_uri
                },
                access_token: credentials.access_token,
                created_at: new Date()
            };
            await collection.insertOne(newBroker);
            console.log(`New Upstox broker entry created in MongoDB brokers collection for user: ${userId}`);
        }
    } catch (error) {
        console.error('Error checking/updating credentials in MongoDB:', error);
    } finally {
        await client.close();
    }
}

async function setAccessTokenInRedis(credentials, userId = '') {
    let redisKey = userId ? `redis_upstox_access_token:${userId}` : 'redis_upstox_access_token';
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
    try {
        await redisString.set(redisKey, credentials.access_token);
        console.log(`Access token set in Redis with key ${redisKey}`);
    } catch (error) {
        console.error(`Error setting Access Token in Redis with key ${redisKey} :`, error.message);
    }
}

async function publishBrokerUpdate(userId = '') {
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
    try {
        const client = redisClientInstance.getClient();
        const payload = JSON.stringify({
            event: 'broker_updated',
            userId,
            brokerId: 'upstox'
        });
        await client.publish('broker_updates', payload);
        console.log(`Published broker update to Redis channel broker_updates for user: ${userId}`);
    } catch (error) {
        console.error(`Error publishing broker update to Redis:`, error.message);
    }
}

export { get_new_access_token, start_app_upstox };
