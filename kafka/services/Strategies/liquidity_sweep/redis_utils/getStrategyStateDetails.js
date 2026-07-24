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

async function getDeploymentStateEpoch(deploymentId) {
    if (!deploymentId) {
        throw new Error('deployment_id is required to read state_epoch');
    }
    await ensureRedisJson();
    const client = redisClientInstance.getClient();
    const raw = await client.get(getEpochKey(deploymentId));
    if (raw == null || raw === '') {
        throw new Error(`deployment_state_epoch missing for deployment ${deploymentId}`);
    }
    const epoch = Number(raw);
    if (!Number.isFinite(epoch)) {
        throw new Error(`Invalid deployment_state_epoch for ${deploymentId}: ${raw}`);
    }
    return epoch;
}

async function assertFreshStateEpoch(strategy_details = {}) {
    const deploymentId = strategy_details.deployment_id;
    if (!deploymentId) {
        throw new Error('strategy_details.deployment_id is required');
    }
    const messageEpoch = strategy_details.state_epoch;
    if (messageEpoch == null || !Number.isFinite(Number(messageEpoch))) {
        throw new Error(`strategy_details.state_epoch missing for deployment ${deploymentId}`);
    }
    const redisEpoch = await getDeploymentStateEpoch(deploymentId);
    if (Number(messageEpoch) !== Number(redisEpoch)) {
        throw new StaleStateEpochError(
            `Stale state_epoch for deployment ${deploymentId}: message=${messageEpoch} redis=${redisEpoch}`
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
    const redisEpoch = await getDeploymentStateEpoch(deploymentId);
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

async function setBacktestCompleted(deploymentId) {
    await ensureRedisJson();
    const client = redisClientInstance.getClient();
    const key = `backtest_completed:${deploymentId}`;
    await client.set(key, 'true');
    await client.expire(key, 120);
    logger.info(`Set backtest completion flag in Redis for key ${key}`);
}

export {
    getLiquiditySweepStateForSymbol,
    writeLiquiditySweepStateForSymbol,
    setBacktestCompleted,
    getDeploymentStateEpoch,
    assertFreshStateEpoch,
};
