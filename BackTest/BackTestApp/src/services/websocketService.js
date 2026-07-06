import { WebSocketServer } from 'ws';
import { parse } from 'url';
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
        const symbolsList = await UserSymbol.find({ user_id: userId, is_active: true });
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

async function initKafkaConsumer() {
  const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka-broker-1:9092,kafka-broker-2:9092,kafka-broker-3:9092').split(',');
  const consumerGroupId = `backtest-app-ws-${Math.random().toString(36).substring(2, 10)}`;

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

        const ltp = extractLtp(data);
        if (ltp === null) return;

        const outboundMsg = JSON.stringify({
          instrument_token: instrumentToken,
          last_price: ltp,
          timestamp: Date.now()
        });

        const cleanToken = instrumentToken.includes('|') ? instrumentToken.split('|')[1] : instrumentToken;

        for (const [socketId, client] of activeSockets.entries()) {
          if (client.subscribedTokens.has(instrumentToken) || client.subscribedTokens.has(cleanToken)) {
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
