import { RedisClient, RedisJson } from './redis_operations/index.js';
import { logger } from '/app/utils/logUtils.js';

const STRATEGY_NAME = process.env.STRATEGY_NAME || 'msb_pts';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

function getRedisKey(symbol, isTestMode, deploymentId) {
    const mode = isTestMode ? 'backtest' : 'live';
    let key = deploymentId 
        ? `strategies:${STRATEGY_NAME}:${mode}:${deploymentId}:${symbol}`
        : `strategies:${STRATEGY_NAME}:${mode}:${symbol}`;
    return key;
}

async function getMSBStrategyStateForSymbol(symbol, isTestMode = false, deploymentId) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode, deploymentId);
        logger.debug(`Fetching MSB strategy state for key: ${redisKey}`);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            const data = await redisJson.getJson(redisKey);
            logger.debug(`Fetched MSB strategy state for key ${redisKey}:`, data);
            return data;
        } catch (error) {
            logger.error(`Error fetching strategy details for symbol ${symbol} with redis key ${redisKey} from Redis:`, error.message);
            return [];
        }
    } catch (error) {
        logger.error(`Error reading MSB strategy details for symbol ${symbol}:`, error.message);
        return null;
    }
}

async function writeMSBStrategyStateForSymbol(symbol, isTestMode = false, newState, deploymentId) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode, deploymentId);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            await redisJson.setJson(redisKey, newState);
            logger.debug(`Writed MSB strategy state for key ${redisKey}:`, newState);
        } catch (error) {
            logger.error(`Error writing strategy details for symbol ${symbol} with redis key ${redisKey} from Redis:`, error.message);
            return [];
        }
    } catch (error) {
        logger.error(`Error writing MSB strategy state for symbol ${symbol}:`, error.message);
    }
}

async function setBacktestCompleted(deploymentId) {
    try {
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        const client = redisClientInstance.getClient();
        const key = `backtest_completed:${deploymentId}`;
        await client.set(key, 'true');
        await client.expire(key, 120);
        logger.info(`Set backtest completion flag in Redis for key ${key}`);
    } catch (error) {
        logger.error(`Error setting backtest completion for deployment ${deploymentId}:`, error.message);
    }
}

export {
    getMSBStrategyStateForSymbol,
    writeMSBStrategyStateForSymbol,
    setBacktestCompleted
};
