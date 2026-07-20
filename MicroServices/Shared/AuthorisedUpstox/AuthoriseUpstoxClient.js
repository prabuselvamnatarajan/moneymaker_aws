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
            console.log(`No access token found in Redis for key ${redisKey}. Returning null.`);
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

async function resetAuthorisedClient() {
    authorisedClient = null;
}

export { getAuthorisedClient, resetAuthorisedClient, getAccessTokenFromRedis };
