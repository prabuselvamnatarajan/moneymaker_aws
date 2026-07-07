import WebSocket from 'ws';
import { Kafka } from 'kafkajs';
import protobuf from 'protobufjs';
import { createClient } from 'redis';

// Initialize global variables
let protobufRoot = null;
let activeWS = null;
const activeSymbols = new Set();
let redisSubscriber = null;

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

function subscribeSymbols(symbolInput) {
  if (!activeWS || activeWS.readyState !== WebSocket.OPEN) {
    console.warn('[WS Upstox] Cannot subscribe: Upstox WebSocket is not open.');
    return;
  }
  const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
  if (symbolArray.length === 0) return;

  const toSubscribe = [];
  for (const s of symbolArray) {
    if (s && !activeSymbols.has(s)) {
      activeSymbols.add(s);
      toSubscribe.push(s);
    }
  }

  if (toSubscribe.length === 0) {
    console.log('[WS Upstox] Symbols already subscribed:', symbolArray);
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
}

function unsubscribeSymbols(symbolInput) {
  if (!activeWS || activeWS.readyState !== WebSocket.OPEN) {
    console.warn('[WS Upstox] Cannot unsubscribe: Upstox WebSocket is not open.');
    return;
  }
  const symbolArray = Array.isArray(symbolInput) ? symbolInput : [symbolInput];
  if (symbolArray.length === 0) return;

  const toUnsubscribe = [];
  for (const s of symbolArray) {
    if (s && activeSymbols.has(s)) {
      activeSymbols.delete(s);
      toUnsubscribe.push(s);
    }
  }

  if (toUnsubscribe.length === 0) {
    console.log('[WS Upstox] Symbols are not subscribed:', symbolArray);
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

    await redisSubscriber.subscribe('symbol_updates', (message) => {
      try {
        const payload = JSON.parse(message);
        console.log('[WS Upstox Redis Sub] Received update:', payload);
        const { action, instrument_token, old_instrument_token } = payload;

        if (action === 'subscribe' && instrument_token) {
          subscribeSymbols([instrument_token]);
        } else if (action === 'unsubscribe' && instrument_token) {
          unsubscribeSymbols([instrument_token]);
        } else if (action === 'update') {
          if (old_instrument_token) {
            unsubscribeSymbols([old_instrument_token]);
          }
          if (instrument_token) {
            subscribeSymbols([instrument_token]);
          }
        }
      } catch (err) {
        console.error('[WS Upstox Redis Sub] Error processing event message:', err);
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
        Authorization: `Bearer  ${access_token}`,
      },
      followRedirects: true,
    });

    console.log('Redirection detected: ' + ws);
    activeWS = ws;
    connectWebSocket({ ws, symbol });

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
      console.log(symbol);
      resolve(ws); // Resolve the promise once connected

      // Set a timeout to send a subscription message after 1 second
      setTimeout(() => {
        subscribeSymbols(symbol);
      }, 1000);
    });

    ws.on("close", () => {
      console.log("disconnected");
      if (activeWS === ws) {
        activeWS = null;
        activeSymbols.clear();
      }
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
      console.log("error:", error);
      if (activeWS === ws) {
        activeWS = null;
        activeSymbols.clear();
      }
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

