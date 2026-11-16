# MoneyMaker — System Architecture & Technical Specification

This document provides a comprehensive technical reference for the **MoneyMaker Algo Trading Platform**, describing its distributed microservices architecture, centralized timeframe processing framework, Kafka partition routing, multi-tenant state management, and real-time execution guarantees.

---

## 1. System Topology & Architecture Overview

MoneyMaker is an event-driven algorithmic trading and backtesting engine for high-volume Indian equity and derivative instruments (NSE/NFO).

```mermaid
flowchart TD
    subgraph VENDOR ["1. External Broker Ingestion"]
        V_WS["Upstox WebSocket API\n(Protobuf Binary Feed)"] --> C_WS["ConnectWS-Upstox\n(WebSocket Client Gateway)"]
        C_WS -->|Protobuf Decoded Batch| K_INC[("Kafka: incoming-ws-msg\n(50 Partitions)")]
        K_INC --> W_SPLIT["wsDataSplitterConsumer\n(3 Replicas)"]
    end

    subgraph HISTORICAL ["2. Historical Backtest Feed"]
        BT_STREAM["BacktestStreamer\n(Historical Tick Generator)"] --> BT_CLI["BacktestClient\n(Tick Streamer Client)"]
        BT_CLI -->|Chronological Tick Stream| K_BT_STREAM[("Kafka: backtest-stream-data\n(50 Partitions)")]
    end

    subgraph BUS ["3. Normalized Tick Stream"]
        W_SPLIT -->|Keyed by Symbol| K_SPLIT[("Kafka: splited-live-data\n(50 Partitions)")]
        W_SPLIT -->|Pub/Sub live:symbol| R_LIVE[("Redis Pub/Sub\nlive:symbol")]
    end

    subgraph TIMEFRAME_LAYER ["4. Centralized Timeframe Constructor Microservice"]
        K_SPLIT -->|Live Ticks| TC_IN["Tick Consumer\n(Keyed Partition Assignment)"]
        K_BT_STREAM -->|Backtest Ticks| TC_IN
        TC_IN --> TC_STATE["Symbol State Manager\n(Isolated In-Memory State)"]
        TC_STATE --> TC_CANDLE["Candle Aggregator\n(1m, 3m, 5m, 15m OHLCV)"]
        TC_CANDLE --> TC_SNAP["Snapshot Generator\n(Combined Multi-TF Payload)"]
        TC_SNAP --> TC_PROD["Timeframe Producer"]
        TC_PROD -->|Key: Symbol| K_TF_LIVE[("Kafka: timeframe_live_data\n(50 Partitions)")]
        TC_PROD -->|Key: Symbol| K_TF_BT[("Kafka: timeframe_backtest_data\n(50 Partitions)")]
        TC_STATE <-->|Periodic Checkpoint / Recovery| R_TF_STATE[("Redis: timeframe_state:symbol")]
    end

    subgraph AUXILIARY ["5. Auxiliary Consumers"]
        K_SPLIT --> POS_TRACK["position-tracker-consumer\n(MTM & Price Excursions)"]
        K_SPLIT --> SYM_RESOLV["deployment-symbol-resolver-consumer\n(Dynamic Strike Tracking)"]
        K_SPLIT --> PRICE_STORE["price-storer-consumer\n(Raw Tick Archival)"]
        POS_TRACK --> MONGO_DB[("MongoDB Replica Set")]
        SYM_RESOLV --> BT_APP["BackTestApp API"]
        PRICE_STORE --> MONGO_DB
    end

    subgraph ROUTING ["6. Dynamic Multi-Tenant Strategy Chooser"]
        K_SPLIT -->|Mode: tick| SC["StrategyChooserConsumer\n(3 Replicas)"]
        K_BT_STREAM -->|Mode: tick| SC
        K_TF_LIVE -->|Mode: timeframe / hybrid| SC
        K_TF_BT -->|Mode: timeframe / hybrid| SC
        MONGO_DB -->|Deployments Sync| R_DEP[("Redis Cache\nstrategies:live / strategies:backtest")]
        R_DEP -->|Active Deployments & Configs| SC
        SC -->|Sliced Snapshot per Deployment| K_STRAT[("Kafka Strategy Topics\nmsb_live_data / msb_pts_live_data / liquidity_sweep_live_data")]
    end

    subgraph STRATEGIES ["7. Strategy Engines (Decoupled Alpha)"]
        K_STRAT --> SE["Strategy Engine\n(MSB / msb_pts / LiquiditySweep)"]
        SE -->|Real-time Every Tick LTP| RISK["Position Risk Check\n(Target / Stop-Loss Exit)"]
        SE -->|Closed Candle Rollover| SIGNAL["Structure Breakout Check\n(MSB Swing Evaluation)"]
        RISK -->|Trigger Order| PO["placeorder API"]
        SIGNAL -->|Trigger Order| PO
    end

    subgraph EXECUTION ["8. Order Execution & Audit Ledger"]
        PO -->|Live Mode| BROKER_API["Upstox REST API\n(Live Broker)"]
        PO -->|Backtest / Paper Mode| BT_APP
        PO -->|Order Event| K_ORD[("Kafka: order_details\n(50 Partitions)")]
        K_ORD --> ORD_STORE["order-storer-consumer\n(3 Replicas)"]
        ORD_STORE --> MONGO_DB
        BT_APP --> MONGO_DB
    end

    subgraph UI ["9. Web Dashboard & Visualization"]
        R_LIVE --> STREAM_CLI["stream-to-client\n(WebSocket Server)"]
        STREAM_CLI -->|Live Market Feed| FE_UI["BackTest UI (React / Vite)"]
        FE_UI <-->|REST API / JWT Auth| BT_APP
    end
```

