import { createClient } from 'redis';
import { Kafka } from 'kafkajs';
import { initLogger, logger } from '/app/utils/logUtils.js';
import { handleFatalError, registerFatalErrorHandlers, registerKafkaCrashHandler } from '/app/utils/kafkaErrorHandler.js';
import { extractLtp } from './extractLtp.js';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPICS = (process.env.TARGET_TOPIC || 'splited-live-data,backtest-stream-data')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || 'deployment_symbol_resolver_group';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const BACKTEST_APP_URL = (process.env.BACKTEST_APP_URL || 'http://backtest-app:80').replace(/\/$/, '');
const BACKTEST_SERVICE_TOKEN = process.env.BACKTEST_SERVICE_TOKEN || '';
/** How often to refresh underlying→deployment index from Redis (ms). */
const INDEX_REFRESH_MS = Number(process.env.SYMBOL_CONTROL_INDEX_REFRESH_MS || 10000);
/** Min gap between resolve API calls for the same deployment (ms). */
const RESOLVE_THROTTLE_MS = Number(process.env.SYMBOL_CONTROL_RESOLVE_THROTTLE_MS || 5000);

const kafka = new Kafka({
  clientId: 'deployment-symbol-resolver',
  brokers: KAFKA_BROKERS,
  retry: { initialRetryTime: 300, retries: 20 },
});

let redisClient;

/** underlying_token -> [{ deployment_id, last_resolved_strike, strike_price_diff, pending_resolve }] */
let interestMap = new Map();
/** deployment_id -> last resolve attempt timestamp */
const lastResolveAt = new Map();

registerFatalErrorHandlers();

function computeReferenceStrike(ltp, strikePriceDiff) {
  const diff = Number(strikePriceDiff);
  const price = Number(ltp);
  if (!(diff > 0) || !(price > 0)) return null;
  return Math.round(price / diff) * diff;
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
      logger.warn(
        `Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error(`Failed to connect to ${name} after maximum retries.`);
}

async function refreshInterestMap() {
  try {
    const tokens = await redisClient.sMembers('symbol_control:underlyings');
    const next = new Map();
    for (const token of tokens || []) {
      const payload = await getJson(`symbol_control:deps:${token}`);
      const deps = payload?.deployments || [];
      if (deps.length > 0) {
        next.set(token, deps);
      }
    }
    interestMap = next;
    logger.debug?.(
      `Refreshed symbol_control interest map: ${next.size} underlyings`
    );
  } catch (err) {
    logger.error(`Failed to refresh symbol_control index: ${err.message}`);
  }
}

async function callResolveApi(deploymentId, ltp, referenceStrike) {
  const url = `${BACKTEST_APP_URL}/deployments/${deploymentId}/resolve-symbol`;
  const headers = { 'Content-Type': 'application/json' };
  if (BACKTEST_SERVICE_TOKEN) {
    headers['X-Service-Token'] = BACKTEST_SERVICE_TOKEN;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ltp,
      reference_strike: referenceStrike,
    }),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `resolve-symbol HTTP ${res.status}: ${body.message || text || 'unknown error'}`
    );
  }
  return body;
}

async function handleTick(symbol, data) {
  const deps = interestMap.get(symbol);
  if (!deps || deps.length === 0) {
    return;
  }

  const ltp = extractLtp(data);
  if (ltp == null || !(ltp > 0)) {
    return;
  }

  await Promise.all(
    deps.map(async (dep) => {
      try {
        const strikeDiff = Number(dep.strike_price_diff);
        if (!(strikeDiff > 0)) {
          return;
        }

        // Already waiting for flat — flush happens in BackTestApp on position close
        if (dep.pending_resolve) {
          return;
        }

        const referenceStrike = computeReferenceStrike(ltp, strikeDiff);
        if (referenceStrike == null) {
          return;
        }

        if (
          dep.last_resolved_strike != null &&
          Number(dep.last_resolved_strike) === referenceStrike
        ) {
          return;
        }

        const now = Date.now();
        const last = lastResolveAt.get(dep.deployment_id) || 0;
        if (now - last < RESOLVE_THROTTLE_MS) {
          return;
        }
        lastResolveAt.set(dep.deployment_id, now);

        logger.info(
          `Strike grid change for ${symbol}: LTP=${ltp} ref=${referenceStrike} last=${dep.last_resolved_strike} → resolve deployment ${dep.deployment_id}`
        );

        const result = await callResolveApi(dep.deployment_id, ltp, referenceStrike);
        if (result?.data?.deferred) {
          dep.pending_resolve = true;
          logger.info(
            `Resolve deferred (open position) for deployment ${dep.deployment_id}`
          );
        } else if (result?.data?.deployment?.symbol_control) {
          dep.last_resolved_strike =
            result.data.deployment.symbol_control.last_resolved_strike ?? referenceStrike;
          dep.pending_resolve = !!result.data.deployment.symbol_control.pending_resolve;
        } else {
          dep.last_resolved_strike = referenceStrike;
        }
      } catch (err) {
        // Back off for 30s on error to avoid rapid retries when service or option chain is failing
        lastResolveAt.set(dep.deployment_id, Date.now() + 30000);
        logger.error(
          `Failed resolve for deployment ${dep.deployment_id}: ${err.message}`
        );
      }
    })
  );
}

async function createConsumer() {
  const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
  registerKafkaCrashHandler(consumer);

  redisClient = createClient({ url: REDIS_URL });
  await connectWithRetry(redisClient, 'Redis Client');

  await refreshInterestMap();
  setInterval(() => {
    refreshInterestMap().catch((err) =>
      logger.error(`Periodic index refresh failed: ${err.message}`)
    );
  }, INDEX_REFRESH_MS);

  await connectWithRetry(consumer, 'Kafka Consumer');
  for (const topic of TARGET_TOPICS) {
    await consumer.subscribe({ topic, fromBeginning: false });
    logger.info(`Subscribed to topic ${topic}`);
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const symbol = message.key?.toString?.() || '';
        if (!symbol) return;
        // Fast path: ignore ticks for underlyings with no controlled deployments
        if (!interestMap.has(symbol)) return;
        const data = JSON.parse(message.value.toString());
        await handleTick(symbol, data);
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
