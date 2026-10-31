export function normalizeRedisKeyPrefix(redisKey) {
    return typeof redisKey === 'string' && redisKey.endsWith(':')
        ? redisKey.slice(0, -1)
        : redisKey;
}
