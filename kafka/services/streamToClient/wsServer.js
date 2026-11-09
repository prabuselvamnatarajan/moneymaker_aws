import { WebSocketServer } from 'ws';
import { v4 as uuid } from "uuid";
import RedisPubSub from "./redis_utils/redis_operations/RedisPubSub.js";
import dotenv from "dotenv";
import { initLogger, logger } from '/app/utils/logUtils.js';
import { fanoutRedisMessage } from './fanout.js';
import { resolveChannel, createSubscriptionManager } from './subscriptionManager.js';

dotenv.config();

const WS_PORT = process.env.WS_PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const LIVE_PREFIX = process.env.LIVE_PREFIX || "live";
const BACKTEST_PREFIX = process.env.BACKTEST_PREFIX || "backtest";

let wss;
let redisPubSub;

// Message handler for fanout
function handleRedisMessage(channel, message) {
  fanoutRedisMessage(subManager.channelSubscriptions, subManager.sockets, channel, message);
}

const subManager = createSubscriptionManager({
  onChannelNeeded: async (channel) => {
    try {
      await redisPubSub.subscribe(channel, handleRedisMessage);
    } catch (err) {
      logger.error(`Failed to subscribe to ${channel}:`, err);
    }
  },
  onChannelUnused: async (channel) => {
    try {
      await redisPubSub.unsubscribe(channel);
    } catch (err) {
      logger.error(`Failed to unsubscribe from ${channel}:`, err);
    }
  },
});

function attachConnectionHandlers(server) {
  server.on("connection", (ws) => {
    const socketId = uuid();
    subManager.addClient(socketId, ws);

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const channel = resolveChannel(msg, LIVE_PREFIX, BACKTEST_PREFIX);
        if (!channel) {
          logger.warn("Invalid message format:", msg);
          return;
        }

        if (msg.action === "subscribe") {
          await subManager.subscribe(socketId, channel);
        } else if (msg.action === "unsubscribe") {
          await subManager.unsubscribe(socketId, channel);
        }
      } catch (err) {
        logger.error("Error processing message:", err);
      }
    });

    ws.on("close", async () => {
      await subManager.removeClient(socketId);
    });
  });
}

// Initialize Redis connection and bind the WS port only when starting.
async function startServer() {
  try {
    await initLogger();
    redisPubSub = new RedisPubSub({ url: REDIS_URL });
    wss = new WebSocketServer({ port: WS_PORT });
    attachConnectionHandlers(wss);
    await redisPubSub.connect();
    logger.info(`Ultra-low latency WS server running on port ${WS_PORT}`);
    logger.info(`Connected to Redis: ${REDIS_URL}`);
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");
  if (redisPubSub) {
    await redisPubSub.disconnect();
  }
  if (wss) {
    wss.close();
  }
  process.exit(0);
});

if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test_env') {
  startServer();
}
export { startServer, handleRedisMessage };
