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

---

## 6. Redis Key Collision for Strategy Runner State (Critical)
* **Description**: Inside the MSB strategy code, the previous high/low and trend state is stored in Redis using keys mapped by symbol: `strategies:msb:backtest:${symbol}` and `strategies:msb:live:${symbol}`.
* **Impact**:
  * If two different users or two different deployments are active on the same symbol (e.g. `SBIN`) using the `msb` strategy at the same time, they will overwrite each other's technical indicator states.
  * Ticks belonging to one deployment will corrupt the indicator trend computations of the other deployment, leading to erratic triggers.
* **Code Locations**:
  * [getStrategyStateDetails.js:L9-13](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/redis_utils/getStrategyStateDetails.js#L9-L13)
  * [server.js:L51,65](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/server.js#L51)
* **Proposed Fix**: Include the `deployment_id` in the Redis state key name (e.g. `strategies:msb:backtest:${deployment_id}:${symbol}`).

---

## 7. Desynchronization Risk in Live Order Execution (Critical)
* **Description**: In `placeorder`'s express handler, it calls `triggerBackTestApp(body)` to log the trade in `BackTestApp`'s database *before* making the API call `placeOrders` to Upstox.
* **Impact**:
  * If the broker's API call fails (e.g., due to invalid API keys, insufficient broker margins, API downtime, or rate-limiting), the virtual database ledger will still record the trade as successful.
  * This creates desynchronization where the dashboard shows shares bought/sold and virtual balances updated, but the actual broker account has no matching transactions.
* **Code Location**:
  * [server.js:L27-44](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Orders/placeOrders/server.js#L27-L44)
* **Proposed Fix**: Place the real order on Upstox first, wait for a successful response, and only then record the trade in `BackTestApp`'s virtual ledger. If the broker call fails, log the error and reject the transaction.

---

## 8. Unvalidated Zero-Quantity Order Triggers (Medium)
* **Description**: If a strategy's account balance is depleted, or if it tries to close a position but the holdings tag indicates 0 quantity, `computeOrderPayload` will output `quantity = 0` or a negative value.
* **Impact**:
  * The strategy will attempt to place an order with a quantity of 0.
  * This results in failed broker requests or corrupt ledger entries in `BackTestApp` showing trades with zero quantities.
* **Code Location**:
  * [MSB.js:L20-34](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/MSB.js#L20-L34)
* **Proposed Fix**: Add a sanity check in `computeOrderPayload` or `MSB.js` to ensure the quantity is strictly greater than zero before calling the placement API.

---

## 9. Scheduled Exporter `timestamp` Query Bug (Critical)
* **Description**: The daily cron exporter `exportCollection` queries MongoDB collections using a hardcoded `{ timestamp: { $gte: start, $lte: end } }` filter. However, core transaction collections like `trades` use the field name `created_at`, and `ledgers` use the field name `created_on`. Neither model defines a `timestamp` field.
* **Impact**:
  * The scheduled task silently fails to fetch any trades or ledger records.
  * The daily exported JSON backups for transactions are permanently empty arrays (`[]`), resulting in catastrophic loss of backup coverage.
* **Code Location**:
  * [exportCollections.js:L26](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/ScheduledServices/ExportToFile/exportCollections.js#L26)
* **Proposed Fix**: Detect the target collection type dynamically and query by the correct field (`created_at` for trades, `created_on` for ledgers, and `timestamp` for price tick data).

---

## 10. File Sanitization Mismatch between Exporter and Streamer (Critical)
* **Description**: `exportCollections.js` sanitizes collection names by keeping hyphens: `collectionName.replace(/[^a-zA-Z0-9-_]/g, '_')`. In contrast, the backtest data loader (`streamer.js` and `clientServer.js`) sanitizes symbol names by replacing hyphens with underscores: `String(str).replace(/[^a-zA-Z0-9]/g, '_')`.
* **Impact**:
  * If a symbol name contains hyphens (e.g., `NSE_EQ-KARURVYSYA`), the file is saved as `NSE_EQ-KARURVYSYA.json`.
  * The streaming engine looks for `NSE_EQ_KARURVYSYA.json` and fails to load the data, crashing the backtest streaming loop with a "file not found" error.
* **Code Location**:
  * [exportCollections.js:L33](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/ScheduledServices/ExportToFile/exportCollections.js#L33)
  * [streamer.js:L12](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BacktestStreamer/streamer.js#L12)
* **Proposed Fix**: Standardize symbol/file name sanitization across all modules to use the exact same character filter rule.

---

## 11. Backtest WebSocket Stream Subscription Gap (Critical)
* **Description**: The WebSocket server in `BackTestApp` only subscribes to the `splited-live-data` Kafka topic. Similarly, in the `stream-to-client` WebSocket service, while users can subscribe to `backtest:${symbol}`, there is no publisher in the entire codebase publishing to this Redis PubSub channel.
* **Impact**:
  * Real-time price charts and tickers in the UI will remain completely blank/frozen during backtest runs, even though the backtest engine is actively publishing ticks to Kafka.
* **Code Location**:
  * [websocketService.js:L134](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/websocketService.js#L134)
  * [wsServer.js:L82](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/streamToClient/wsServer.js#L82)
* **Proposed Fix**: Update `BackTestApp`'s WebSocket server to subscribe to the backtest topic, and ensure the backtest client or chooser publishes ticks to the Redis PubSub channels under the `backtest:` namespace.

---

## 12. Backtest Reset Command Clears Incorrect Redis Keys (Critical)
* **Description**: When starting/restarting a backtest, `resetBacktestDeployment` deletes namespaced keys in Redis: `strategies:msb:backtest:${deploymentIdStr}:${symbol}` and `bought_quantity:${deploymentIdStr}:${symbol}`. However, the MSB strategy runner reads/writes from the global, non-namespaced keys: `strategies:msb:backtest:${symbol}` and `bought_quantity:${symbol}`.
* **Impact**:
  * Wiping and restarting a deployment clears the MongoDB database but leaves the indicator states (previous high/low, trend) and inventory holdings intact in Redis.
  * Subsequent backtest runs on the same symbol will inherit contaminated state data, leading to non-deterministic, inconsistent test results.
* **Code Locations**:
  * [deployment.js:L85-L91](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/deployment.js#L85-L91)
  * [getStrategyStateDetails.js:L9](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/redis_utils/getStrategyStateDetails.js#L9)
  * [MSB.js:L33,102](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/MSB.js#L33)
* **Proposed Fix**: Align the key generation in both the strategy runner and reset logic to always use the namespaced `deployment_id` format.

---

## 13. Database Collection Initialization Double-Colon Bug (Critical)
* **Description**: The database initializer constructs the Redis key as `${redisKey}:${propertyValue}`. Since the configuration `redisKey` is already defined with a trailing colon (e.g. `strategies:live:`), the resulting key is written to Redis as `strategies:live::${symbol}` (with two colons). However, `StrategyChooserConsumer` and the backtest app read from `strategies:live:${symbol}` (with one colon).
* **Impact**:
  * The initial strategies seeded by `appinit` on startup are never found by the strategy chooser, making the system default to empty active strategies until a manual sync is run from the UI.
* **Code Location**:
  * [base_init.js:L28](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/appInit/Init/base_init.js#L28)
* **Proposed Fix**: Remove the trailing colon from the environment variables in `docker-compose.yml` or check for double colons in `base_init.js` key construction.

---

## 14. Quadratic Performance Degradation in Trade Ledger Creation (Critical)
* **Description**: To record a new trade, the backend queries *all* previous trades for that deployment/account and runs a chronological loop to calculate the current position size and average entry price.
* **Impact**:
  * As the number of trades ($N$) grows, the execution time grows quadratically ($O(N^2)$ overall, $O(N)$ per trade insertion). This will trigger severe database latency, event loop blocking, and eventual timeouts on large backtests or active live deployments.
* **Code Location**:
  * [trade.js:L127-L132](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/trade.js#L127-L132)
* **Proposed Fix**: Cache the active position size and average entry price directly in the `Deployment` or `Account` schema, updating them in $O(1)$ time upon trade execution.

---

## 15. Single-Tenant Broker Hardcoding & Security Risk (Critical)
* **Description**: The Upstox authorization client retrieves and stores credentials using a single static Redis key `redis_upstox_access_token`.
* **Impact**:
  * The system cannot support multi-tenancy. If multiple users connect their Upstox accounts, they will overwrite each other's tokens, leading to User A's strategy placement executing trades against User B's broker account.
* **Code Locations**:
  * [login.js:L130](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/UpstoxLogin/login.js#L130)
  * [AuthoriseUpstoxClient.js:L31](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Shared/AuthorisedUpstox/AuthoriseUpstoxClient.js#L31)
* **Proposed Fix**: Namespace the access tokens in Redis and MongoDB by appending the `user_id` or `account_id` to the storage keys.

---

## 16. Docker Image Run Failure due to Runtime Volume Dependency (Critical)
* **Description**: Local source code imports depend on a runtime-mounted directory `/app/redis_utils/redis_operations/` mapping to `appInit/redis_operations/`. Without this volume mount (e.g., in a production Kubernetes or ECS stack), the containers will crash immediately on startup due to missing import modules.
* **Impact**:
  * The services are not truly containerized and cannot be deployed on serverless container services (like ECS, Fargate, or Google Cloud Run) where local host volumes are unavailable.
* **Code Location**:
  * [getStrategiesForSymbol.js:L1](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/StrategyChooserConsumer/redis_utils/getStrategiesForSymbol.js#L1)
* **Proposed Fix**: Bundle shared code inside the Docker images during compilation/build time using standard `COPY` instructions or an npm package workspace instead of relying on runtime volumes.
