import { RedisClient, RedisJson } from './redis_operations/index.js';

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

async function getAccountBalanceFromRedis(account_id, deploymentId, isBacktest = false) {
    // Only namespace by deploymentId in BACKTEST mode to prevent cross-deployment balance collisions.
    // Live/paper deployments share a real brokerage account so they MUST read the account-level key.
    let redisKey = (isBacktest && deploymentId)
        ? `account_balance:${deploymentId}`
        : `account_balance:${account_id}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.balance) || 0;
    } catch (error) {
        console.error(`Error fetching account balance for key ${redisKey} from Redis:`, error.message);
        return 0;
    }
}

async function setAccountBalanceToRedis(account_id, balance, deploymentId, isBacktest = false) {
    // Only namespace by deploymentId in BACKTEST mode.
    let redisKey = (isBacktest && deploymentId)
        ? `account_balance:${deploymentId}`
        : `account_balance:${account_id}`;
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    try {
        await redisJson.setJson(redisKey, { balance });
        console.log(`Set account balance for key ${redisKey} to Redis:`, balance);
    } catch (error) {
        console.error(`Error setting account balance for key ${redisKey} in Redis:`, error.message);
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

async function acquireOrderLockInRedis(tag, deploymentId, ttlSeconds = 10) {
    let redisKey = deploymentId ? `pending_order:${deploymentId}:${tag}` : `pending_order:${tag}`;
    if (!redisClientInstance) return true;
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        if (!client) return true;
        const res = await client.set(redisKey, '1', { NX: true, EX: ttlSeconds });
        return res !== null;
    } catch (error) {
        console.error(`Error acquiring order lock for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
        return true;
    }
}

async function releaseOrderLockInRedis(tag, deploymentId) {
    let redisKey = deploymentId ? `pending_order:${deploymentId}:${tag}` : `pending_order:${tag}`;
    if (!redisClientInstance) return;
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        if (client) {
            await client.del(redisKey);
        }
    } catch (error) {
        console.error(`Error releasing order lock for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
    }
}

export {
    getAccountBalanceFromRedis,
    setAccountBalanceToRedis,
    getBoughtQuantityWithTagFromRedis,
    setBoughtQuantityWithTagToRedis,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis,
    acquireOrderLockInRedis,
    releaseOrderLockInRedis
};