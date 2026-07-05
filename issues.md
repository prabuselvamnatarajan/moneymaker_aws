# MoneyMaker Codebase Audit & Identified Issues

This document compiles the inconsistencies, architectural flaws, potential race conditions, and bugs identified during the analysis of the MoneyMaker repository. These items should be prioritized for future sprint planning and test case coverage.

---

## 1. Redis Key Collision for Active Strategy State (Critical)
* **Description**: The helper functions `getBoughtQuantityWithTagFromRedis(tag)` and `setBoughtQuantityWithTagToRedis(tag, quantity)` read and write bought quantities to Redis using the key `bought_quantity:${tag}`. In `MSB.js`, `tag` is set to the `symbol` (e.g. `SBIN`).
* **Impact**:
  * If multiple deployments or strategies are trading the same symbol (e.g., if Strategy A and Strategy B both trade `SBIN`, or if a `LIVE` deployment and a `BACKTEST` deployment are both active on `SBIN`), they will overwrite each other's bought quantities in Redis.
  * This will trigger incorrect quantity sizes when calculating Sell orders (such as trying to sell another bot's holdings or selling an outdated quantity).
* **Code Locations**:
  * [account_utils.js:L37-64](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Shared/Accounts/account_utils.js#L37-L64)
  * [MSB.js:L33,77,102](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/MSB.js#L33)
* **Proposed Fix**: Namespace the Redis keys using both the `deployment_id` and the `symbol` (e.g., `bought_quantity:${deployment_id}:${symbol}`).

---

## 2. WebSocket Price Feed Omission in Backtest Mode (High)
* **Description**: The `BackTestApp` WebSocket gateway (`websocketService.js`) pushes real-time price updates to the front-end user interface. However, its Kafka consumer only subscribes to the `splited-live-data` topic. It does not subscribe to the `backtest-stream-data` topic or strategy backtest topics.
* **Impact**:
  * When running a backtest, the UI WebSocket does not receive tick-by-tick last price (LTP) updates.
  * Although the user will see executed trades appear in the list views (as the UI periodically refetches the MongoDB database), the real-time ticker stream and tick charts in the dashboard will remain blank during backtest runs.
* **Code Location**:
  * [websocketService.js:L134](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/websocketService.js#L134)
* **Proposed Fix**: Add a subscription to `backtest-stream-data` inside `websocketService.js` and extract the instrument token/LTP to stream to subscribed users when a backtest deployment is running.

---

## 3. Lack of Input Validation in `placeorder` API (Medium)
* **Description**: The `placeorder` gateway (`MicroServices/Orders/placeOrders/server.js`) receives POST requests from strategy engines and routes them. It does not perform validation to ensure that fields like `symbol`, `price`, `quantity`, `type_of_order`, or `strategy_details` are present or correctly typed.
* **Impact**:
  * Missing or malformed properties in the REST body will cause the microservice to crash with uncaught runtime errors (e.g., `Cannot read properties of undefined`).
  * If routed to the virtual database execution, it will write corrupt documents to the `trades` and `ledgers` collections.
* **Code Location**:
  * [server.js:L1-69](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Orders/placeOrders/server.js#L1-L69)
* **Proposed Fix**: Integrate a validation middleware (such as `joi` or simple schema checking) on the POST `/` endpoint to ensure all required fields are validated.

---

## 4. Hardcoded Virtual Account Creation Balance (Low)
* **Description**: In the `createTrade` service in `BackTestApp`, if the virtual account associated with the trade request does not exist in MongoDB, it creates one on the fly and sets its initial balance to a hardcoded value of `40000` INR.
* **Impact**:
  * This overrides the user's intent if they configure a deployment with a different initial capital size.
  * Creates silent configurations in MongoDB without explicit auditor checks.
* **Code Location**:
  * [trade.js:L118](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/trade.js#L118)
* **Proposed Fix**: Ensure the `placeorder` payload includes the account configuration, or return an error if the account is not explicitly pre-created via the dashboard interface.

---

## 5. Potential Startup Race Condition for Kafka Brokers (Medium)
* **Description**: Strategy consumers and splitter workers start executing connection attempts immediately when Docker Compose spins up. Because Kafka brokers take longer to perform internal clustering and election tasks, consumers occasionally crash on launch.
* **Impact**:
  * Services may enter a restart loop on docker deployment.
  * While `kafkajs` contains a retry policy, if the broker clustering takes longer than the maximum retries, the container crashes and terminates.
* **Proposed Fix**: Implement a wrapper script (e.g., using `wait-for-it.sh` or Docker healthcheck parameters) to delay consumer service startup until the Kafka brokers are fully available.
