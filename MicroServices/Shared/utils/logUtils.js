import { RedisClient, RedisJson } from './redis_operations/index.js';

const serviceName = process.env.SERVICE_NAME || 'all_service';
const serviceMode = process.env.SERVICE_MODE || 'live';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

async function getLogConfig() {
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    const key = `${serviceMode}:logs:config:${serviceName}`;
    try {
        const data = await redisJson.getJson(key);
        return data;
    } catch (error) {
        console.error(`Error fetching log config for key ${key} from Redis:`, error.message);
        return null;
    }
    
}

export { getLogConfig };