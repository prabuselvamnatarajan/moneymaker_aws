const axios = require('axios');
const WebSocket = require('ws');
const { Kafka } = require('kafkajs');
const protobuf = require("protobufjs");


// Initialize global variables
let protobufRoot = null;

let apiVersion = "2.0";
const kafkaBrokers = process.env.KAFKA_BROKERS || 'localhost:9092'; // Use environment variable for Kafka broker address

async function get_WS_URL({ access_token, symbol = [] }) {
  try {
    await initProtobuf();
    const response = await axios.get('https://api.upstox.com/v2/feed/market-data-feed', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': '*/*'
      },
      maxRedirects: 0,
    });

    // This should not happen if a 302 redirect occurs, but in case it does:
    console.log('Redirection detected: ' + response);

  } catch (error) {
    if (error.response && error.response.status === 302) {
      const redirectUrl = error.response.headers.location;

      connectWebSocket({ wsUrl: redirectUrl, accessToken: access_token, symbol })

    } else {
      console.error('Error during WebSocket connection setup:', error.message);
    }
  }
}




const connectWebSocket = async ({ wsUrl, accessToken, symbol = [] }) => {
  const kafka = new Kafka({ clientId: 'stock-app', brokers: [kafkaBrokers] });
  const producer = kafka.producer();

  try {
    console.log(`Connecting to Kafka broker at ${kafkaBrokers}...`);
    await producer.connect();
    console.log('Connected to Kafka broker successfully.');
  } catch (error) {
    console.error('Failed to connect to Kafka broker:', error.message);
    console.error('Ensure the Kafka broker is accessible and the address is correct.');
    return; // Exit if Kafka connection fails
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        "Api-Version": apiVersion,
        Authorization: `Bearer  ${accessToken}`,
      },
      followRedirects: true,
    });

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
  protobufRoot = await protobuf.load(__dirname + "/MarketDataFeed.proto");
};

const decodeProfobuf = async (buffer) => {
  if (!protobufRoot) {
    console.warn("Protobuf part not initialized yet!");
    return null;
  }

  const FeedResponse = protobufRoot.lookupType(
    "com.upstox.marketdatafeeder.rpc.proto.FeedResponse"
  );
  return FeedResponse.decode(buffer);
};




module.exports = {
  get_WS_URL
};
