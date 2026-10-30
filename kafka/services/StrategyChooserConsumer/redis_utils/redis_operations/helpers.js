import { RedisClient, RedisString, RedisHash, RedisList, RedisSet, RedisSortedSet, RedisJson } from './index.js';

export async function getRedisTargetByType(dataType, redisUrl) {
    const redisOptions = redisUrl ? { url: redisUrl } : {};
    const redisClient = new RedisClient(redisOptions);
    await redisClient.connect();
    const client = redisClient.getClient();

    let target;
    switch (dataType) {
        case 'string':
            target = new RedisString(client);
            break;
        case 'json':
            target = new RedisJson(client);
            break;
        case 'list':
            target = new RedisList(client);
            break;
        case 'set':
            target = new RedisSet(client);
            break;
        case 'hash':
            target = new RedisHash(client);
            break;
        case 'sortedset':
        case 'zset':
            target = new RedisSortedSet(client);
            break;
        default:
            await redisClient.disconnect();
            throw new Error(`Unsupported Redis data type: ${dataType}`);
    }

    return target;
}

export async function addDataToRedisTarget(redisTarget, dataType, key, data) {
    switch (dataType) {
        case 'string':
            await redisTarget.set(key, JSON.stringify(data));
            break;
        case 'json':
            await redisTarget.setJson(key, data);
            break;
        case 'list':
            if (Array.isArray(data)) {
                for (const item of data) {
                    await redisTarget.rPush(key, JSON.stringify(item));
                }
            }
            break;
        case 'set':
            if (Array.isArray(data)) {
                for (const item of data) {
                    await redisTarget.sAdd(key, JSON.stringify(item));
                }
            }
            break;
        case 'hash':
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item._id) {
                        await redisTarget.hSet(key, item._id.toString(), JSON.stringify(item));
                    }
                }
            }
            break;
        default:
            throw new Error(`Unsupported REDIS_DATA_TYPE: ${dataType}`);
    }
}

export async function clearRedisKeyIfNeeded(redisTarget, dataType, key) {
    if (['list', 'set', 'hash'].includes(dataType)) {
        await redisTarget.client.del(key);
    }
}
