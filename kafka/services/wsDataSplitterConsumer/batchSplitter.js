import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _calculateLatency = null;
export async function getCalculateLatency() {
    if (_calculateLatency) return _calculateLatency;
    const candidates = [
        path.resolve(__dirname, './utils/latencyUtil.js'),
        path.resolve(__dirname, '../../../shared/utils/latencyUtil.js'),
        path.resolve(__dirname, '../../../../shared/utils/latencyUtil.js'),
        path.resolve(process.cwd(), 'shared/utils/latencyUtil.js'),
        path.resolve(process.cwd(), '../shared/utils/latencyUtil.js'),
        path.resolve(process.cwd(), '../../shared/utils/latencyUtil.js'),
        '/app/utils/latencyUtil.js',
    ];
    const found = candidates.find(p => existsSync(p));
    if (found) {
        const mod = await import(pathToFileURL(found).href);
        _calculateLatency = mod.calculateLatency;
        return _calculateLatency;
    }
    throw new Error(`Failed to locate latencyUtil.js. Checked: ${candidates.join(', ')}`);
}

export function sanitizeChannelName(key, livePrefix = 'live') {
    return `${livePrefix}:${String(key || '').replace(/'/g, '')}`;
}

export function splitAndTransformBatch(data, livePrefix = 'live', calculateLatencyFn = null) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid payload: expected object');
    }

    const kafkaMessages = [];
    const redisPublishes = [];

    for (const [key, value] of Object.entries(data)) {
        const latency = typeof calculateLatencyFn === 'function' ? calculateLatencyFn(key, value) : 0;
        const enriched = {
            ...value,
            latency: { beforeSplit: latency },
            symbol_name: key,
        };

        const topic = 'splited-live-data';
        const msgStr = JSON.stringify(enriched);
        const redisPublishChannel = sanitizeChannelName(key, livePrefix);

        kafkaMessages.push({
            topic,
            key,
            value: msgStr,
            parsed: enriched,
        });

        redisPublishes.push({
            channel: redisPublishChannel,
            message: msgStr,
        });
    }

    return { kafkaMessages, redisPublishes };
}

export async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000, loggerInstance = console) {
    for (let i = 0; i < retries; i++) {
        try {
            await target.connect();
            loggerInstance.info?.(`Successfully connected to ${name}.`);
            return true;
        } catch (err) {
            if (i === retries - 1) {
                throw new Error(`Failed to connect after ${retries} attempts: ${err.message}`);
            }
            loggerInstance.warn?.(`Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`);
            if (delay > 0) {
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }
}

export async function retryOperation(fn, maxRetries = 5, minTimeout = 0) {
    let lastError;
    for (let i = 1; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (minTimeout > 0) {
                await new Promise(res => setTimeout(res, minTimeout));
            }
        }
    }
    throw new Error(`Exhausted retries: ${lastError.message}`);
}
