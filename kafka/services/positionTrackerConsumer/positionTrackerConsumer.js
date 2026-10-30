import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from 'redis';
import { Kafka } from 'kafkajs';
import { initLogger, logger } from '../../../MicroServices/Shared/utils/logUtils.js';
import { handleFatalError, registerFatalErrorHandlers, registerKafkaCrashHandler } from '../../../MicroServices/Shared/utils/kafkaErrorHandler.js';
import {
  calcUnrealizedPnl,
  calcProfitPct,
  applyExcursion,
  extractLtp,
  extractTickTimeMs,
  tickTargetsPosition,
} from './excursionMath.js';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPICS = (process.env.TARGET_TOPIC || 'splited-live-data,backtest-stream-data')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const BACKTEST_TOPIC = process.env.BACKTEST_TOPIC || 'backtest-stream-data';
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || 'position_tracker_group';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'BacktestApp';
/** Throttle for unrealised_pnl / last_ltp writes (ms). Extremes always write immediately. */
const UNREALISED_WRITE_THROTTLE_MS = Number(process.env.UNREALISED_WRITE_THROTTLE_MS || 2000);

const kafka = new Kafka({
  clientId: 'position-tracker',
  brokers: KAFKA_BROKERS,
  retry: { initialRetryTime: 300, retries: 20 },
});

const mongoClient = new MongoClient(MONGO_URI);
let redisClient;
let positionsCollection;

function openSymbolKey(symbol) {
  return `position:open:${String(symbol || '').toUpperCase()}`;
}

function liveKey(positionId) {
  return `position:live:${positionId}`;
}

function throttleKey(positionId) {
  return `position:throttle:unrealised:${positionId}`;
}

async function isThrottleExpired(positionMongoId) {
  const raw = await redisClient.get(throttleKey(positionMongoId)).catch(() => null);
  const lastWrite = raw ? parseInt(raw, 10) : 0;
  return Date.now() - lastWrite >= UNREALISED_WRITE_THROTTLE_MS;
}

async function markThrottleWritten(positionMongoId) {
  const ttlSec = Math.max(10, Math.ceil(UNREALISED_WRITE_THROTTLE_MS / 1000) * 2);
  await redisClient.set(throttleKey(positionMongoId), String(Date.now()), { EX: ttlSec }).catch(() => {});
}

function topicAllowsMode(topic, strategyMode) {
  const mode = String(strategyMode || '').toUpperCase();
  const isBacktestTopic = topic === BACKTEST_TOPIC;
  if (isBacktestTopic) return mode === 'BACKTEST';
  // Live market feed updates LIVE and PAPER only
  return mode === 'LIVE' || mode === 'PAPER';
}

async function setJson(key, value) {
  if (typeof redisClient.json?.set === 'function') {
    await redisClient.json.set(key, '.', value);
  } else {
    await redisClient.set(key, JSON.stringify(value));
  }
}

