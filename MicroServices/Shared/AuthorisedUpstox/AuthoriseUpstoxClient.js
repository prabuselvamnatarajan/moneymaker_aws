import { RedisClient, RedisString } from './redis_operations/index.js';
import UpstoxClient from "upstox-js-sdk";

const redisUrl = process.env.REDIS_URL;
const DEFAULT_REDIS_KEY = 'redis_upstox_access_token';

const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisString;
let authorisedClient;

function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

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

async function ensureRedisString() {
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
}

async function getAuthorisedClient(userId = '') {
    const cleanUserId = String(userId || '').trim();
    if (!cleanUserId || cleanUserId === 'default') {
        throw httpError('Bad Request: userId is required to authorize Upstox client', 400);
    }

    try {
        const access_token = await getAccessTokenFromRedis(cleanUserId);
        if (!access_token) {
            throw httpError(
                `Unauthorized: Upstox access token missing or expired for user ${cleanUserId}`,
                401
            );
        }
        const defaultClient = UpstoxClient.ApiClient.instance;
        defaultClient.authentications['OAUTH2'].accessToken = access_token;
        authorisedClient = UpstoxClient;
    } catch (error) {
        if (error.statusCode) throw error;
        console.error(`Error Creating Authorised Client with AccessToken :`, error.message);
        throw httpError(`Failed to authorize Upstox client: ${error.message}`, 500);
    }
    return authorisedClient;
}

async function getAccessTokenFromRedis(userId = '') {
    // User-scoped lookups require an explicit userId. Org feed must use getOrgAccessTokenFromRedis().
    const cleanUserId = (userId === 'default') ? '' : String(userId || '').trim();
    if (!cleanUserId) {
        throw httpError(
            'Bad Request: userId is required for getAccessTokenFromRedis. Use getOrgAccessTokenFromRedis for org feed.',
            400
        );
    }

    await ensureRedisString();
    const redisKey = `${DEFAULT_REDIS_KEY}:${cleanUserId}`;

    let access_token;
    try {
        access_token = await redisString.get(redisKey);
    } catch (error) {
        console.error(`Error fetching Access Token from key ${redisKey} :`, error.message);
        throw httpError(`Failed to read Upstox access token from Redis: ${error.message}`, 500);
    }

    if (!access_token) {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (mongoUri) {
            try {
                const { MongoClient } = await import('mongodb');
                const client = new MongoClient(mongoUri);
                await client.connect();
                try {
                    const db = client.db('BacktestApp');
                    const broker = await db.collection('brokers').findOne({
                        user_id: cleanUserId,
                        external_broker_id: 'upstox',
                    });
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
        throw httpError(
            `Unauthorized: Upstox access token missing or expired for user ${cleanUserId}`,
            401
        );
    }

    if (isUpstoxTokenExpired(access_token)) {
        console.warn(`[AuthoriseUpstox] Access token expired for key ${redisKey}`);
        await deleteExpiredToken(redisKey);
        throw httpError(
            `Unauthorized: Upstox access token expired for user ${cleanUserId}`,
            401
        );
    }

    console.log(`Fetched valid access token from key ${redisKey}`);
    return access_token;
}

async function getOrgAccessTokenFromRedis() {
    await ensureRedisString();

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
        let mongodbModule = null;
        try {
            mongodbModule = await import('mongodb');
        } catch {
            // mongodb package not installed in this service
        }

        if (mongodbModule && mongodbModule.MongoClient) {
            try {
                const client = new mongodbModule.MongoClient(mongoUri);
                await client.connect();
                try {
                    const db = client.db('BacktestApp');
                    const adminRole = await db.collection('roles').findOne({ name: 'admin' });
                    const adminUser = adminRole ? await db.collection('users').findOne({
                        roles: { $in: [adminRole._id, adminRole._id.toString()] }
                    }) : null;

                    // Only use an admin user's broker — never fall back to an arbitrary Upstox broker.
                    let broker = null;
                    if (adminUser) {
                        const userIds = [adminUser._id, adminUser._id.toString()];
                        broker = await db.collection('brokers').findOne({
                            user_id: { $in: userIds },
                            external_broker_id: 'upstox'
                        });
                    }

                    if (broker && broker.access_token && !isUpstoxTokenExpired(broker.access_token)) {
                        console.log('[AuthoriseUpstox] Fetched Org/Admin token from MongoDB brokers collection.');
                        await redisString.set(`${DEFAULT_REDIS_KEY}:admin`, broker.access_token);
                        await redisString.set(`${DEFAULT_REDIS_KEY}:org`, broker.access_token);
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
    }

    throw httpError(
        'Service Unavailable: Org/Admin Upstox access token missing or expired — re-authenticate admin via Brokers page.',
        503
    );
}

async function resetAuthorisedClient() {
    authorisedClient = null;
}

export { getAuthorisedClient, resetAuthorisedClient, getAccessTokenFromRedis, getOrgAccessTokenFromRedis };
