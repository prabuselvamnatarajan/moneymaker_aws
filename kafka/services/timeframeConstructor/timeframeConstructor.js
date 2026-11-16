import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kafka } from 'kafkajs';
import { createClient } from 'redis';
import { SymbolStateManager } from './src/core/symbolStateManager.js';
import { TimeframeProducer } from './src/producers/timeframeProducer.js';
import { TickConsumer } from './src/consumers/tickConsumer.js';
import { PersistenceService } from './src/storage/persistenceService.js';

// Environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const CONSUMER_GROUP_ID = process.env.CONSUMER_GROUP_ID || 'timeframe_constructor_group';
const INPUT_TOPICS = (process.env.INPUT_TOPICS || 'splited-live-data,backtest-stream-data')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const BACKTEST_INPUT_TOPIC = process.env.BACKTEST_INPUT_TOPIC || 'backtest-stream-data';
const OUTPUT_LIVE_TOPIC = process.env.OUTPUT_LIVE_TOPIC || 'timeframe_live_data';
const OUTPUT_BACKTEST_TOPIC = process.env.OUTPUT_BACKTEST_TOPIC || 'timeframe_backtest_data';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KAFKA_NUM_PARTITIONS = parseInt(process.env.KAFKA_NUM_PARTITIONS || '50', 10);

const kafka = new Kafka({
  clientId: 'timeframe-constructor',
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 20,
  },
});

async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await target.connect();
      console.log(`[TimeframeConstructor] Connected to ${name}`);
      return;
    } catch (err) {
      console.warn(
        `[TimeframeConstructor] Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error(`Failed to connect to ${name} after ${retries} attempts.`);
}

async function ensureTopicPartitions(topics, numPartitions = 50) {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const existingSet = new Set(existingTopics);
    const toCreate = [];

    for (const t of topics) {
      if (!existingSet.has(t)) {
        toCreate.push({ topic: t, numPartitions, replicationFactor: 3 });
      }
    }

    if (toCreate.length > 0) {
      await admin.createTopics({ topics: toCreate, waitForLeaders: true });
      console.log(
        `[TimeframeConstructor] Created topics with ${numPartitions} partitions: ${toCreate.map((t) => t.topic).join(', ')}`
      );
    }
  } catch (err) {
    console.warn(`[TimeframeConstructor] Auto-ensure topic partitions notice: ${err.message}`);
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

export function handleFatalError(error, context = 'service') {
  console.error(`[TimeframeConstructor] Fatal error in ${context}:`, error);
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
  throw error;
}

export function registerFatalErrorHandlers() {
  process.on('uncaughtException', (error) => {
    handleFatalError(error, 'uncaught exception');
  });

  process.on('unhandledRejection', (reason) => {
    handleFatalError(reason, 'unhandled rejection');
  });
}

export function registerKafkaCrashHandler(consumer) {
  if (consumer && consumer.events && consumer.events.CRASH) {
    consumer.on(consumer.events.CRASH, (event) => {
      handleFatalError(event.payload.error, 'Kafka consumer crash');
    });
  }
}

export async function startServer() {
  registerFatalErrorHandlers();

  const consumer = kafka.consumer({ groupId: CONSUMER_GROUP_ID, sessionTimeout: 30000 });
  const producer = kafka.producer();

  registerKafkaCrashHandler(consumer);

  let redisClient = null;
  try {
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    console.log('[TimeframeConstructor] Connected to Redis (Stateless Mode Enabled)');
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[TimeframeConstructor] Fatal: Redis connection required for stateless processing in production: ${err.message}`);
      process.exit(1);
    }
    console.warn(`[TimeframeConstructor] Redis connection warning (stateless mode disabled, local fallback): ${err.message}`);
  }

  await connectWithRetry(producer, 'Kafka Producer');
  await connectWithRetry(consumer, 'Kafka Consumer');

  const topicsToEnsure = [OUTPUT_LIVE_TOPIC, OUTPUT_BACKTEST_TOPIC];
  await ensureTopicPartitions(topicsToEnsure, KAFKA_NUM_PARTITIONS);

  const stateManager = new SymbolStateManager();
  const tfProducer = new TimeframeProducer(producer, console);
  const persistence = redisClient ? new PersistenceService(redisClient) : null;

  const tickConsumer = new TickConsumer({
    symbolStateManager: stateManager,
    timeframeProducer: tfProducer,
    persistenceService: persistence,
    outputLiveTopic: OUTPUT_LIVE_TOPIC,
    outputBacktestTopic: OUTPUT_BACKTEST_TOPIC,
    backtestInputTopic: BACKTEST_INPUT_TOPIC,
    logger: console,
  });

  for (const topic of INPUT_TOPICS) {
    await consumer.subscribe({ topic, fromBeginning: false });
    console.log(`[TimeframeConstructor] Subscribed to topic: ${topic}`);
  }

  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await tickConsumer.handleMessage(payload);
      } catch (err) {
        console.error(`[TimeframeConstructor] Fatal error handling message on ${payload.topic}:`, err);
        handleFatalError(err, `message handling on ${payload.topic}`);
      }
    },
  });

  const shutdown = async () => {
    console.log('[TimeframeConstructor] Shutting down...');
    await consumer.disconnect().catch(() => {});
    await producer.disconnect().catch(() => {});
    if (redisClient) await redisClient.disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.env.NODE_ENV !== 'test' &&
  process.env.NODE_ENV !== 'test_env'
) {
  startServer().catch((err) => {
    console.error('[TimeframeConstructor] Fatal startup error:', err);
    process.exit(1);
  });
}
