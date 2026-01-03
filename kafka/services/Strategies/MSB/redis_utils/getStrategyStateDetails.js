import { RedisClient, RedisJson } from './redis_operations/index.js';

const STRATEGY_NAME = process.env.STRATEGY_NAME || 'msb';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

function getRedisKey(symbol, isTestMode) {
    const mode = isTestMode ? 'backtest' : 'live';
    let key = `strategies:${STRATEGY_NAME}:${mode}:${symbol}`;
    return key;
}

async function getMSBStrategyStateForSymbol(symbol, isTestMode = false) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode);
        console.log(`Fetching MSB strategy state for key: ${redisKey}`);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            const data = await redisJson.getJson(redisKey);
            // if (!data || !Array.isArray(data.activeStrategies)) return [];
            console.log(`Fetched MSB strategy state for key ${redisKey}:`, data);
            return data;
        } catch (error) {
            console.error(`Error fetching strategy details for symbol ${symbol} with redis key ${redisKey} from Redis:`, error.message);
            return [];
        }
    } catch (error) {
        console.error(`Error reading MSB strategy details for symbol ${symbol}:`, error.message);
        return null;
    }
}

async function writeMSBStrategyStateForSymbol(symbol, isTestMode = false, newState) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode);
        if (!redisJson) {
            await redisClientInstance.connect();
            redisJson = new RedisJson(redisClientInstance.getClient());
        }
        try {
            await redisJson.setJson(redisKey, newState);
            console.log(`Writed MSB strategy state for key ${redisKey}:`, newState);
        } catch (error) {
            console.error(`Error writing strategy details for symbol ${symbol} with redis key ${redisKey} from Redis:`, error.message);
            return [];
        }
        // write newState to redisKey
        // write data to redis by util file.
    } catch (error) {
        console.error(`Error writing MSB strategy state for symbol ${symbol}:`, error.message);
    }
}



export {
    getMSBStrategyStateForSymbol,
    writeMSBStrategyStateForSymbol
};
