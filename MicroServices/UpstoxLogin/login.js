import axios from 'axios';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { RedisClient, RedisString } from './redis_utils/redis_operations/index.js';

dotenv.config();

const UPSTOX_TOKEN_URL = 'https://api.upstox.com/v2/login/authorization/token';
const UPSTOX_AUTH_DIALOG_URL = 'https://api.upstox.com/v2/login/authorization/dialog';
const UPSTOX_TOKEN_HEADERS = {
    accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
};

let redisClientInstance;
let redisString;

function requireEnv(name) {
    const value = process.env[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} must be defined in the environment variables.`);
    }
    return value.trim();
}

function requireUserId(userId) {
    const cleanUserId = String(userId || '').trim();
    if (!cleanUserId) {
        throw new Error(
            'userId is required. Pass ?userId= when starting OAuth, and ensure Upstox returns state in the callback.'
        );
    }
    return cleanUserId;
}

function assertUpstoxCredentialFields(credentials, userId, { requireSecret = false } = {}) {
    if (!credentials || typeof credentials !== 'object') {
        throw new Error(`Upstox broker credentials missing in MongoDB for user: ${userId}`);
    }

    const clientId = String(credentials.client_id || '').trim();
    const redirectUri = String(credentials.redirect_uri || '').trim();
    const clientSecret = String(credentials.client_secret || '').trim();

    if (!clientId) {
        throw new Error(`Upstox client_id missing in MongoDB broker credentials for user: ${userId}`);
    }
    if (!redirectUri) {
        throw new Error(`Upstox redirect_uri missing in MongoDB broker credentials for user: ${userId}`);
    }
    if (requireSecret && !clientSecret) {
        throw new Error(`Upstox client_secret missing in MongoDB broker credentials for user: ${userId}`);
    }

    return {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
    };
}

async function withMongoClient(callback) {
    const uri = requireEnv('MONGODB_URI');
    const dbName = requireEnv('MONGO_DB');
    const client = new MongoClient(uri);

    try {
        await client.connect();
        return await callback(client.db(dbName));
    } finally {
        await client.close();
    }
}

async function getUpstoxBrokerFromDb(userId, { requireSecret = false } = {}) {
    const cleanUserId = requireUserId(userId);

    const broker = await withMongoClient(async (db) =>
        db.collection('brokers').findOne({
            user_id: cleanUserId,
            external_broker_id: 'upstox',
        })
    );

    if (!broker) {
        throw new Error(`Upstox broker configuration not found in MongoDB for user: ${cleanUserId}`);
    }

    const credentials = assertUpstoxCredentialFields(broker.credentials, cleanUserId, { requireSecret });

    return {
        broker,
        credentials,
        userId: cleanUserId,
    };
}

async function getRedisString() {
    if (!redisString) {
        const redisUrl = requireEnv('REDIS_URL');
        redisClientInstance = new RedisClient({ url: redisUrl });
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
    return redisString;
}

async function isAdminUser(userId) {
    return withMongoClient(async (db) => {
        const adminRole = await db.collection('roles').findOne({ name: 'admin' });
        if (!adminRole) {
            throw new Error('Admin role not found in MongoDB while resolving Upstox token scope.');
        }

        const adminRoleIds = new Set([adminRole._id.toString(), String(adminRole._id)]);

        let user;
        try {
            user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        } catch {
            user = await db.collection('users').findOne({ _id: userId });
        }

        if (!user) {
            throw new Error(`User ${userId} not found in MongoDB while resolving Upstox token scope.`);
        }

        if (!Array.isArray(user.roles)) {
            return false;
        }

        return user.roles.some((role) => adminRoleIds.has(String(role)));
    });
}

async function start_app_upstox(userId) {
    const { credentials, userId: cleanUserId } = await getUpstoxBrokerFromDb(userId);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: credentials.client_id,
        redirect_uri: credentials.redirect_uri,
        state: cleanUserId,
    });

    return `${UPSTOX_AUTH_DIALOG_URL}?${params.toString()}`;
}

async function get_new_access_token(code, userId) {
    if (!code || !String(code).trim()) {
        throw new Error('The "code" parameter is required but was not provided.');
    }

    const cleanCode = String(code).trim();
    console.log(`Processing Upstox authorization code for user: ${requireUserId(userId)}`);

    const { credentials, userId: cleanUserId } = await getUpstoxBrokerFromDb(userId, { requireSecret: true });

    const data = {
        code: cleanCode,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        redirect_uri: credentials.redirect_uri,
        grant_type: 'authorization_code',
    };

    let access_token;
    try {
        console.log(`Sending Upstox token exchange request (redirect_uri: ${credentials.redirect_uri}).`);
        const response = await axios.post(UPSTOX_TOKEN_URL, new URLSearchParams(data), {
            headers: UPSTOX_TOKEN_HEADERS,
        });

        if (!response.data || typeof response.data.access_token !== 'string' || !response.data.access_token.trim()) {
            throw new Error('Invalid response from Upstox API: access_token missing.');
        }

        access_token = response.data.access_token.trim();
        console.log('Access token obtained successfully from Upstox API.');
    } catch (error) {
        const upstoxMessage = error.response?.data?.message
            || error.response?.data?.error?.reason
            || error.response?.data?.error
            || null;

        if (upstoxMessage) {
            console.error(`Upstox token exchange failed: ${upstoxMessage}`);
        } else {
            console.error(`Upstox token exchange failed: ${error.message}`);
        }

        if (error.response?.data) {
            console.error('Upstox token exchange response:', JSON.stringify(error.response.data));
        }

        throw new Error(
            upstoxMessage
                ? `Failed to obtain Upstox access token: ${upstoxMessage}`
                : `Failed to obtain Upstox access token: ${error.message}`
        );
    }

    await persistAccessTokenInMongo(cleanUserId, access_token);
    await setAccessTokenInRedis(access_token, cleanUserId);
    await publishBrokerUpdate(cleanUserId);

    return access_token;
}

async function persistAccessTokenInMongo(userId, accessToken) {
    const updateResult = await withMongoClient(async (db) =>
        db.collection('brokers').updateOne(
            { user_id: userId, external_broker_id: 'upstox' },
            {
                $set: {
                    access_token: accessToken,
                    created_at: new Date(),
                },
            }
        )
    );

    if (updateResult.matchedCount === 0) {
        throw new Error(`Upstox broker record not found in MongoDB while saving access token for user: ${userId}`);
    }

    console.log(`Access token updated in MongoDB brokers collection for user: ${userId}`);
}

async function setAccessTokenInRedis(accessToken, userId) {
    const redis = await getRedisString();
    const userKey = `redis_upstox_access_token:${userId}`;

    await redis.set(userKey, accessToken);
    console.log(`Access token set in Redis with key ${userKey}`);

    const isAdmin = await isAdminUser(userId);
    if (!isAdmin) {
        return;
    }

    await redis.set('redis_upstox_access_token:admin', accessToken);
    await redis.set('redis_upstox_access_token:org', accessToken);
    await redis.set('redis_upstox_access_token', accessToken);
    console.log('Org/Admin access token set in Redis with keys redis_upstox_access_token:admin, :org, and default');
}

async function publishBrokerUpdate(userId) {
    const redis = await getRedisString();
    const client = redisClientInstance.getClient();
    const payload = JSON.stringify({
        event: 'broker_updated',
        userId,
        brokerId: 'upstox',
    });

    await client.publish('broker_updates', payload);
    console.log(`Published broker update to Redis channel broker_updates for user: ${userId}`);
}

export { get_new_access_token, start_app_upstox };
