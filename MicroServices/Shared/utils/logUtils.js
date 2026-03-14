import { RedisClient, RedisJson } from './redis_operations/index.js';
import winston from 'winston';

const serviceName = process.env.SERVICE_NAME || 'all_service';
const serviceMode = process.env.SERVICE_MODE || 'live';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

let logger;

async function ensureRedisJson() {
    if (redisJson) return;
    await redisClientInstance.connect();
    redisJson = new RedisJson(redisClientInstance.getClient());
}

async function initLogger() {
    try {
        await ensureRedisJson();
        const config = await getLogConfig();
        const level = config?.level || 'info';
        logger = winston.createLogger({
            level,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console()
            ]
        });
    } catch (error) {
        console.error('Failed to init logger, using default level info:', error.message);
        logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console()
            ]
        });
    }
}

async function getLogConfig() {
    await ensureRedisJson();
    const key = `${serviceMode}:logs:config:${serviceName}`;
    try {
        const data = await redisJson.getJson(key);
        return data;
    } catch (error) {
        console.error(`Error fetching log config for key ${key} from Redis:`, error.message);
        return null;
    }
}

export { getLogConfig, initLogger, logger };