import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const redisOpsCandidates = [
    path.resolve(__dirname, '../redis_operations/index.js'),
    path.resolve(__dirname, '../redis_utils/redis_operations/index.js'),
    '/app/redis_operations/index.js',
    '/app/redis_utils/redis_operations/index.js',
];
const redisOpsPath = redisOpsCandidates.find(p => existsSync(p));
let RedisClient, RedisJson;
if (redisOpsPath) {
    try {
        const mod = await import(pathToFileURL(redisOpsPath).href);
        RedisClient = mod.RedisClient;
        RedisJson = mod.RedisJson;
    } catch {
        // Fallback if redis package not available in local env
    }
}
if (!RedisClient) {
    RedisClient = class {
        constructor() {}
        connect() { return Promise.resolve(); }
        getClient() { return null; }
    };
}
if (!RedisJson) {
    RedisJson = class {
        constructor() {}
        getJson() { return Promise.resolve(null); }
        setJson() { return Promise.resolve(); }
    };
}

let winston;
try {
    winston = (await import('winston')).default;
} catch {
    winston = {
        format: {
            combine: () => {},
            timestamp: () => {},
            json: () => {},
            colorize: () => {},
            printf: () => {},
        },
        transports: {
            Console: class {},
        },
        createLogger: () => ({
            info: console.log,
            warn: console.warn,
            error: console.error,
            debug: () => {},
        }),
    };
}

const serviceName = process.env.SERVICE_NAME || 'all_service';
const serviceMode = process.env.SERVICE_MODE || 'live';
const redisUrl = process.env.REDIS_URL;
let redisClientInstance = null;
let redisJson;

const DEFAULT_LOG_LEVEL = 'info';
const LOG_REFRESH_MS = Number(process.env.LOG_CONFIG_REFRESH_MS || 5000);

let logger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: () => {},
};
let isLoggerInitialized = false;
let refreshIntervalId;

async function ensureRedisJson() {
    if (redisJson) return;
    if (!redisClientInstance) {
        redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
    }
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