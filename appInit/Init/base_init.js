import { connect } from '../db/connect.js';
import { getRedisTargetByType, addDataToRedisTarget, clearRedisKeyIfNeeded } from '../../shared/redis_operations/helpers.js';
import { normalizeRedisKeyPrefix } from './redisKey.js';

// main now takes config parameters
async function main({
    mongoUri,
    dbName,
    collection,
    redisKey,
    redisDataType,
    redisUrl,
    targetProperty
}) {
    // Connect to MongoDB and fetch all documents
    const db = await connect(mongoUri, dbName);
    const data = await db.collection(collection).find({}).toArray();

    // Get Redis target by type
    const redisTarget = await getRedisTargetByType(redisDataType, redisUrl);

    // Clear existing keys for each item if needed
    for (const item of data) {
        const propertyValue = item[targetProperty];
        if (propertyValue === undefined) {
            console.error(`Missing property '${targetProperty}' in document:`, item);
            continue;
        }
        const cleanRedisKey = normalizeRedisKeyPrefix(redisKey);
        const redisItemKey = `${cleanRedisKey}:${propertyValue}`;
        await clearRedisKeyIfNeeded(redisTarget, redisDataType, redisItemKey);
        await addDataToRedisTarget(redisTarget, redisDataType, redisItemKey, item);
    }

    // Disconnect Redis client if available
    if (redisTarget.client && typeof redisTarget.client.disconnect === 'function') {
        await redisTarget.client.disconnect();
    }
}

export { main };
