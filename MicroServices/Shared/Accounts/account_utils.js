import { RedisClient, RedisJson } from './redis_operations/index.js';

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

async function getAccountBalanceFromRedis(account_id) {
    let redisKey = `account_balance:${account_id}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.balance) || 0;
    } catch (error) {
        console.error(`Error fetching account balance for account ID ${account_id} from Redis:`, error.message);
        return 0;
    }
}

async function setAccountBalanceToRedis(account_id, balance) {
    let redisKey = `account_balance:${account_id}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        await redisJson.setJson(redisKey, { balance });
        console.log(`Set account balance for account ID ${account_id} to Redis:`, balance);
    } catch (error) {
        console.error(`Error setting account balance for account ID ${account_id} in Redis:`, error.message);
        return 0;
    }
}

async function getBoughtQuantityWithTagFromRedis(tag, deploymentId) {
    let redisKey = deploymentId ? `bought_quantity:${deploymentId}:${tag}` : `bought_quantity:${tag}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.quantity) || 0;
    } catch (error) {
        console.error(`Error fetching bought quantity for tag ${tag} from Redis (key: ${redisKey}):`, error.message);
        return 0;
    }
}
async function setBoughtQuantityWithTagToRedis(tag, quantity, deploymentId) {
    let redisKey = deploymentId ? `bought_quantity:${deploymentId}:${tag}` : `bought_quantity:${tag}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        await redisJson.setJson(redisKey, { quantity });
        console.log(`Set bought quantity for tag ${tag} (key: ${redisKey}): ${quantity}`);
    } catch (error) {
        console.error(`Error setting bought quantity for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
    }
}

async function getShortQuantityWithTagFromRedis(tag, deploymentId) {
    let redisKey = deploymentId ? `short_quantity:${deploymentId}:${tag}` : `short_quantity:${tag}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.quantity) || 0;
    } catch (error) {
        console.error(`Error fetching short quantity for tag ${tag} from Redis (key: ${redisKey}):`, error.message);
        return 0;
    }
}

async function setShortQuantityWithTagToRedis(tag, quantity, deploymentId) {
    let redisKey = deploymentId ? `short_quantity:${deploymentId}:${tag}` : `short_quantity:${tag}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        await redisJson.setJson(redisKey, { quantity });
        console.log(`Set short quantity for tag ${tag} (key: ${redisKey}): ${quantity}`);
    } catch (error) {
        console.error(`Error setting short quantity for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
    }
}

export {
    getAccountBalanceFromRedis,
    setAccountBalanceToRedis,
    getBoughtQuantityWithTagFromRedis,
    setBoughtQuantityWithTagToRedis,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis
};