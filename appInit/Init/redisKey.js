export function normalizeRedisKeyPrefix(redisKey) {
    return typeof redisKey === 'string' && redisKey.endsWith(':')
        ? redisKey.slice(0, -1)
        : redisKey;
}

export function buildItemKey(redisKey, item, targetProperty) {
    const propertyValue = item ? item[targetProperty] : undefined;
    if (propertyValue === undefined) {
        return null;
    }
    const cleanRedisKey = normalizeRedisKeyPrefix(redisKey);
    return `${cleanRedisKey}:${propertyValue}`;
}
