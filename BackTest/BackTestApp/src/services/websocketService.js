import { WebSocketServer } from 'ws';
import { parse } from 'url';
import crypto from 'crypto';
import * as jwtService from "../iam/utils/jwtService.js";
import * as authService from "../iam/services/authService.js";
import Session from "../iam/models/session.js";
import UserSymbol from "../models/userSymbol.js";
import { Kafka } from 'kafkajs';
import { createClient } from 'redis';

let wss;
const activeSockets = new Map(); // socketId -> { ws, userId, subscribedTokens: Set }

let redisClient = null;
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  redisClient = createClient({ url: redisUrl });
  redisClient.connect().catch(err => console.error("Failed to connect Redis in WebSocket service:", err));
}

function tokenMatchesSubscription(subscribedTokens, instrumentToken) {
  if (subscribedTokens.has(instrumentToken)) return true;

  const suffix = instrumentToken.includes('|')
    ? instrumentToken.split('|')[1]
    : instrumentToken;
  if (subscribedTokens.has(suffix)) return true;

  for (const token of subscribedTokens) {
    if (!token) continue;
    if (token === instrumentToken) return true;
    const tokenSuffix = token.includes('|') ? token.split('|')[1] : token;
    const tokenPrefix = token.includes('|') ? token.split('|')[0] : null;
    const msgPrefix = instrumentToken.includes('|') ? instrumentToken.split('|')[0] : null;
    if (tokenPrefix && msgPrefix) {
      if (tokenPrefix === msgPrefix && tokenSuffix === suffix) return true;
    } else if (tokenSuffix === suffix) {
      return true;
    }
  }
  return false;
}

async function refreshUserSubscriptions(userId) {
  try {
    // ⚡ Bolt Optimization: Added .lean() to high-frequency polling query
    const symbolsList = await UserSymbol.find({ user_id: userId, is_active: true }).lean();
    const tokens = new Set(symbolsList.map((s) => s.instrument_token));
    for (const [, client] of activeSockets.entries()) {
      if (client.userId === userId) {
        client.subscribedTokens = tokens;
      }
    }
  } catch (err) {
    console.error(`[WS] Failed to refresh subscriptions for user ${userId}:`, err.message);
  }
}

export function initWebSocketServer(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const { pathname, query } = parse(request.url, true);

    if (pathname === '/ws') {
      const token = query.token;
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const payload = jwtService.verifyAccessToken(token);
        const session = await Session.findOne({ _id: payload.sessionID, active: true });
        if (!session) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const user = await authService.findUserById(payload.userId);
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, user._id.toString());
        });
      } catch (err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, request, userId) => {
    const socketId = Math.random().toString(36).substring(2, 15);
    console.log(`[WS] Client connected: ${socketId} (User: ${userId})`);

    const fetchUserSymbols = async () => {
      try {
        // ⚡ Bolt Optimization: Added .lean() to high-frequency polling query
        const symbolsList = await UserSymbol.find({ user_id: userId, is_active: true }).lean();
        const tokens = new Set(symbolsList.map(s => s.instrument_token));
        return tokens;
      } catch (err) {
        console.error(`[WS] Error fetching symbols for user ${userId}:`, err);
        return new Set();
      }
    };

    let subscribedTokens = await fetchUserSymbols();

    activeSockets.set(socketId, {
      ws,
      userId,
      subscribedTokens
    });

    const intervalId = setInterval(async () => {
      if (ws.readyState === ws.OPEN) {
        const refreshedTokens = await fetchUserSymbols();
        const client = activeSockets.get(socketId);
        if (client) {
          client.subscribedTokens = refreshedTokens;
        }
      }
    }, 10000);

    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${socketId}`);
      clearInterval(intervalId);
      activeSockets.delete(socketId);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error on client ${socketId}:`, err);
    });
  });

  initKafkaConsumer().catch(err => {
    console.error("Failed to initialize Kafka Consumer for WebSocket Service:", err);
  });

  initRedisSubscriber().catch(err => {
    console.error("Failed to initialize Redis Subscriber for WebSocket Service:", err);
  });
}

let redisSubscriber = null;

async function initRedisSubscriber() {
  if (!redisUrl) return;

  redisSubscriber = createClient({ url: redisUrl });
  redisSubscriber.on('error', (err) => console.error('WS Redis Subscriber Client Error', err));

  await redisSubscriber.connect();
  console.log("✅ WebSocket service connected to Redis subscriber channel");

  await redisSubscriber.subscribe('broker_updates', (message) => {
    try {
      const payload = JSON.parse(message);
      console.log("[WS Redis Sub] Received broker update:", payload);

      const { userId, event, brokerId } = payload;
      if (event === 'broker_updated') {
        const outboundMsg = JSON.stringify({
          event: 'broker_updated',
          userId,
          brokerId,
          timestamp: Date.now()
        });

        for (const [socketId, client] of activeSockets.entries()) {
          if (client.userId === userId) {
            if (client.ws.readyState === client.ws.OPEN) {
              console.log(`[WS Redis Sub] Broadcasting broker update to socket ${socketId} of user ${userId}`);
              client.ws.send(outboundMsg);
            }
          }
        }
      }
    } catch (err) {
      console.error("[WS Redis Sub] Error parsing Redis subscription message:", err);
    }
  });

  await redisSubscriber.subscribe('symbol_updates', (message) => {
    try {
      const payload = JSON.parse(message);
      const { userId, action } = payload;
      if (!userId || !action) return;
      if (action === 'subscribe' || action === 'unsubscribe' || action === 'update') {
        refreshUserSubscriptions(userId).catch((err) => {
          console.error(`[WS Redis Sub] symbol_updates refresh failed for ${userId}:`, err.message);
        });
      }
    } catch (err) {
      console.error("[WS Redis Sub] Error parsing symbol_updates message:", err);
    }
  });
}

