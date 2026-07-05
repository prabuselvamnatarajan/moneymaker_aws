# Kafka Service Topology and Message Formats

This document describes the message brokering architecture, detailing every Kafka topic, producer, consumer group, and message JSON structure.

## Kafka Network Diagram

```
[ConnectWS-Upstox] 
        |
        +--> (incoming-ws-msg) --> [wsDataSplitterConsumer] 
                                            |
                                            +--> (splited-live-data) 
                                                      |
                                                      +--> [StrategyChooserConsumer]
                                                      +--> [storer-consumer-live]
                                                      +--> [BackTestApp WebSocket]
                                            
[BacktestClient]
        |
        +--> (backtest-stream-data) --> [StrategyChooserConsumer]
                                                 |
                                                 +--> (msb_live_data / msb_backtest_data)
                                                           |
                                                           +--> [msb-strategy-live / msb-strategy-backtest]

[placeorder]
        |
        +--> (order_details) --> [order-storer-consumer]
```

---

## Detailed Topic Registry

### 1. `incoming-ws-msg`
* **Purpose**: Carries raw batched tick updates received from the Upstox WebSocket feed.
* **Producer**: `ConnectWS-Upstox` (`websocket.js`)
* **Consumer**: `wsDataSplitterConsumer` (`wsDataSplitterConsumer.js`)
* **Consumer Group**: `WS_data_splitter`
* **Key**: `"uplink_ws_data"`
* **Value Schema**: A JSON dictionary mapping instrument keys to their raw feed data:
```json
{
  "NSE_EQ|INE062A01020": {
    "feeds": {
      "NSE_EQ|INE062A01020": {
        "ltpc": {
          "ltp": 605.4,
          "ltt": 1720235999000,
          "cp": 601.2
        }
      }
    }
  }
}
```

---

### 2. `splited-live-data`
* **Purpose**: Distributes individual ticker updates for real-time calculation and logging.
* **Producer**: `wsDataSplitterConsumer`
* **Consumers**:
  1. `StrategyChooserConsumer` (Group: `strategy_chooser_group`)
  2. `storer-consumer-live` (Group: `live_data_storer_group` - inserts ticks into MongoDB db `stock_live_data`)
  3. `BackTestApp`'s WebServer (Group: `backtest-app-ws-[random]` - streams real-time prices to UI)
* **Key**: The instrument key string (e.g. `"NSE_EQ|KARURVYSYA"`).
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
* **Purpose**: Feeds historical stock ticks into the strategy analysis loop for simulations.
* **Producer**: `BacktestClient` (`clientServer.js`)
* **Consumer**: `StrategyChooserConsumer` (Group: `strategy_chooser_group`)
* **Key**: `"backtest-${symbolName}-${date}-${speed}"` (e.g. `"backtest-NSE_EQ|KARURVYSYA-2026-07-01-100"`).
* **Value Schema**: Same tick model schema exported from historical files.
```json
{
  "symbol_name": "NSE_EQ|KARURVYSYA",
  "ltpc": {
    "ltp": 204.15,
    "ltt": 1720236001000,
    "cp": 202.0
  }
}
```

---

### 4. `msb_live_data`
* **Purpose**: Delivers live ticks to the MSB strategy engine after verification that the symbol is mapped to an active deployment.
* **Producer**: `StrategyChooserConsumer`
* **Consumer**: `msb-strategy-live` (Group: `live_msb_strategy_group`)
* **Key**: The symbol name (e.g. `"NSE_EQ|KARURVYSYA"`).
* **Value Schema**: Augmented tick object enclosing active strategy details.
```json
{
  "symbol_name": "NSE_EQ|KARURVYSYA",
  "ltpc": { "ltp": 204.15, "ltt": 1720236001000, "cp": 202.0 },
  "strategy_details": {
    "name": "MSB",
    "isTest": false,
    "account_id": "ACC-87216",
    "instrument_token": "14321",
    "symbol": "NSE_EQ|KARURVYSYA",
    "strategy_id": "STR-001",
    "deployment_id": "DEP-9921",
    "is_internal_broker": false
  }
}
```

---

### 5. `msb_backtest_data`
* **Purpose**: Delivers simulation ticks to the MSB strategy engine.
* **Producer**: `StrategyChooserConsumer`
* **Consumer**: `msb-strategy-backtest` (Group: `backtest_msb_strategy_group`)
* **Key**: The symbol name.
* **Value Schema**: Same structure as `msb_live_data` but with `isTest: true` forced inside `strategy_details`.

---

### 6. `order_details`
* **Purpose**: Records order executions for auditing and persistent tracking.
* **Producer**: `placeorder` API
* **Consumer**: `order-storer-consumer` (Group: `order_details_group` - inserts documents into MongoDB db `order_details` collection named by symbol)
* **Key**: `"order"`
* **Value Schema**:
```json
{
  "order_id": "ORD-928165",
  "symbol": "NSE_EQ|KARURVYSYA",
  "price": 204.15,
  "quantity": 100,
  "type_of_order": "BUY",
  "deployment_id": "DEP-9921",
  "account_id": "ACC-87216",
  "is_test": true,
  "timestamp": "2026-07-05T14:30:00.000Z",
  "broker_response": {
    "status": "success",
    "data": {
      "order_id": "2407050001243"
    }
  }
}
```
