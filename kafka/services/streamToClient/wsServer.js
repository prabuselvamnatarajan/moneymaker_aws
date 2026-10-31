import { WebSocketServer } from 'ws';
import { v4 as uuid } from "uuid";
import RedisPubSub from "./redis_utils/redis_operations/RedisPubSub.js";
import dotenv from "dotenv";
import { initLogger, logger } from '/app/utils/logUtils.js';
import { fanoutRedisMessage } from './fanout.js';

dotenv.config();

const WS_PORT = process.env.WS_PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const LIVE_PREFIX = process.env.LIVE_PREFIX || "live";
const BACKTEST_PREFIX = process.env.BACKTEST_PREFIX || "backtest";

let wss;
let redisPubSub;

// Local memory (SAFE for scaling)
// socketId -> ws
const sockets = new Map();

// socketId -> Set<channel>
const socketSubscriptions = new Map();

// channel -> Set<socketId>
const channelSubscriptions = new Map();

// Single unified message handler for all channels
function handleRedisMessage(channel, message) {
  fanoutRedisMessage(channelSubscriptions, sockets, channel, message);
}

async function ensureChannel(channel) {
  if (!channelSubscriptions.has(channel)) {
    channelSubscriptions.set(channel, new Set());
    try {
      // Subscribe with the message handler for this channel
      await redisPubSub.subscribe(channel, handleRedisMessage);
    } catch (err) {
      logger.error(`Failed to subscribe to ${channel}:`, err);
    }
  }
}

async function removeChannelIfUnused(channel) {
  if (channelSubscriptions.get(channel)?.size === 0) {
    channelSubscriptions.delete(channel);
    try {
      await redisPubSub.unsubscribe(channel);
    } catch (err) {
      logger.error(`Failed to unsubscribe from ${channel}:`, err);
    }
  }
}

function attachConnectionHandlers(server) {
  server.on("connection", (ws) => {
    const socketId = uuid();
    sockets.set(socketId, ws);
    socketSubscriptions.set(socketId, new Set());

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!msg.action || !msg.mode || !msg.symbol) {
            logger.warn("Invalid message format:", msg);
            return;
        }

        let mode = BACKTEST_PREFIX;
        if (msg.mode === 'live') {
          mode = LIVE_PREFIX;
        }

        const channel = `${mode}:${msg.symbol}`;

        if (msg.action === "subscribe") {
          await ensureChannel(channel);
          channelSubscriptions.get(channel).add(socketId);
          socketSubscriptions.get(socketId).add(channel);
        }

        if (msg.action === "unsubscribe") {
          channelSubscriptions.get(channel)?.delete(socketId);
          socketSubscriptions.get(socketId)?.delete(channel);
          await removeChannelIfUnused(channel);
        }
      } catch (err) {
        logger.error("Error processing message:", err);
      }
    });

    ws.on("close", async () => {
      const channels = socketSubscriptions.get(socketId) || [];
      for (const ch of channels) {
        channelSubscriptions.get(ch)?.delete(socketId);
        await removeChannelIfUnused(ch);
      }
      socketSubscriptions.delete(socketId);
      sockets.delete(socketId);
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