async function getJson(key) {
  if (typeof redisClient.json?.get === 'function') {
    return await redisClient.json.get(key);
  }
  const raw = await redisClient.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await target.connect();
      logger.info(`Successfully connected to ${name}.`);
      return;
    } catch (err) {
      logger.warn(`Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error(`Failed to connect to ${name} after maximum retries.`);
}

function buildCacheFromDoc(doc) {
  return {
    positionMongoId: doc._id.toString(),
    positionId: doc.position_id || doc._id.toString(),
    symbol: String(doc.symbol || '').toUpperCase(),
    entryPrice: doc.average_entry_price || 0,
    direction: doc.direction,
    openSize: doc.open_size || 0,
    maxUp: doc.max_up || 0,
    maxDown: doc.max_down || 0,
    maxUpPct: doc.max_up_pct || 0,
    maxDownPct: doc.max_down_pct || 0,
    unrealisedPnl: doc.unrealised_pnl || 0,
    lastLtp: doc.last_ltp || 0,
    lastTickAt: doc.last_tick_at ? new Date(doc.last_tick_at).getTime() : 0,
    strategyMode: doc.strategy_mode || null,
    deploymentId: doc.deployment_id?.toString?.() || doc.deployment_id || null,
  };
}

async function evictPositionFromRedis(positionMongoId, symbolHint, docSymbol) {
  await redisClient.del(liveKey(positionMongoId)).catch(() => {});
  await redisClient.del(throttleKey(positionMongoId)).catch(() => {});
  if (symbolHint) {
    await redisClient.sRem(openSymbolKey(symbolHint), positionMongoId).catch(() => {});
  }
  if (docSymbol) {
    await redisClient.sRem(openSymbolKey(docSymbol), positionMongoId).catch(() => {});
  }
}

async function selfHealCache(positionMongoId, symbolHint) {
  try {
    const doc = await positionsCollection.findOne({
      _id: new ObjectId(positionMongoId),
      status: 'OPEN',
    });
    if (!doc || !(doc.open_size > 0)) {
      await evictPositionFromRedis(positionMongoId, symbolHint, doc?.symbol);
      return null;
    }
    const cache = buildCacheFromDoc(doc);
    await setJson(liveKey(positionMongoId), cache);
    await redisClient.sAdd(openSymbolKey(cache.symbol), positionMongoId);
    logger.info(`Self-healed Redis cache for open position ${positionMongoId}`);
    return cache;
  } catch (err) {
    logger.error(`Self-heal failed for ${positionMongoId}: ${err.message}`);
    await redisClient.del(throttleKey(positionMongoId)).catch(() => {});
    return null;
  }
}

async function updatePositionForTick(positionMongoId, ltp, symbolHint, tickTimeMs, topic, tickDeploymentId) {
  let cache = await getJson(liveKey(positionMongoId));
  if (!cache) {
    cache = await selfHealCache(positionMongoId, symbolHint);
    if (!cache) return;
  }

  // Missing strategyMode: heal from Mongo before the topic filter runs
  if (!cache.strategyMode) {
    const healed = await selfHealCache(positionMongoId, symbolHint);
    if (!healed) return;
    cache = healed;
  }

  // Mongo has no mode either, so the position cannot be attributed to a topic.
  // Evict rather than heal again, or every tick costs a findOne forever.
  if (!cache.strategyMode) {
    logger.warn(`Evicting position ${positionMongoId}: no strategy_mode to match against topic ${topic}`);
    await evictPositionFromRedis(positionMongoId, symbolHint, cache.symbol);
    return;
  }

  if (!topicAllowsMode(topic, cache.strategyMode)) {
    return;
  }

  if (!tickTargetsPosition(topic === BACKTEST_TOPIC, tickDeploymentId, cache.deploymentId)) {
    return;
  }

  if (cache.strategyMode === 'BACKTEST' && cache.deploymentId) {
    const closeTimeStr = await redisClient.get(`deployment:close_time:${cache.deploymentId}`).catch(() => null);
    if (closeTimeStr) {
      const closeTime = parseInt(closeTimeStr, 10);
      if (Number.isFinite(closeTime) && tickTimeMs > closeTime) {
        logger.info(`Ignoring tick ${tickTimeMs} for deployment ${cache.deploymentId} because it is after close time ${closeTime}`);
        return;
      }
    }
  }


  if (!(cache.openSize > 0) || !(cache.entryPrice > 0)) {
    return;
  }

  const unrealised = calcUnrealizedPnl(cache.entryPrice, cache.direction, cache.openSize, ltp);
  const pct = calcProfitPct(cache.entryPrice, cache.direction, ltp);
  const extremum = applyExcursion(cache, unrealised, pct);

  const extremeChanged =
    extremum.maxUp !== (cache.maxUp || 0) ||
    extremum.maxDown !== (cache.maxDown || 0) ||
    extremum.maxUpPct !== (cache.maxUpPct || 0) ||
    extremum.maxDownPct !== (cache.maxDownPct || 0);

  const nextCache = {
    ...cache,
    maxUp: extremum.maxUp,
    maxDown: extremum.maxDown,
    maxUpPct: extremum.maxUpPct,
    maxDownPct: extremum.maxDownPct,
    unrealisedPnl: unrealised,
    lastLtp: ltp,
    lastTickAt: tickTimeMs != null && tickTimeMs > 0 ? tickTimeMs : cache.lastTickAt || 0,
  };

  await setJson(liveKey(positionMongoId), nextCache);

  const throttleExpired = await isThrottleExpired(positionMongoId);

  if (!extremeChanged && !throttleExpired) {
    return;
  }

  const updateSet = {
    unrealised_pnl: unrealised,
    last_ltp: ltp,
  };
  if (tickTimeMs != null && tickTimeMs > 0) {
    updateSet.last_tick_at = new Date(tickTimeMs);
  }

  const updateDoc = {
    $set: updateSet,
  };

  if (extremeChanged) {
    updateDoc.$max = {
      max_up: extremum.maxUp,
      max_up_pct: extremum.maxUpPct,
    };
    updateDoc.$min = {
      max_down: extremum.maxDown,
      max_down_pct: extremum.maxDownPct,
    };
  }

  const query = {
    _id: new ObjectId(positionMongoId),
  };
  if (tickTimeMs != null && tickTimeMs > 0) {
    query.$or = [
      { status: 'OPEN' },
      { closed_at: { $gte: new Date(tickTimeMs - 5000) } },
    ];
  } else {
    query.status = 'OPEN';
  }

  await positionsCollection.updateOne(query, updateDoc);
  await markThrottleWritten(positionMongoId);
}

async function handleTick(symbol, data, topic) {
  const ltp = extractLtp(data);
  if (ltp == null || !(ltp > 0)) {
    return;
  }

  const tickTimeMs = extractTickTimeMs(data);
  const tickDeploymentId = data?.deployment_id ? String(data.deployment_id) : null;

  const members = await redisClient.sMembers(openSymbolKey(symbol));
  if (!members || members.length === 0) {
    return;
  }

  await Promise.all(
    members.map(async (positionMongoId) => {
      try {
        await updatePositionForTick(positionMongoId, ltp, symbol, tickTimeMs, topic, tickDeploymentId);
      } catch (err) {
        logger.error(`Failed updating position ${positionMongoId}: ${err.message}`);
      }
    })
  );
}

async function createConsumer() {
  const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
  registerKafkaCrashHandler(consumer);

  await connectWithRetry(mongoClient, 'MongoDB Client');
  const db = mongoClient.db(MONGO_DB);
  positionsCollection = db.collection('positions');

  redisClient = createClient({ url: REDIS_URL });
  await connectWithRetry(redisClient, 'Redis Client');

  await connectWithRetry(consumer, 'Kafka Consumer');
  for (const topic of TARGET_TOPICS) {
    await consumer.subscribe({ topic, fromBeginning: false });
    logger.info(`Subscribed to topic ${topic}`);
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        if (!message.value) return;
        const data = JSON.parse(message.value.toString());
        const rawKey = message.key?.toString?.() || '';
        const symbol = String(data.symbol || data.name || data.symbolName || rawKey).toUpperCase();
        if (!symbol) return;
        await handleTick(symbol, data, topic);
      } catch (error) {
        handleFatalError(error, `message handling on ${topic}`);
      }
    },
  });
}

async function startServer() {
  await initLogger();
  await createConsumer();
}
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test_env') {
  startServer().catch((err) => {
    handleFatalError(err, 'consumer startup');
  });
}
export { startServer, extractLtp, handleTick };
