import WebSocket from 'ws';
import { Kafka } from 'kafkajs';
import protobuf from 'protobufjs';

// Initialize global variables
let protobufRoot = null;

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

async function get_WS_URL({ access_token, symbol = [] }) {
  try {
    await initProtobuf();
    const initUrl = 'wss://api.upstox.com/v3/feed/market-data-feed';
    const ws = new WebSocket(initUrl, {
      headers: {
        "Accept": "*/*",
        Authorization: `Bearer  ${access_token}`,
      },
      followRedirects: true,
    });

    console.log('Redirection detected: ' + ws);
    connectWebSocket({ ws, symbol })

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
        const data = {
          guid: "someguid",
          method: "sub",
          data: {
            mode: "full",
            instrumentKeys: symbol//["MCX_FO|437992"]//["NSE_EQ|KARURVYSYA"] //["NSE_INDEX|Nifty Bank", "NSE_INDEX|Nifty 50"],
          },
        };
        let content = Buffer.from(JSON.stringify(data));
        ws.send(content);
      }, 1000);
    });

    ws.on("close", () => {
      console.log("disconnected");
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
  get_WS_URL
};
