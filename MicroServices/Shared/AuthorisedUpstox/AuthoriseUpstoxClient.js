import { RedisClient, RedisString } from './redis_operations/index.js';
import UpstoxClient from "upstox-js-sdk";

const redisUrl = process.env.REDIS_URL;


const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisString;
let authorisedClient;

async function getAuthorisedClient() {
    if (!authorisedClient) {
        try {
            const access_token = await getAccessTokenFromRedis();
            let defaultClient = UpstoxClient.ApiClient.instance;
            defaultClient.authentications['OAUTH2'].accessToken = access_token;
            authorisedClient = UpstoxClient;
        } catch (error) {
            console.error(`Error Creating Authorised Client with AccessToken :`, error.message);
            return [];
        }
    }
    return authorisedClient;
}

async function getAccessTokenFromRedis() {
    if (!redisString) {
        await redisClientInstance.connect();
        redisString = new RedisString(redisClientInstance.getClient());
    }
    let redisKey = 'redis_upstox_access_token';
    try {
        const access_token = await redisString.get(redisKey);
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
