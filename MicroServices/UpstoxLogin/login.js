import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axios from 'axios';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const redisOpsCandidates = [
    path.resolve(__dirname, './redis_utils/redis_operations/index.js'),
    path.resolve(__dirname, '../../shared/redis_operations/index.js'),
    '/app/redis_utils/redis_operations/index.js',
    '/app/redis_operations/index.js',
];
const redisOpsPath = redisOpsCandidates.find(p => existsSync(p));
let RedisClient, RedisString;
if (redisOpsPath) {
    try {
        const mod = await import(pathToFileURL(redisOpsPath).href);
        RedisClient = mod.RedisClient;
        RedisString = mod.RedisString;
    } catch {
        // Fallback
    }
}
if (!RedisClient) {
    RedisClient = class {
        constructor() {}
        connect() { return Promise.resolve(); }
        getClient() { return null; }
    };
}
if (!RedisString) {
    RedisString = class {
        constructor() {}
        get() { return Promise.resolve(null); }
        set() { return Promise.resolve(); }
    };
}

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

function isDummyCredential(value) {
    if (!value || typeof value !== 'string') return true;
    const trimmed = value.trim().toLowerCase();
    return trimmed.startsWith('dummy') || trimmed === 'dummy';
}

function assertUpstoxCredentialFields(credentials, userId, { requireSecret = false } = {}) {
    if (!credentials || typeof credentials !== 'object') {
        throw new Error(`Upstox broker credentials missing in MongoDB for user: ${userId}`);
    }
    const creds = credentials;

    const clientId = String(creds.client_id || '').trim();
    const redirectUri = String(creds.redirect_uri || '').trim();
    const clientSecret = String(creds.client_secret || '').trim();

    if (!clientId) {
        throw new Error(`Upstox client_id missing in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
    }
    if (isDummyCredential(clientId)) {
        throw new Error(`Upstox client_id contains an invalid dummy placeholder in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
    }

    if (!redirectUri) {
        throw new Error(`Upstox redirect_uri missing in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
    }
    if (isDummyCredential(redirectUri)) {
        throw new Error(`Upstox redirect_uri contains an invalid dummy placeholder in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
    }

    if (requireSecret) {
        if (!clientSecret) {
            throw new Error(`Upstox client_secret missing in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
        }
        if (isDummyCredential(clientSecret)) {
            throw new Error(`Upstox client_secret contains an invalid dummy placeholder in database for user: ${userId}. Please configure valid Upstox credentials in broker settings.`);
        }
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

async function isAdminUser(userId) {
    return withMongoClient(async (db) => {
        const adminRole = await db.collection('roles').findOne({ name: 'admin' });
        if (!adminRole) {
            return false;
        }

        const adminRoleIds = new Set([adminRole._id.toString(), String(adminRole._id)]);

        let user;
        try {
            user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        } catch {
            user = await db.collection('users').findOne({ _id: userId });
        }

        if (!user || !Array.isArray(user.roles)) {
            return false;
        }

        return user.roles.some((role) => {
            const roleIdStr = typeof role === 'object' && role !== null ? String(role._id || role) : String(role);
            return adminRoleIds.has(roleIdStr);
        });
    });
}

async function getUpstoxBrokerFromDb(userId, { requireSecret = false, brokerId = null } = {}) {
    const cleanUserId = requireUserId(userId);

    const userIds = [cleanUserId];
    if (ObjectId.isValid(cleanUserId)) {
        userIds.push(new ObjectId(cleanUserId));
    }

    const isAdmin = await isAdminUser(cleanUserId);

    let broker = null;
    if (brokerId && ObjectId.isValid(brokerId)) {
        broker = await withMongoClient(async (db) => {
            const query = isAdmin
                ? { _id: new ObjectId(brokerId), external_broker_id: 'upstox' }
                : { _id: new ObjectId(brokerId), user_id: { $in: userIds }, external_broker_id: 'upstox' };
            return db.collection('brokers').findOne(query);
        });
        if (!broker) {
            throw new Error(`Upstox broker configuration with ID ${brokerId} not found${isAdmin ? '' : ' or does not belong to user: ' + cleanUserId}`);
        }
    }

    if (!broker) {
        broker = await withMongoClient(async (db) =>
            db.collection('brokers').findOne({
                user_id: { $in: userIds },
                external_broker_id: 'upstox',
            })
        );
    }

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
        let RedisClientClass, RedisStringClass;
        try {
            const redisModule = await import('./redis_utils/redis_operations/index.js');
            RedisClientClass = redisModule.RedisClient;
            RedisStringClass = redisModule.RedisString;
        } catch {
            const redisModule = await import('../../shared/redis_operations/index.js');
            RedisClientClass = redisModule.RedisClient;
            RedisStringClass = redisModule.RedisString;
        }
        const redisUrl = requireEnv('REDIS_URL');
        redisClientInstance = new RedisClientClass({ url: redisUrl });
        await redisClientInstance.connect();
        redisString = new RedisStringClass(redisClientInstance.getClient());
    }
    return redisString;
}

function buildAuthDialogUrl(credentials, userId, brokerId = null) {
    const cleanUserId = requireUserId(userId);
    const stateValue = brokerId ? `${cleanUserId}:${brokerId}` : cleanUserId;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: credentials.client_id,
        redirect_uri: credentials.redirect_uri,
        state: stateValue,
    });
    return `${UPSTOX_AUTH_DIALOG_URL}?${params.toString()}`;
}

async function start_app_upstox(userId, brokerId = null) {
    const { credentials, userId: cleanUserId, broker } = await getUpstoxBrokerFromDb(userId, { brokerId });
    const effectiveBrokerId = broker?._id ? String(broker._id) : (brokerId || '');
    return buildAuthDialogUrl(credentials, cleanUserId, effectiveBrokerId);
}

function extractUpstoxError(error) {
    const upstoxMessage = error?.response?.data?.message
        || error?.response?.data?.error?.reason
        || error?.response?.data?.error
        || null;
    return upstoxMessage
        ? `Failed to obtain Upstox access token: ${upstoxMessage}`
        : `Failed to obtain Upstox access token: ${error?.message || 'Upstox API request failed'}`;
}

function validateTokenPayload(payload) {
    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
        throw new Error('Invalid response from Upstox API: access_token missing.');
    }
    return payload.access_token.trim();
}

function formatBrokerUpdate(userId) {
    return JSON.stringify({
        event: 'broker_updated',
        userId,
        brokerId: 'upstox',
    });
}

async function get_new_access_token(code, userId, brokerId = null) {
    if (!code || !String(code).trim()) {
        throw new Error('The "code" parameter is required but was not provided.');
    }

    const cleanCode = String(code).trim();
    console.log(`Processing Upstox authorization code for user: ${requireUserId(userId)}`);

    const { credentials, userId: cleanUserId, broker } = await getUpstoxBrokerFromDb(userId, { requireSecret: true, brokerId });

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

        access_token = validateTokenPayload(response.data);
        console.log('Access token obtained successfully from Upstox API.');
    } catch (error) {
        const errorText = extractUpstoxError(error);
        console.error(errorText);

        if (error.response?.data) {
            console.error('Upstox token exchange response:', JSON.stringify(error.response.data));
        }

        throw new Error(errorText);
    }

    await persistAccessTokenInMongo(cleanUserId, access_token, broker?._id || brokerId);

    const targetUserId = broker?.user_id ? String(broker.user_id) : cleanUserId;
    await setAccessTokenInRedis(access_token, targetUserId);
    if (targetUserId !== cleanUserId) {
        await setAccessTokenInRedis(access_token, cleanUserId);
    }
    await publishBrokerUpdate(targetUserId);
    if (targetUserId !== cleanUserId) {
        await publishBrokerUpdate(cleanUserId);
    }

    return access_token;
}

async function persistAccessTokenInMongo(userId, accessToken, brokerId = null) {
    const cleanUserId = requireUserId(userId);
    const userIds = [cleanUserId];
    if (ObjectId.isValid(cleanUserId)) {
        userIds.push(new ObjectId(cleanUserId));
    }

    const isAdmin = await isAdminUser(cleanUserId);

    const filter = (brokerId && ObjectId.isValid(brokerId))
        ? (isAdmin ? { _id: new ObjectId(brokerId), external_broker_id: 'upstox' } : { _id: new ObjectId(brokerId), user_id: { $in: userIds }, external_broker_id: 'upstox' })
        : { user_id: { $in: userIds }, external_broker_id: 'upstox' };

    const updateFields = {
        access_token: accessToken,
        created_at: new Date(),
    };

    const updateResult = await withMongoClient(async (db) =>
        db.collection('brokers').updateOne(
            filter,
            { $set: updateFields }
        )
    );

    if (updateResult.matchedCount === 0) {
        throw new Error(`Upstox broker record not found or does not belong to user: ${cleanUserId}`);
    }

    console.log(`Access token updated in MongoDB brokers collection for user: ${cleanUserId}`);
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
    const payload = formatBrokerUpdate(userId);

    await client.publish('broker_updates', payload);
    console.log(`Published broker update to Redis channel broker_updates for user: ${userId}`);
}

export {
    get_new_access_token,
    start_app_upstox,
    requireUserId,
    assertUpstoxCredentialFields,
    buildAuthDialogUrl,
    extractUpstoxError,
    validateTokenPayload,
    formatBrokerUpdate,
    isDummyCredential,
    getUpstoxBrokerFromDb,
    isAdminUser,
};
