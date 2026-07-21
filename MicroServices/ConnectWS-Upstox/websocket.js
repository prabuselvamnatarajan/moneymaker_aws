import WebSocket from 'ws';
import { Kafka } from 'kafkajs';
import protobuf from 'protobufjs';
import { createClient } from 'redis';
import { getAccessTokenFromRedis, getOrgAccessTokenFromRedis } from './redis_utils/AuthoriseUpstoxClient.js';

// Initialize global variables
let protobufRoot = null;
let activeWS = null;
const activeSymbols = new Set();
const subscribedSymbols = new Set();
let redisSubscriber = null;
let connectionPromise = null;

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

let reconnectAttempt = 0;
let reconnectTimer = null;
const MAX_RECONNECT_DELAY_MS = 60000;

function scheduleReconnect(reason) {
  if (activeSymbols.size === 0) {
    return;
  }
  if (reconnectTimer) {
    return;
  }

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  console.log(`[WS Upstox] Scheduling reconnect in ${delay}ms (${reason}). Active symbols: ${activeSymbols.size}`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await ensureWSConnection();
    } catch (err) {
      console.error('[WS Upstox] Reconnect attempt failed:', err.message);
      scheduleReconnect('retry_after_failure');
    }
  }, delay);
}

async function ensureWSConnection() {
  if (activeWS && (activeWS.readyState === WebSocket.OPEN || activeWS.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    try {
      console.log(`[WS Upstox] Auto-initiating new WebSocket market data connection using Org/Admin access token...`);
      const access_token = await getOrgAccessTokenFromRedis();
      if (!access_token) {
        console.warn(`[WS Upstox] Cannot initiate connection: Org/Admin Upstox access token missing or expired — re-authenticate admin via Brokers page.`);
        return;
      }
      await get_WS_URL({ access_token });
    } catch (err) {
      console.error('[WS Upstox] Error auto-initiating WebSocket connection:', err);
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

function subscribeSymbols(symbolInput, userId = '') {
  const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
  if (symbolArray.length === 0) return;

  // Add to the list of symbols we expect to be subscribed to
  for (const s of symbolArray) {
    if (s) activeSymbols.add(s);
  }

  if (activeWS && activeWS.readyState === WebSocket.OPEN) {
    const toSubscribe = [];
    for (const s of symbolArray) {
      if (s && !subscribedSymbols.has(s)) {
        subscribedSymbols.add(s);
        toSubscribe.push(s);
      }
    }

    if (toSubscribe.length === 0) {
      console.log('[WS Upstox] Symbols already subscribed on active WS:', symbolArray);
      return;
    }

    console.log('[WS Upstox] Subscribing to symbols:', toSubscribe);
    const data = {
      guid: "someguid",
      method: "sub",
      data: {
        mode: "full",
        instrumentKeys: toSubscribe
      },
    };
    const content = Buffer.from(JSON.stringify(data));
    activeWS.send(content);
  } else {
    console.log('[WS Upstox] WebSocket not open. Added symbols to active/pending list:', symbolArray);
    ensureWSConnection().catch((err) => {
      console.error('[WS Upstox] Failed auto-connection trigger:', err);
    });
  }
}

function unsubscribeSymbols(symbolInput) {
  const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
  if (symbolArray.length === 0) return;

  // Remove from the list of symbols we expect to be subscribed to
  for (const s of symbolArray) {
    if (s) activeSymbols.delete(s);
  }

  if (activeWS && activeWS.readyState === WebSocket.OPEN) {
    const toUnsubscribe = [];
    for (const s of symbolArray) {
      if (s && subscribedSymbols.has(s)) {
        subscribedSymbols.delete(s);
        toUnsubscribe.push(s);
      }
    }

    if (toUnsubscribe.length === 0) {
      console.log('[WS Upstox] Symbols are not currently subscribed on active WS:', symbolArray);
      return;
    }

    console.log('[WS Upstox] Unsubscribing from symbols:', toUnsubscribe);
    const data = {
      guid: "someguid",
      method: "unsub",
      data: {
        instrumentKeys: toUnsubscribe
      },
    };
    const content = Buffer.from(JSON.stringify(data));
    activeWS.send(content);
  } else {
    for (const s of symbolArray) {
      if (s) subscribedSymbols.delete(s);
    }
    console.log('[WS Upstox] WebSocket not open. Removed symbols from active/pending list:', symbolArray);
  }
}

async function initRedisSubscriber() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[WS Upstox] REDIS_URL not set, skipping Redis subscriber initialization.');
    return;
  }

  if (redisSubscriber) return;

  try {
    redisSubscriber = createClient({ url: redisUrl });
    redisSubscriber.on('error', (err) => console.error('[WS Upstox Redis Sub] Error:', err));
    await redisSubscriber.connect();
    console.log('✅ ConnectWS-Upstox connected to Redis subscriber for symbol_updates');

    // Auto-subscribe to symbols of already running deployments & active symbols on startup
    try {
      const tempClient = createClient({ url: redisUrl });
      await tempClient.connect();
      
      const keys = await tempClient.keys('strategies:live:*');
      const deploymentSymbols = keys && keys.length > 0 
        ? keys.map(key => key.replace('strategies:live:', '')) 
        : [];
      
      let activeSymbolsList = [];
      try {
        activeSymbolsList = await tempClient.sMembers('symbols:active');
      } catch (err) {
        console.warn('[WS Upstox] Could not fetch symbols:active set:', err.message);
      }

      const allStartupSymbols = Array.from(new Set([...deploymentSymbols, ...activeSymbolsList]));

      if (allStartupSymbols.length > 0) {
        console.log('[WS Upstox] Auto-subscribing on startup to running deployment & active symbols:', allStartupSymbols);
        subscribeSymbols(allStartupSymbols);
      }
      await tempClient.disconnect();
    } catch (err) {
      console.error('[WS Upstox] Failed to load active symbols from Redis on startup:', err.message);
    }

    await redisSubscriber.subscribe('symbol_updates', (message) => {
      try {
        const payload = JSON.parse(message);
        console.log('[WS Upstox Redis Sub] Received update:', payload);
        const { action, instrument_token, old_instrument_token, userId } = payload;

        if (action === 'subscribe' && instrument_token) {
          subscribeSymbols([instrument_token], userId);
        } else if (action === 'unsubscribe' && instrument_token) {
          unsubscribeSymbols([instrument_token]);
        } else if (action === 'update') {
          if (old_instrument_token) {
            unsubscribeSymbols([old_instrument_token]);
          }
          if (instrument_token) {
            subscribeSymbols([instrument_token], userId);
          }
        }
      } catch (err) {
        console.error('[WS Upstox Redis Sub] Error processing event message:', err);
      }
    });

    await redisSubscriber.subscribe('broker_updates', async (message) => {
      try {
        const payload = JSON.parse(message);
        console.log('[WS Upstox Redis Sub] Received broker_update event:', payload);
        if (!activeWS || activeWS.readyState !== WebSocket.OPEN) {
          console.log('[WS Upstox] Broker update received & WS connection not open. Auto-initiating connection...');
          await ensureWSConnection();
        }
      } catch (err) {
        console.error('[WS Upstox Redis Sub] Error processing broker_update message:', err);
      }
    });
  } catch (err) {
    console.error('[WS Upstox Redis Sub] Failed to connect:', err);
  }
}

async function get_WS_URL({ access_token, symbol = [] }) {
  try {
    await initProtobuf();
    const initUrl = 'wss://api.upstox.com/v3/feed/market-data-feed';

    if (activeWS && (activeWS.readyState === WebSocket.OPEN || activeWS.readyState === WebSocket.CONNECTING)) {
      console.log('[WS Upstox] Reusing established WebSocket connection. Subscribing to:', symbol);
      subscribeSymbols(symbol);
      return;
    }

    const ws = new WebSocket(initUrl, {
      headers: {
        "Accept": "*/*",
        Authorization: `Bearer ${access_token}`,
      },
      followRedirects: true,
    });

    console.log('[WS Upstox] Initiating WebSocket connection to Upstox feed');
    activeWS = ws;
    connectWebSocket({ ws, symbol }).catch((err) => {
      const message = err.message || String(err);
      if (message.includes('401')) {
        console.error('[WS Upstox] Connection error: Upstox access token missing or expired — re-authenticate via Brokers page.');
      } else {
        console.error('[WS Upstox] Connection error in connectWebSocket:', message);
      }
    });

  } catch (error) {
    console.error('Error during WebSocket connection setup:', error.message);
  }
}

const connectWebSocket = async ({ ws, symbol = [] }) => {
  const kafka = new Kafka({
    clientId: 'stock-app',
    brokers: KAFKA_BROKERS,
    retry: {
      initialRetryTime: 300,
      retries: 20
    }
  });
  const producer = kafka.producer();

  try {
    console.log(`Connecting to Kafka broker at ${KAFKA_BROKERS}...`);
    await producer.connect();
    console.log('Connected to Kafka broker successfully.');
  } catch (error) {
    console.error('Failed to connect to Kafka broker:', error.message);
    console.error('Ensure the Kafka broker is accessible and the address is correct.');
    return; // Exit if Kafka connection fails
  }

  return new Promise((resolve, reject) => {

    // WebSocket event handlers
    ws.on("open", () => {
      console.log("connected");
      reconnectAttempt = 0;
      console.log(symbol);
      resolve(ws); // Resolve the promise once connected

      // Set a timeout to send a subscription message after 1 second
      setTimeout(() => {
        // Merge the requested `symbol` into activeSymbols
        const symbolArray = Array.isArray(symbol) ? symbol : [symbol];
        for (const s of symbolArray) {
          if (s) activeSymbols.add(s);
        }

        // Subscribe to ALL symbols in activeSymbols that are not yet subscribed on this WS connection
        if (activeSymbols.size > 0) {
          const toSubscribe = [];
          for (const s of activeSymbols) {
            if (s && !subscribedSymbols.has(s)) {
              subscribedSymbols.add(s);
              toSubscribe.push(s);
            }
          }

          if (toSubscribe.length > 0) {
            console.log('[WS Upstox] WebSocket opened. Subscribing to active symbols:', toSubscribe);
            const data = {
              guid: "someguid",
              method: "sub",
              data: {
                mode: "full",
                instrumentKeys: toSubscribe
              },
            };
            const content = Buffer.from(JSON.stringify(data));
            ws.send(content);
          } else {
            console.log('[WS Upstox] WebSocket opened. All active symbols already subscribed.');
          }
        } else {
          console.log('[WS Upstox] WebSocket opened. No symbols to subscribe.');
        }
      }, 1000);
    });

    ws.on("close", () => {
      console.log("disconnected");
      if (activeWS === ws) {
        activeWS = null;
        subscribedSymbols.clear();
      }
      scheduleReconnect('connection_closed');
    });

    ws.on("message", async (data) => {
      let decodedRes = await decodeProfobuf(data);
      let decodedData = JSON.stringify(decodedRes);
      decodedData = JSON.parse(decodedData);

      if (decodedData && decodedData.feeds) {
        let msg = JSON.stringify(decodedData.feeds);
        console.log(`Processing ${msg}`);
        await producer.send({
          topic: 'incoming-ws-msg',
          messages: [{ key: 'uplink_ws_data', value: JSON.stringify(decodedData.feeds) || '' }],
        });
      }

    });

    ws.on("error", (error) => {
      const message = error.message || String(error);
      if (message.includes('401')) {
        console.error('[WS Upstox] Upstox access token missing or expired — re-authenticate via Brokers page.');
      } else {
        console.log("error:", error);
      }
      if (activeWS === ws) {
        activeWS = null;
        subscribedSymbols.clear();
      }
      scheduleReconnect('connection_error');
      reject(error);
    });
  });
};

const initProtobuf = async () => {
  protobufRoot = await protobuf.load("./MarketDataFeed.proto");
};

const decodeProfobuf = async (buffer) => {
  if (!protobufRoot) {
    console.warn("Protobuf part not initialized yet!");
    return null;
  }

  const FeedResponse = protobufRoot.lookupType(
    "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse"
  );
  return FeedResponse.decode(buffer);
};


export {
  get_WS_URL,
  initRedisSubscriber
};

