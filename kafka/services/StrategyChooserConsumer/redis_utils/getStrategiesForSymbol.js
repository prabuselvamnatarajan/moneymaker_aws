import { RedisClient, RedisJson } from './redis_operations/index.js';
import { logger } from '/app/utils/logUtils.js';

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

/**
 * Fetch active strategies for a symbol from Redis.
 * @param {boolean} isBackTest
 * @param {string} symbol
 * @returns {Promise<Array>}
 */
async function getStrategiesForSymbol(isBackTest, symbol) {
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    const key = isBackTest
        ? `strategies:backtest:${symbol}`
        : `strategies:live:${symbol}`;
    try {
        logger.debug(`Fetching strategies for key ${key} from Redis`);
        const data = await redisJson.getJson(key);
        if (!data || !Array.isArray(data.activeStrategies)) return [];
        return data.activeStrategies;
    } catch (error) {
        logger.error(`Error fetching strategies for key ${key} from Redis:`, error.message);
        return [];
    }
}

export default getStrategiesForSymbol;
