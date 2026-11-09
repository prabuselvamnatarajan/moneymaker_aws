import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let redisOpsLoaded = false;
let RedisClient, RedisJson;
let redisClientInstance;
let redisJson;

async function ensureRedisOps() {
    if (redisOpsLoaded) return;
    const redisOpsCandidates = [
        path.resolve(__dirname, '../redis_operations/index.js'),
        path.resolve(__dirname, './redis_operations/index.js'),
        '/app/redis_operations/index.js',
        '/app/redis_utils/redis_operations/index.js',
    ];
    const redisOpsPath = redisOpsCandidates.find(p => existsSync(p));
    if (redisOpsPath) {
        try {
            const mod = await import(pathToFileURL(redisOpsPath).href);
            RedisClient = mod.RedisClient;
            RedisJson = mod.RedisJson;
        } catch {
            // Redis package may not be in current node_modules environment
        }
    }
    if (!RedisClient) {
        RedisClient = class {
            constructor() {}
            connect() { return Promise.resolve(); }
            getClient() { return null; }
        };
    }
    if (!RedisJson) {
        RedisJson = class {
            constructor() {}
            getJson() { return Promise.resolve(null); }
            setJson() { return Promise.resolve(); }
        };
    }
    redisOpsLoaded = true;
}

async function getRedisClientInstance() {
    await ensureRedisOps();
    if (!redisClientInstance) {
        const redisUrl = process.env.REDIS_URL;
        redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
    }
    return redisClientInstance;
}

async function ensureRedisJson() {
    if (!redisJson) {
        const clientInst = await getRedisClientInstance();
        await clientInst.connect();
        redisJson = new RedisJson(clientInst.getClient());
    }
    return redisJson;
}

export function resolveAccountBalanceKey(account_id, deploymentId, isBacktest = false) {
    return (isBacktest && deploymentId)
        ? `account_balance:${deploymentId}`
        : `account_balance:${account_id}`;
}

export function resolveBoughtQuantityKey(tag, deploymentId) {
    return deploymentId ? `bought_quantity:${deploymentId}:${tag}` : `bought_quantity:${tag}`;
}

export function resolveShortQuantityKey(tag, deploymentId) {
    return deploymentId ? `short_quantity:${deploymentId}:${tag}` : `short_quantity:${tag}`;
}

export function resolveOrderLockKey(tag, deploymentId) {
    return deploymentId ? `pending_order:${deploymentId}:${tag}` : `pending_order:${tag}`;
}

async function getAccountBalanceFromRedis(account_id, deploymentId, isBacktest = false) {
    // Only namespace by deploymentId in BACKTEST mode to prevent cross-deployment balance collisions.
    // Live/paper deployments share a real brokerage account so they MUST read the account-level key.
    const redisKey = resolveAccountBalanceKey(account_id, deploymentId, isBacktest);
    await ensureRedisJson();
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
    const redisKey = resolveAccountBalanceKey(account_id, deploymentId, isBacktest);
    await ensureRedisJson();
    try {
        await redisJson.setJson(redisKey, { balance });
        console.log(`Set account balance for key ${redisKey} to Redis:`, balance);
    } catch (error) {
        console.error(`Error setting account balance for key ${redisKey} in Redis:`, error.message);
        return 0;
    }
}

async function getBoughtQuantityWithTagFromRedis(tag, deploymentId) {
    const redisKey = resolveBoughtQuantityKey(tag, deploymentId);
    await ensureRedisJson();
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.quantity) || 0;
    } catch (error) {
        console.error(`Error fetching bought quantity for tag ${tag} from Redis (key: ${redisKey}):`, error.message);
        return 0;
    }
}
async function setBoughtQuantityWithTagToRedis(tag, quantity, deploymentId) {
    const redisKey = resolveBoughtQuantityKey(tag, deploymentId);
    await ensureRedisJson();
    try {
        await redisJson.setJson(redisKey, { quantity });
        console.log(`Set bought quantity for tag ${tag} (key: ${redisKey}): ${quantity}`);
    } catch (error) {
        console.error(`Error setting bought quantity for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
    }
}

async function getShortQuantityWithTagFromRedis(tag, deploymentId) {
    const redisKey = resolveShortQuantityKey(tag, deploymentId);
    await ensureRedisJson();
    try {
        const response = await redisJson.getJson(redisKey);
        return (response && response.quantity) || 0;
    } catch (error) {
        console.error(`Error fetching short quantity for tag ${tag} from Redis (key: ${redisKey}):`, error.message);
        return 0;
    }
}

async function setShortQuantityWithTagToRedis(tag, quantity, deploymentId) {
    const redisKey = resolveShortQuantityKey(tag, deploymentId);
    await ensureRedisJson();
    try {
        await redisJson.setJson(redisKey, { quantity });
        console.log(`Set short quantity for tag ${tag} (key: ${redisKey}): ${quantity}`);
    } catch (error) {
        console.error(`Error setting short quantity for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
    }
}

async function acquireOrderLockInRedis(tag, deploymentId, ttlSeconds = 10) {
    const redisKey = resolveOrderLockKey(tag, deploymentId);
    try {
        const clientInst = await getRedisClientInstance();
        if (!clientInst) return true;
        await clientInst.connect();
        const client = clientInst.getClient();
        if (!client) return true;
        const res = await client.set(redisKey, '1', { NX: true, EX: ttlSeconds });
        return res !== null;
    } catch (error) {
        console.error(`Error acquiring order lock for tag ${tag} in Redis (key: ${redisKey}):`, error.message);
        return true;
    }
}

async function releaseOrderLockInRedis(tag, deploymentId) {
    const redisKey = resolveOrderLockKey(tag, deploymentId);
    try {
        const clientInst = await getRedisClientInstance();
        if (!clientInst) return;
        await clientInst.connect();
        const client = clientInst.getClient();
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