function extractLtp(feed) {
  if (feed.ltpc && feed.ltpc.ltp !== undefined) {
    return feed.ltpc.ltp;
  }
  if (feed.fullFeed) {
    const ff = feed.fullFeed.marketFF || feed.fullFeed.indexFF;
    if (ff && ff.ltpc && ff.ltpc.ltp !== undefined) {
      return ff.ltpc.ltp;
    }
  }
  if (feed.firstLevelWithGreeks && feed.firstLevelWithGreeks.ltpc && feed.firstLevelWithGreeks.ltpc.ltp !== undefined) {
    return feed.firstLevelWithGreeks.ltpc.ltp;
  }
  return null;
}

function extractLtpc(feed) {
  if (feed.ltpc) return feed.ltpc;
  if (feed.fullFeed) {
    const ff = feed.fullFeed.marketFF || feed.fullFeed.indexFF;
    if (ff && ff.ltpc) return ff.ltpc;
  }
  if (feed.firstLevelWithGreeks && feed.firstLevelWithGreeks.ltpc) {
    return feed.firstLevelWithGreeks.ltpc;
  }
  return null;
}

function extractVolume(feed) {
  if (feed.fullFeed && feed.fullFeed.marketFF && feed.fullFeed.marketFF.vtt != null) {
    return Number(feed.fullFeed.marketFF.vtt);
  }
  if (feed.firstLevelWithGreeks && feed.firstLevelWithGreeks.vtt != null) {
    return Number(feed.firstLevelWithGreeks.vtt);
  }
  if (feed.vtt != null) {
    return Number(feed.vtt);
  }
  return null;
}

/** Extract LTP, session change %, and volume-traded-today from an Upstox feed tick. */
function extractMarketMetrics(feed) {
  const ltp = extractLtp(feed);
  if (ltp === null) return null;

  const ltpc = extractLtpc(feed);
  const cp = ltpc && ltpc.cp != null ? Number(ltpc.cp) : null;
  let changePct = null;
  if (cp != null && cp > 0) {
    changePct = ((ltp - cp) / cp) * 100;
  }

  const volume = extractVolume(feed);

  return {
    last_price: ltp,
    prev_close: cp,
    change_pct: changePct,
    volume: volume != null && !Number.isNaN(volume) ? volume : null,
  };
}

async function initKafkaConsumer() {
  const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka-broker-1:9092,kafka-broker-2:9092,kafka-broker-3:9092').split(',');
  const consumerGroupId = `backtest-app-ws-${crypto.randomUUID()}`;

  const kafka = new Kafka({
    clientId: 'backtest-app',
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 300,
      retries: 20
    }
  });

  const consumer = kafka.consumer({ groupId: consumerGroupId, sessionTimeout: 30000 });
  await consumer.connect();
  await consumer.subscribe({ topic: 'splited-live-data', fromBeginning: false });
  await consumer.subscribe({ topic: 'backtest-stream-data', fromBeginning: false });

  console.log(`[Kafka WS Consumer] Subscribed to splited-live-data and backtest-stream-data (Group: ${consumerGroupId})`);

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        if (!message.key || !message.value) return;
        const instrumentToken = message.key.toString();
        const data = JSON.parse(message.value.toString());

        const metrics = extractMarketMetrics(data);
        if (metrics === null) return;

        const outboundPayload = {
          instrument_token: instrumentToken,
          last_price: metrics.last_price,
          timestamp: Date.now()
        };
        if (metrics.change_pct != null) {
          outboundPayload.change_pct = metrics.change_pct;
        }
        if (metrics.volume != null) {
          outboundPayload.volume = metrics.volume;
        }
        const outboundMsg = JSON.stringify(outboundPayload);

        const cleanToken = instrumentToken.includes('|') ? instrumentToken.split('|')[1] : instrumentToken;

        for (const [socketId, client] of activeSockets.entries()) {
          if (tokenMatchesSubscription(client.subscribedTokens, instrumentToken)) {
            if (client.ws.readyState === client.ws.OPEN) {
              client.ws.send(outboundMsg);
            }
          }
        }

        if (topic === 'backtest-stream-data' && redisClient && redisClient.isOpen) {
          const channels = [
            `backtest:${cleanToken}`,
            `backtest:${instrumentToken}`
          ];
          for (const channel of channels) {
            await redisClient.publish(channel, outboundMsg);
          }
        }
      } catch (err) {
        console.error("[Kafka WS Consumer] Error processing message:", err);
      }
    }
  });
}
