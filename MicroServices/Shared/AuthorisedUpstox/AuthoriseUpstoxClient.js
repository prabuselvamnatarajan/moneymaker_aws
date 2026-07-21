import { RedisClient, RedisString } from './redis_operations/index.js';
import UpstoxClient from "upstox-js-sdk";

const redisUrl = process.env.REDIS_URL;
const DEFAULT_REDIS_KEY = 'redis_upstox_access_token';

const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisString;
let authorisedClient;

function isUpstoxTokenExpired(token, skewSeconds = 60) {
    if (!token || typeof token !== 'string') {
        return true;
    }

    try {
        const parts = token.split('.');
        if (parts.length < 2) {
            return true;
        }

        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload.exp) {
            return true;
        }

        return Date.now() / 1000 >= payload.exp - skewSeconds;
    } catch {
        return true;
    }
}

async function deleteExpiredToken(redisKey) {
    try {
        const client = redisClientInstance.getClient();
        await client.del(redisKey);
        console.warn(`[AuthoriseUpstox] Deleted expired access token from Redis key ${redisKey}`);
    } catch (error) {
        console.error(`[AuthoriseUpstox] Failed to delete expired token from key ${redisKey}:`, error.message);
    }
}

async function getAuthorisedClient(userId = '') {
    try {
        const access_token = await getAccessTokenFromRedis(userId);
        let defaultClient = UpstoxClient.ApiClient.instance;
        defaultClient.authentications['OAUTH2'].accessToken = access_token;
        authorisedClient = UpstoxClient;
    } catch (error) {
        console.error(`Error Creating Authorised Client with AccessToken :`, error.message);
        throw new Error(`Failed to authorize Upstox client: ${error.message}`);
    }
    return authorisedClient;
}

async function getAccessTokenFromRedis(userId = '') {
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
    const cleanUserId = (userId === 'default') ? '' : userId;
    let redisKey = cleanUserId ? `${DEFAULT_REDIS_KEY}:${cleanUserId}` : DEFAULT_REDIS_KEY;
    try {
        let access_token = await redisString.get(redisKey);

        if (!access_token) {
            const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
            if (mongoUri) {
                try {
                    const { MongoClient } = await import('mongodb');
                    const client = new MongoClient(mongoUri);
                    await client.connect();
                    try {
                        const db = client.db('BacktestApp');
                        const query = cleanUserId ? { user_id: cleanUserId, external_broker_id: 'upstox' } : { external_broker_id: 'upstox' };
                        const broker = await db.collection('brokers').findOne(query);
                        if (broker && broker.access_token && !isUpstoxTokenExpired(broker.access_token)) {
                            console.log(`[AuthoriseUpstox] Fetched valid token from MongoDB brokers collection for key ${redisKey}`);
                            await redisString.set(redisKey, broker.access_token);
                            return broker.access_token;
                        }
                    } finally {
                        await client.close();
                    }
                } catch (mongoErr) {
                    console.error(`[AuthoriseUpstox] Error fetching token from MongoDB for ${redisKey}:`, mongoErr.message);
                }
            }
            console.log(`No access token found in Redis or MongoDB for key ${redisKey}. Returning null.`);
            return null;
        }

        if (isUpstoxTokenExpired(access_token)) {
            console.warn(`[AuthoriseUpstox] Access token expired for key ${redisKey}`);
            await deleteExpiredToken(redisKey);
            return null;
        }

        console.log(`Fetched valid access token from key ${redisKey}`);
        return access_token;
    } catch (error) {
        console.error(`Error fetching Access Token from key ${redisKey} :`, error.message);
        return null;
    }
}

async function getOrgAccessTokenFromRedis() {
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }

    const candidateKeys = [
        `${DEFAULT_REDIS_KEY}:admin`,
        `${DEFAULT_REDIS_KEY}:org`,
        DEFAULT_REDIS_KEY
    ];

    for (const key of candidateKeys) {
        try {
            const token = await redisString.get(key);
            if (token && !isUpstoxTokenExpired(token)) {
                console.log(`[AuthoriseUpstox] Found valid Org/Admin access token under Redis key: ${key}`);
                return token;
            }
        } catch (err) {
            console.error(`[AuthoriseUpstox] Error checking key ${key}:`, err.message);
        }
    }

    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (mongoUri) {
        try {
            const { MongoClient } = await import('mongodb');
            const client = new MongoClient(mongoUri);
            await client.connect();
            try {
                const db = client.db('BacktestApp');
                const adminRole = await db.collection('roles').findOne({ name: 'admin' });
                const adminUser = adminRole ? await db.collection('users').findOne({
                    roles: { $in: [adminRole._id, adminRole._id.toString()] }
                }) : null;

                let broker = null;
                if (adminUser) {
                    const userIds = [adminUser._id, adminUser._id.toString()];
                    broker = await db.collection('brokers').findOne({
                        user_id: { $in: userIds },
                        external_broker_id: 'upstox'
                    });
                }
                if (!broker) {
                    broker = await db.collection('brokers').findOne({ external_broker_id: 'upstox' });
                }

                if (broker && broker.access_token && !isUpstoxTokenExpired(broker.access_token)) {
                    console.log('[AuthoriseUpstox] Fetched Org/Admin token from MongoDB brokers collection.');
                    await redisString.set(`${DEFAULT_REDIS_KEY}:admin`, broker.access_token);
                    await redisString.set(DEFAULT_REDIS_KEY, broker.access_token);
                    return broker.access_token;
                }
            } finally {
                await client.close();
            }
        } catch (mongoErr) {
            console.error('[AuthoriseUpstox] MongoDB lookup error for Org access token:', mongoErr.message);
        }
    }

    console.warn('[AuthoriseUpstox] No valid Org/Admin access token found for vendor market data stream.');
    return null;
}

async function resetAuthorisedClient() {
    authorisedClient = null;
}

export { getAuthorisedClient, resetAuthorisedClient, getAccessTokenFromRedis, getOrgAccessTokenFromRedis };
