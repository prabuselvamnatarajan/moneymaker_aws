# Kafka Service Topology and Message Formats

This document describes the message brokering architecture, detailing every Kafka topic, producer, consumer group, partition scheme, replica scaling model, and message JSON structure.

## Kafka Network Topology

```
[ConnectWS-Upstox] 
        |
        +--> (incoming-ws-msg: 50 partitions) --> [wsDataSplitterConsumer - 3 Replicas] 
                                                        |
                                                        +--> (splited-live-data: 50 partitions, Key: symbol_name) 
                                                                  |
                                                                  +--> [StrategyChooserConsumer - 3 Replicas]
                                                                  +--> [price-storer-consumer - 3 Replicas]
                                                                  +--> [position-tracker-consumer - 1 Replica]
                                                                  +--> [deployment-symbol-resolver-consumer - 1 Replica]
                                                       
[BacktestClient]
        |
        +--> (backtest-stream-data: 50 partitions) --> [StrategyChooserConsumer - 3 Replicas]
                                                             |
                                                             +--> (msb_live_data / msb_backtest_data: 50 partitions)
                                                                       |
                                                                       +--> [msb-strategy-live Engine - 3 Replicas]

[placeorder API]
        |
        +--> (order_details: 50 partitions) --> [order-storer-consumer - 3 Replicas]
```

---

## Partition & Consumer Group Registry

All topics are configured with **50 Partitions** (`KAFKA_CFG_NUM_PARTITIONS: 50`) across 3 Kafka Brokers (`kafka-broker-1`, `kafka-broker-2`, `kafka-broker-3`).

| Topic Name | Producer Service | Consumer Group ID | Consumer Service(s) | Replicas | Key Routing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `incoming-ws-msg` | `ConnectWS-Upstox` | `WS_data_splitter` | `wsDataSplitterConsumer` | 3 | `"uplink_ws_data"` |
| `splited-live-data` | `wsDataSplitterConsumer` | `timeframe_constructor_live_group` | `timeframe-constructor` | 1–3 | Symbol Name (e.g., `"NSE_EQ|KARURVYSYA"`) |
| `splited-live-data` | `wsDataSplitterConsumer` | `strategy_chooser_group` | `StrategyChooserConsumer` | 3 | Symbol Name |
| `splited-live-data` | `wsDataSplitterConsumer` | `storer-group` | `price-storer-consumer` | 3 | Symbol Name |
| `splited-live-data` | `wsDataSplitterConsumer` | `position_tracker_group` | `position-tracker-consumer` | 1 | Symbol Name |
| `splited-live-data` | `wsDataSplitterConsumer` | `deployment_symbol_resolver_group` | `deployment-symbol-resolver-consumer` | 1 | Symbol Name |
| `backtest-stream-data` | `BacktestClient` | `timeframe_constructor_backtest_group` | `timeframe-constructor` | 1–3 | Symbol Name |
| `backtest-stream-data` | `BacktestClient` | `strategy_chooser_group` | `StrategyChooserConsumer` | 3 | Symbol Name / Backtest ID |
| `timeframe_live_data` | `timeframe-constructor` | `strategy_chooser_group` | `StrategyChooserConsumer` | 3 | Symbol Name |
| `timeframe_backtest_data` | `timeframe-constructor` | `strategy_chooser_group` | `StrategyChooserConsumer` | 3 | Symbol Name |
| `${strategyName}_live_data` | `StrategyChooserConsumer` | `${strategyName}_live_group` | Strategy Engines (`MSB`) | 3 | Symbol Name |
| `${strategyName}_backtest_data` | `StrategyChooserConsumer` | `${strategyName}_backtest_group` | Strategy Engines (`MSB`) | 3 | `${symbol}:${deployment_id}` |
| `order_details` | `placeorder` | `order_storer_group` | `order-storer-consumer` | 3 | Symbol Name / Order ID |

---

## Detailed Topic Specifications & Schemas

### 1. `incoming-ws-msg`
* **Purpose**: Carries raw batched tick updates received from Upstox WebSocket feed.
* **Producer**: `ConnectWS-Upstox` (`websocket.js`)
* **Consumer**: `wsDataSplitterConsumer` (`wsDataSplitterConsumer.js`)
* **Consumer Group**: `WS_data_splitter`
* **Key**: `"uplink_ws_data"`
* **Value Schema**:
```json
{
  "NSE_EQ|KARURVYSYA": {
    "fullFeed": {
      "marketFF": {
        "ltpc": {
          "ltp": 204.15,
          "ltt": 1720236001000,
          "cp": 202.0
        }
      }
    }
  }
}
```

---

### 2. `splited-live-data`
* **Purpose**: Distributes individual ticker updates for real-time calculation, position tracking, option resolution, and raw archiving.
* **Producer**: `wsDataSplitterConsumer`
* **Consumers**:
  1. `StrategyChooserConsumer` (Group: `strategy_chooser_group`)
  2. `price-storer-consumer` (Group: `storer-group` - inserts ticks into MongoDB `stock_database` collection `<symbol_name>`)
  3. `position-tracker-consumer` (Group: `position_tracker_group` - calculates unrealized MTM PnL)
  4. `deployment-symbol-resolver-consumer` (Group: `deployment_symbol_resolver_group` - tracks underlying index LTP changes)
* **Key**: Instrument key string (e.g. `"NSE_EQ|KARURVYSYA"`).
* **Value Schema**:
```json
{
  "symbol_name": "NSE_EQ|KARURVYSYA",
  "ltpc": {
    "ltp": 204.15,
    "ltt": 1720236001000,
    "cp": 202.0
  },
  "latency": {
    "beforeSplit": 142
  }
}
```

---

### 3. `backtest-stream-data`
* **Purpose**: Feeds historical stock ticks into the strategy analysis loop for backtesting simulations.
* **Producer**: `BacktestClient` (`clientServer.js`)
* **Consumer**: `StrategyChooserConsumer` (Group: `strategy_chooser_group`), `position-tracker-consumer`, `deployment-symbol-resolver-consumer`
* **Key**: Symbol Name.
* **Value Schema**: Historical tick object with `deployment_id` and `run_id`.

---

### 4. `msb_live_data`
* **Purpose**: Delivers live ticks to the MSB strategy engine after verification that the symbol is mapped to an active deployment.
* **Producer**: `StrategyChooserConsumer`
* **Consumer**: `msb-strategy-live` Engine
* **Key**: Symbol name (e.g. `"NSE_EQ|KARURVYSYA"`).
* **Value Schema**:
```json
{
  "symbol_name": "NSE_EQ|KARURVYSYA",
  "ltpc": { "ltp": 204.15, "ltt": 1720236001000, "cp": 202.0 },
  "strategy_details": {
    "name": "MSB",
    "isTest": false,
    "user_id": "60d5ec49f1a2c80015f8e9a1",
    "account_id": "ACC-87216",
    "instrument_token": "NSE_EQ|KARURVYSYA",
    "symbol": "NSE_EQ|KARURVYSYA",
    "deployment_id": "DEP-9921",
    "state_epoch": 1720236000000,
    "timeframe": "1m",
    "is_internal_broker": false
  }
}
```

---

### 5. `order_details`
* **Purpose**: Records order executions for auditing and persistent tracking.
* **Producer**: `placeorder` API
* **Consumer**: `order-storer-consumer` (Group: `order_storer_group` - inserts documents into MongoDB `order_details` collection)
* **Key**: Symbol Name.
* **Value Schema**: Execution response object containing price, quantity, order type (BUY/SELL), deployment ID, account ID, and broker response payload.
