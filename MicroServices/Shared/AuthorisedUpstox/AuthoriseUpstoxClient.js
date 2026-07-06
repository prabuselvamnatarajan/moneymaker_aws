import { RedisClient, RedisString } from './redis_operations/index.js';
import UpstoxClient from "upstox-js-sdk";

const redisUrl = process.env.REDIS_URL;


const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisString;
let authorisedClient;

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
    let redisKey = userId ? `redis_upstox_access_token:${userId}` : 'redis_upstox_access_token';
    try {
        let access_token = await redisString.get(redisKey);
        if (!access_token && !userId) {
            console.log("No default token, checking for user-specific tokens in Redis...");
            const client = redisClientInstance.getClient();
            const keys = await client.keys('redis_upstox_access_token:*');
            if (keys && keys.length > 0) {
                access_token = await redisString.get(keys[0]);
                console.log(`Fallback: Fetched Access Token from key ${keys[0]}:`, access_token);
            }
        }
        console.log(`Fetched Access Token from key ${redisKey}:`, access_token);
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
