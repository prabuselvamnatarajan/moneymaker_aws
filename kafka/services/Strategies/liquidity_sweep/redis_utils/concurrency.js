import { RedisClient } from './redis_operations/index.js';

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});

function openCountKey(accountId) {
    return `liquidity_sweep:open:${accountId}`;
}

async function getOpenPositionCount(accountId) {
    if (!accountId) {
        return 0;
    }
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        const val = await client.get(openCountKey(accountId));
        return parseInt(val || '0', 10) || 0;
    } catch (err) {
        console.error(`[concurrency] getOpenPositionCount error: ${err.message}`);
        return 0;
    }
}

async function incrementOpenPositions(accountId) {
    if (!accountId) {
        return;
    }
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        await client.incr(openCountKey(accountId));
    } catch (err) {
        console.error(`[concurrency] incrementOpenPositions error: ${err.message}`);
    }
}

async function decrementOpenPositions(accountId) {
    if (!accountId) {
        return;
    }
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        const key = openCountKey(accountId);
        const val = await client.decr(key);
        if (val < 0) {
            await client.set(key, '0');
        }
    } catch (err) {
        console.error(`[concurrency] decrementOpenPositions error: ${err.message}`);
    }
}

function shortQtyKey(deploymentId, tag) {
    return deploymentId ? `short_quantity:${deploymentId}:${tag}` : `short_quantity:${tag}`;
}

async function getShortQuantityWithTagFromRedis(tag, deploymentId) {
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        const raw = await client.get(shortQtyKey(deploymentId, tag));
        return parseInt(raw || '0', 10) || 0;
    } catch (err) {
        console.error(`[concurrency] getShortQuantity error: ${err.message}`);
        return 0;
    }
}

async function setShortQuantityWithTagToRedis(tag, quantity, deploymentId) {
    try {
        await redisClientInstance.connect();
        const client = redisClientInstance.getClient();
        await client.set(shortQtyKey(deploymentId, tag), String(quantity));
    } catch (err) {
        console.error(`[concurrency] setShortQuantity error: ${err.message}`);
    }
}

export {
    getOpenPositionCount,
    incrementOpenPositions,
    decrementOpenPositions,
    getShortQuantityWithTagFromRedis,
    setShortQuantityWithTagToRedis,
};
