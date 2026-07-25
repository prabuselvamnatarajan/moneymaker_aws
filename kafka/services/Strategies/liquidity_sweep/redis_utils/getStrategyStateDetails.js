import { RedisClient, RedisJson } from './redis_operations/index.js';
import { logger } from '/app/utils/logUtils.js';

const STRATEGY_NAME = process.env.STRATEGY_NAME || 'liquidity_sweep';
const redisUrl = process.env.REDIS_URL;
const redisClientInstance = new RedisClient(redisUrl ? { url: redisUrl } : {});
let redisJson;

export class StaleStateEpochError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StaleStateEpochError';
    }
}

function getRedisKey(symbol, isTestMode, deploymentId) {
    const mode = isTestMode ? 'backtest' : 'live';
    return deploymentId
        ? `strategies:${STRATEGY_NAME}:${mode}:${deploymentId}:${symbol}`
        : `strategies:${STRATEGY_NAME}:${mode}:${symbol}`;
}

function getEpochKey(deploymentId) {
    return `deployment_state_epoch:${deploymentId}`;
}

async function ensureRedisJson() {
    if (!redisUrl) {
        throw new Error('REDIS_URL is required for strategy state');
    }
    if (!redisJson) {
        await redisClientInstance.connect();
        redisJson = new RedisJson(redisClientInstance.getClient());
    }
    return redisJson;
}

/**
 * Read or self-heal deployment_state_epoch.
 * Missing keys are recoverable (LRU eviction / backtest reset race) — never fatal.
 * Always seeds "1" (never trusts Kafka message epoch) so a stale in-flight tick
 * cannot pin Redis below the true epoch after eviction.
 */
async function ensureDeploymentStateEpoch(deploymentId) {
    if (!deploymentId) {
        throw new Error('deployment_id is required to read state_epoch');
    }
    await ensureRedisJson();
    const client = redisClientInstance.getClient();
    const key = getEpochKey(deploymentId);
    const raw = await client.get(key);
    if (raw == null || raw === '') {
        const seed = '1';
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

async function getDeploymentStateEpoch(deploymentId) {
    return ensureDeploymentStateEpoch(deploymentId);
}

async function assertFreshStateEpoch(strategy_details = {}) {
    const deploymentId = strategy_details.deployment_id;
    if (!deploymentId) {
        throw new Error('strategy_details.deployment_id is required');
    }

    const messageEpochRaw = strategy_details.state_epoch;
    const hasMessageEpoch = messageEpochRaw != null && Number.isFinite(Number(messageEpochRaw));
    const redisEpoch = await ensureDeploymentStateEpoch(deploymentId);

    if (!hasMessageEpoch) {
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

async function getLiquiditySweepStateForSymbol(symbol, isTestMode = false, deploymentId) {
    const redisKey = getRedisKey(symbol, isTestMode, deploymentId);
    logger.debug(`Fetching liquidity_sweep state for key: ${redisKey}`);
    await ensureRedisJson();
    const data = await redisJson.getJson(redisKey);
    logger.debug(`Fetched liquidity_sweep state for key ${redisKey}:`, data);
    return data;
}

async function writeLiquiditySweepStateForSymbol(symbol, isTestMode = false, newState, deploymentId) {
    if (!deploymentId) {
        throw new Error('deployment_id is required to write strategy state');
    }
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

    const redisKey = getRedisKey(symbol, isTestMode, deploymentId);
    await ensureRedisJson();
    const ok = await redisJson.setJson(redisKey, newState);
    if (ok == null) {
        throw new Error(`Failed to write liquidity_sweep state for key ${redisKey}`);
    }
    logger.debug(`Wrote liquidity_sweep state for key ${redisKey}:`, newState);
    return true;
}

/**
 * @param {Object} finalTick - { lastLtp, lastTickAt } from the streamer's done
 *   signal. Carried on the flag so the force-close at end of data marks out at
 *   the last replayed tick rather than whatever the position tracker last wrote.
 */
async function setBacktestCompleted(deploymentId, runId = null, finalTick = {}) {
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

export {
    getLiquiditySweepStateForSymbol,
    writeLiquiditySweepStateForSymbol,
    setBacktestCompleted,
    getDeploymentStateEpoch,
    ensureDeploymentStateEpoch,
    assertFreshStateEpoch,
};