---

## 2. End-to-End Sequence & Execution Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Vendor as Upstox WebSocket (Vendor)
    participant WSGateway as ConnectWS-Upstox
    participant Splitter as wsDataSplitterConsumer
    participant RawKafka as Kafka (splited-live-data)
    participant TimeframeService as Timeframe Constructor
    participant TFKafka as Kafka (timeframe_live_data)
    participant Chooser as StrategyChooserConsumer
    participant StratKafka as Kafka (strategy_live_data)
    participant Strategy as Strategy Engine (MSB)
    participant PlaceOrder as placeorder Gateway
    participant Broker as Upstox REST API / BackTestApp
    participant OrderKafka as Kafka (order_details)
    participant OrderStorer as order-storer-consumer
    participant Mongo as MongoDB Replica Set

    Note over Vendor, WSGateway: 1. Vendor Ingestion & Protobuf Decoding
    Vendor->>WSGateway: Binary Protobuf Feed
    WSGateway->>WSGateway: Decode using MarketDataFeed.proto
    WSGateway->>Splitter: Publish raw batch to incoming-ws-msg

    Note over Splitter, RawKafka: 2. Symbol Splitting & Distribution
    Splitter->>Splitter: Split batch into individual symbol ticks
    par Kafka Keyed Distribution
        Splitter->>RawKafka: Publish tick (Key: symbol)
    and Redis Live Stream
        Splitter->>RedisPub: Publish to Redis Pub/Sub live:symbol
    end

    Note over RawKafka, TimeframeService: 3. Centralized Multi-Timeframe Construction
    RawKafka->>TimeframeService: Ingest tick (Key: symbol)
    TimeframeService->>TimeframeService: Validate exchange timestamp & session boundaries
    TimeframeService->>TimeframeService: Update 1m, 3m, 5m, 15m OHLCV & volume deltas
    alt Timeframe Bucket Rollover
        TimeframeService->>TimeframeService: Finalize & emit closedCandle
    else Intra-Bar Tick
        TimeframeService->>TimeframeService: Update formingCandle
    end
    TimeframeService->>TFKafka: Publish atomic multi-timeframe snapshot (Key: symbol)

    Note over TFKafka, Chooser: 4. Dynamic Multi-Tenant Slicing
    TFKafka->>Chooser: Consume timeframe snapshot
    Chooser->>RedisCache: Query active tenant deployments for symbol
    Chooser->>Chooser: Dynamically slice snapshot (retain only deployment's configured timeframes)
    Chooser->>StratKafka: Forward sliced snapshot (Key: symbol or symbol:deployment_id)

    Note over StratKafka, Strategy: 5. Real-Time Risk vs Closed Candle Evaluation
    StratKafka->>Strategy: Consume sliced snapshot
    par Real-Time Position Risk Check
        Strategy->>Strategy: Evaluate Target & Stop-Loss on tick ltp (EVERY TICK)
        opt Target or Stop-Loss Hit
            Strategy->>PlaceOrder: Dispatch immediate exit order
        end
    and Breakout & Signal Evaluation
        opt closedCandle is Present (Bucket Rollover)
            Strategy->>Strategy: Evaluate Market Structure Break (MSB) swings
            opt Valid Breakout Entry Setup
                Strategy->>PlaceOrder: Dispatch new entry order
            end
        end
    end

    Note over PlaceOrder, OrderStorer: 6. Execution, Auditing & Ledger Settlement
    PlaceOrder->>Broker: Submit trade (Live Upstox API or BackTestApp ledger)
    Broker-->>PlaceOrder: Order confirmation & fill details
    PlaceOrder->>OrderKafka: Publish order execution payload
    OrderKafka->>OrderStorer: Consume order_details
    OrderStorer->>Mongo: Persist trade audit into MongoDB order_details & ledger
```

---

## 3. Detailed Data Flow Architecture

### 3.1 Live Trading Pipeline
1. **Upstox WebSocket Ingestion:**
   `ConnectWS-Upstox` connects to `wss://api.upstox.com/v3/feed/market-data-feed`. Binary Protobuf messages are decoded into JSON tick arrays and published as batches to `incoming-ws-msg` (key: `uplink_ws_data`).
2. **Key-Partitioned Symbol Splitting:**
   `wsDataSplitterConsumer` consumes from `incoming-ws-msg`, unbatches items into individual symbol ticks, and publishes them to `splited-live-data` using `symbol` as the partition key. It also publishes to Redis Pub/Sub `live:<symbol>` for live chart streaming.
3. **Centralized Timeframe Aggregation:**
   `timeframe-constructor` consumes `splited-live-data`. For each symbol, it updates in-memory OHLCV states across all standard intervals (`1m`, `3m`, `5m`, `15m`). On bucket rollover, it produces `closedCandle` and resets `formingCandle`. It emits combined atomic snapshots to `timeframe_live_data` (keyed by `symbol`).
4. **Dynamic Multi-Tenant Slicing & Routing:**
   `StrategyChooserConsumer` subscribes to both `splited-live-data` and `timeframe_live_data`. When a timeframe snapshot arrives, it queries Redis for active deployments subscribed to that symbol, verifies their `data_mode` (`timeframe` or `hybrid`), strips timeframes that the deployment did not request, and dispatches the payload to the strategy topic (e.g. `msb_live_data`).
5. **Decoupled Strategy Processing:**
   Strategy engines inherit from `Strategy.js`.
   - **Continuous Risk Check:** Every tick's `ltp` immediately checks Target and Stop-Loss limits.
   - **Structural Signal Evaluation:** Structural breakout signals (e.g., MSB swing points) are evaluated **exclusively on completed `closedCandle` bars**.
6. **Execution & Settlement:**
   `placeorder` routes to Upstox API for live accounts or internal simulation for backtest/paper accounts. Successful fills are published to `order_details`, which `order-storer-consumer` records in MongoDB.

### 3.2 Chronological Backtesting Pipeline
1. **Deterministic Historical Playback:**
   `backtest-streamer` generates historical ticks chronologically and sends them to `backtest-client`.
2. **Backtest Bus:**
   `backtest-client` forwards ticks to `backtest-stream-data` partitioned by `symbol`.
3. **Centralized Backtest Aggregation:**
   `timeframe-constructor` consumes `backtest-stream-data` and aggregates candles identically to the live pipeline, publishing snapshots to `timeframe_backtest_data`.
4. **Isolated Deployment Partitioning:**
   `StrategyChooserConsumer` consumes `timeframe_backtest_data` and publishes to `${strategyName}_backtest_data` using `${symbol}:${deployment_id}` as the partition key. This prevents message interleaving across concurrent backtests on the same instrument.
5. **BacktestApp Matching Engine:**
   Simulates orders, slippage, charges, and updates backtest balances and ledger records.

---

## 4. Timeframe Constructor Microservice Internals

### 4.1 Internal Module Organization
```
kafka/services/timeframeConstructor/
├── src/
│   ├── app.js                          # Process bootstrap & Kafka lifecycle
│   ├── consumers/
│   │   └── tickConsumer.js             # Consumes splited-live-data & backtest-stream-data
│   ├── producers/
│   │   └── timeframeProducer.js        # Produces to timeframe_live_data & timeframe_backtest_data
│   ├── core/
│   │   ├── timeBoundary.js             # IST bucket calculation & interval normalization
│   │   ├── candleAggregator.js         # OHLCV calculation, session bounds, rollovers
│   │   ├── symbolStateManager.js       # In-memory Map of SymbolTimeframeState
│   │   └── snapshotGenerator.js        # Multi-timeframe atomic snapshot assembler
│   ├── storage/
│   │   └── persistenceService.js       # Redis checkpointing & crash-recovery hydration
│   └── utils/
│       ├── tickValidator.js            # Input tick validation & extraction
│       └── volumeCalculator.js         # Cumulative vs delta volume tracking
└── __tests__/                          # Native Node.js unit test suite
```

### 4.2 Time Boundary Calculation
Candles are calculated strictly from vendor exchange event timestamps (`ltpc.ltt` or `timestamp`) in the `Asia/Kolkata` timezone:
- Timeframe intervals: `1m` (60s), `3m` (180s), `5m` (300s), `15m` (900s), `30m` (1800s), `1h` (3600s), `1d` (86400s).
- Integer arithmetic: `bucketStart = Math.floor(epochMs / intervalMs) * intervalMs`.
- Market session check: 09:15 to 15:30 IST.

### 4.3 Atomic Multi-Timeframe Snapshot Schema
```json
{
  "eventId": "NIFTY-1793594160000-8472",
  "symbol": "NSE_INDEX|Nifty 50",
  "eventTimestamp": 1793594160000,
  "snapshotVersion": 1,
  "ltp": 26012.50,
  "volume": 12450,
  "timeframes": {
    "1m": {
      "timeframe": "1m",
      "startTime": 1793594100000,
      "endTime": 1793594160000,
      "formingCandle": {
        "open": 26000.00,
        "high": 26015.00,
        "low": 25998.50,
        "close": 26012.50,
        "volume": 12450,
        "isClosed": false,
        "updatedAt": 1793594160000
      },
      "closedCandle": {
        "open": 25985.00,
        "high": 26005.00,
        "low": 25980.00,
        "close": 26000.00,
        "volume": 45200,
        "isClosed": true,
        "updatedAt": 1793594100000
      }
    },
    "5m": {
      "timeframe": "5m",
      "startTime": 1793593800000,
      "endTime": 1793594100000,
      "formingCandle": {
        "open": 25950.00,
        "high": 26020.00,
        "low": 25945.00,
        "close": 26012.50,
        "volume": 182300,
        "isClosed": false,
        "updatedAt": 1793594160000
      },
      "closedCandle": null
    }
  }
}
```

---

## 5. Kafka Topics & Partitioning Map

| Topic | Partitions | Key Strategy | Retention | Role |
| :--- | :--- | :--- | :--- | :--- |
| `incoming-ws-msg` | 50 | Static / Uplink | 4 Hours | Raw batched vendor data stream from Upstox. |
| `splited-live-data` | 50 | `symbol` | 24 Hours | Normalized individual symbol ticks. |
| `backtest-stream-data` | 50 | `symbol` | 24 Hours | Historical tick stream for backtesting. |
| `timeframe_live_data` | 50 | `symbol` | 24 Hours | Centralized multi-timeframe live snapshots. |
| `timeframe_backtest_data` | 50 | `symbol` | 24 Hours | Centralized multi-timeframe backtest snapshots. |
| `msb_live_data` | 50 | `symbol` | 24 Hours | Live data routed to MSB strategy engines. |
| `msb_backtest_data` | 50 | `${symbol}:${deployment_id}` | 24 Hours | Backtest data routed to MSB strategy engines. |
| `order_details` | 50 | `order_id` / `symbol` | 7 Days | Audit trail of placed and filled orders. |

---

## 6. Multi-Tenant Deployment Model & Database Persistence

### Deployment Schema Extensions (`BackTest/BackTestApp/src/models/deployment.js`)
- `timeframes: [String]` — Declared timeframe requirements (e.g., `["1m", "5m"]`). Defaults to `["1m"]`.
- `data_mode: String` — `"tick"`, `"timeframe"`, or `"hybrid"`. Defaults to `"timeframe"`.

### Redis Cache Keys
- `strategies:live:<symbol>` — JSON array of active live deployments.
- `strategies:backtest:<symbol>` — JSON array of active backtest deployments.
- `timeframe_state:<symbol>` — Periodic checkpoint of symbol candle state.
- `live:<symbol>` — Real-time tick Pub/Sub channel for frontend charts.
