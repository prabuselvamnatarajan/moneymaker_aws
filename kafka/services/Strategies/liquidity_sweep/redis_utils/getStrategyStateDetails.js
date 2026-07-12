import { RedisClient, RedisJson } from './redis_operations/index.js';
import { logger } from '/app/utils/logUtils.js';

const STRATEGY_NAME = process.env.STRATEGY_NAME || 'liquidity_sweep';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

function getRedisKey(symbol, isTestMode, deploymentId) {
    const mode = isTestMode ? 'backtest' : 'live';
    return deploymentId
        ? `strategies:${STRATEGY_NAME}:${mode}:${deploymentId}:${symbol}`
        : `strategies:${STRATEGY_NAME}:${mode}:${symbol}`;
}

async function getLiquiditySweepStateForSymbol(symbol, isTestMode = false, deploymentId) {
    try {
        const redisKey = getRedisKey(symbol, isTestMode, deploymentId);
        logger.debug(`Fetching liquidity_sweep state for key: ${redisKey}`);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            const data = await redisJson.getJson(redisKey);
            logger.debug(`Fetched liquidity_sweep state for key ${redisKey}:`, data);
            return data;
        } catch (error) {
            logger.error(`Error fetching strategy state for ${symbol} key ${redisKey}:`, error.message);
            return null;
        }
    } catch (error) {
        logger.error(`Error reading liquidity_sweep state for ${symbol}:`, error.message);
        return null;
    }
}

async function writeLiquiditySweepStateForSymbol(symbol, isTestMode = false, newState, deploymentId) {
    try {
        const redisKey = getRedisKey(symbol, isTestMode, deploymentId);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            await redisJson.setJson(redisKey, newState);
            logger.debug(`Wrote liquidity_sweep state for key ${redisKey}:`, newState);
        } catch (error) {
            logger.error(`Error writing strategy state for ${symbol} key ${redisKey}:`, error.message);
        }
    } catch (error) {
        logger.error(`Error writing liquidity_sweep state for ${symbol}:`, error.message);
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
    getLiquiditySweepStateForSymbol,
    writeLiquiditySweepStateForSymbol,
    setBacktestCompleted
};
