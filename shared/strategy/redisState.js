import { RedisClient, RedisJson } from '/app/redis_utils/redis_operations/index.js';
import { logger } from '/app/utils/logUtils.js';

const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;
let connectPromise = null;

export class StaleStateEpochError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StaleStateEpochError';
    }
}

export function constructRedisKey(strategyName, symbol, isTestMode, deploymentId) {
    const mode = isTestMode ? 'backtest' : 'live';
    return deploymentId
        ? `strategies:${strategyName}:${mode}:${deploymentId}:${symbol}`
        : `strategies:${strategyName}:${mode}:${symbol}`;
}

function getEpochKey(deploymentId) {
    return `deployment_state_epoch:${deploymentId}`;
}

async function ensureRedisJson() {
    if (!redisUrl) {
        throw new Error('REDIS_URL is required for strategy state');
    }
    if (!redisJson) {
        if (!connectPromise) {
            connectPromise = (async () => {
                try {
                    await redisClientInstance.connect();
                    redisJson = new RedisJson(redisClientInstance.getClient());
                } catch (err) {
                    connectPromise = null;
                    throw err;
                }
            })();
        }
        await connectPromise;
    }
    return redisJson;
}

/**
 * Read or self-heal deployment_state_epoch.
 * Missing keys are recoverable (LRU eviction / backtest reset race) — never fatal.
 * Always seeds "1" (never trusts Kafka message epoch) so a stale in-flight tick
 * cannot pin Redis below the true epoch after eviction.
 */
export async function ensureDeploymentStateEpoch(deploymentId) {
    if (!deploymentId) {
        throw new Error('deployment_id is required to read state_epoch');
    }
    await ensureRedisJson();
    const client = redisClientInstance.getClient();
    const key = getEpochKey(deploymentId);
    const raw = await client.get(key);
    if (raw == null || raw === '') {
        const seed = '1';
        // SETNX so concurrent consumers do not clobber a bump that landed mid-flight
        const created = await client.set(key, seed, { NX: true });
        if (created) {
            logger.warn(`Recreated missing ${key} = ${seed}`);
            return 1;
        }
        const afterRace = await client.get(key);
        const epoch = Number(afterRace);
        if (!Number.isFinite(epoch)) {
            throw new Error(`Invalid deployment_state_epoch for ${deploymentId}: ${afterRace}`);
        }
        return epoch;
    }
    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) {
        throw new Error(`Invalid deployment_state_epoch for ${deploymentId}: ${raw}`);
    }
    return epoch;
}

export async function getDeploymentStateEpoch(deploymentId) {
    return ensureDeploymentStateEpoch(deploymentId);
}

/**
 * Fail softly if this Kafka message was enriched before a timeframe reset.
 * Missing message epoch (legacy routing) is healed by adopting the Redis epoch.
 * Missing Redis epoch is recreated via SETNX to 1 (never from the message).
 */
export async function assertFreshStateEpoch(strategy_details = {}) {
    const deploymentId = strategy_details.deployment_id;
    if (!deploymentId) {
        throw new Error('strategy_details.deployment_id is required');
    }

    const messageEpochRaw = strategy_details.state_epoch;
    const hasMessageEpoch = messageEpochRaw != null && Number.isFinite(Number(messageEpochRaw));
    const redisEpoch = await ensureDeploymentStateEpoch(deploymentId);

    if (!hasMessageEpoch) {
        // Rollout / stale activeStrategies without state_epoch — adopt Redis epoch
        strategy_details.state_epoch = redisEpoch;
        logger.warn(
            `strategy_details.state_epoch missing for deployment ${deploymentId}; adopting redis epoch ${redisEpoch}`
        );
        return redisEpoch;
    }

    if (Number(messageEpochRaw) !== Number(redisEpoch)) {
        throw new StaleStateEpochError(
            `Stale state_epoch for deployment ${deploymentId}: message=${messageEpochRaw} redis=${redisEpoch}`
        );
    }
    return redisEpoch;
}

export async function getStrategyStateForSymbol(strategyName, symbol, isTestMode = false, deploymentId) {
    const redisKey = constructRedisKey(strategyName, symbol, isTestMode, deploymentId);
    logger.debug(`Fetching ${strategyName} strategy state for key: ${redisKey}`);
    await ensureRedisJson();
    try {
        const data = await redisJson.getJson(redisKey);
        logger.debug(`Fetched ${strategyName} strategy state for key ${redisKey}:`, data);
        return data;
    } catch (error) {
        logger.error(
            `Error fetching strategy details for symbol ${symbol} with redis key ${redisKey} from Redis:`,
            error.message
        );
        throw error;
    }
}

export async function writeStrategyStateForSymbol(strategyName, symbol, isTestMode = false, newState, deploymentId) {
    if (!deploymentId) {
        throw new Error('deployment_id is required to write strategy state');
    }
    // Re-check epoch immediately before write to close the reset race window
    const stateEpoch = newState?.state_epoch;
    if (stateEpoch == null || !Number.isFinite(Number(stateEpoch))) {
        throw new Error(`newState.state_epoch required before write for deployment ${deploymentId}`);
    }
    const redisEpoch = await ensureDeploymentStateEpoch(deploymentId);
    if (Number(stateEpoch) !== Number(redisEpoch)) {
        throw new StaleStateEpochError(
            `Refusing stale state write for deployment ${deploymentId}: state=${stateEpoch} redis=${redisEpoch}`
        );
    }

    const redisKey = constructRedisKey(strategyName, symbol, isTestMode, deploymentId);
    await ensureRedisJson();
    const ok = await redisJson.setJson(redisKey, newState);
    if (ok == null) {
        throw new Error(`Failed to write ${strategyName} strategy state for key ${redisKey}`);
    }
    logger.debug(`Wrote ${strategyName} strategy state for key ${redisKey}:`, newState);
    return true;
}

/**
 * @param {Object} finalTick - { lastLtp, lastTickAt } from the streamer's done
 *   signal. Carried on the flag so the force-close at end of data marks out at
 *   the last replayed tick rather than whatever the position tracker last wrote.
 */
export async function setBacktestCompleted(deploymentId, runId = null, finalTick = {}) {
    await ensureRedisJson();
    const client = redisClientInstance.getClient();
    const key = `backtest_completed:${deploymentId}`;
    const lastLtp = Number(finalTick?.lastLtp);
    const lastTickAt = Number(finalTick?.lastTickAt);
    const payload = JSON.stringify({
        completed: true,
        run_id: runId != null ? String(runId) : null,
        last_ltp: Number.isFinite(lastLtp) && lastLtp > 0 ? lastLtp : null,
        last_tick_at: Number.isFinite(lastTickAt) && lastTickAt > 0 ? lastTickAt : null,
    });
    await client.set(key, payload);
    await client.expire(key, 120);
    logger.info(`Set backtest completion flag in Redis for key ${key} run_id=${runId} last_ltp=${lastLtp}`);
}
