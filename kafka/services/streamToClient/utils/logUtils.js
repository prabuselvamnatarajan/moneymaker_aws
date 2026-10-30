import { RedisClient, RedisJson } from '../redis_utils/redis_operations/index.js';
import winston from 'winston';

const serviceName = process.env.SERVICE_NAME || 'all_service';
const serviceMode = process.env.SERVICE_MODE || 'live';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

const DEFAULT_LOG_LEVEL = 'info';
const LOG_REFRESH_MS = Number(process.env.LOG_CONFIG_REFRESH_MS || 5000);

let logger;
let isLoggerInitialized = false;
let refreshIntervalId;

async function ensureRedisJson() {
    if (redisJson) return;
    await redisClientInstance.connect();
    redisJson = new RedisJson(redisClientInstance.getClient());
}

async function refreshLogLevel() {
    if (!logger) return;

    const config = await getLogConfig();
    const desired = config?.level || DEFAULT_LOG_LEVEL;
    if (logger.level !== desired) {
        logger.level = desired;
        logger.info(`Log level updated to '${desired}' from Redis config`);
    }
}

async function initLogger() {
    if (isLoggerInitialized) return;

    // Create logger early so any calls during startup don't crash
    logger = winston.createLogger({
        level: DEFAULT_LOG_LEVEL,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            new winston.transports.Console()
        ]
    });

    try {
        await ensureRedisJson();
        await refreshLogLevel();
    } catch (error) {
        console.error('Failed to init logger from Redis, using default level info:', error.message);
    }

    // Periodically refresh log level from Redis. This allows runtime updates.
    if (!refreshIntervalId) {
        refreshIntervalId = setInterval(async () => {
            try {
                await refreshLogLevel();
            } catch (error) {
                logger?.warn('Failed to refresh log level from Redis:', error.message);
            }
        }, LOG_REFRESH_MS);
        // Keep Node process alive while logger refresh is active
        refreshIntervalId.unref?.();
    }

    isLoggerInitialized = true;
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