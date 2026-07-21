# MoneyMaker Codebase Audit & Identified Issues

This document compiles the inconsistencies, architectural flaws, potential race conditions, and bugs identified during the analysis of the MoneyMaker repository, along with their resolution status and implementation details.

---

## Audit & Resolution Summary

All 16 identified issues have been audited and verified as **RESOLVED / FIXED** in the current version of the codebase.

---

## 1. Redis Key Collision for Active Strategy State (Critical)
* **Status**: **RESOLVED**
* **Description**: Helper functions `getBoughtQuantityWithTagFromRedis(tag)` and `setBoughtQuantityWithTagToRedis(tag, quantity)` read and write bought quantities to Redis.
* **Resolution**: Keys are namespaced using `deploymentId` (`bought_quantity:${deploymentId}:${tag}`). `MSB.js` passes `strategy_details.deployment_id`.
* **Code Locations**:
  * [account_utils.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Shared/Accounts/account_utils.js)
  * [MSB.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/MSB.js)

---

## 2. WebSocket Price Feed Omission in Backtest Mode (High)
* **Status**: **RESOLVED**
* **Description**: WebSocket gateway (`websocketService.js`) pushes real-time price updates to the front-end user interface.
* **Resolution**: Added `backtest-stream-data` topic subscription to `websocketService.js` to broadcast tick-by-tick LTP updates to clients during backtest runs.
* **Code Location**:
  * [websocketService.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/websocketService.js)

---

## 3. Lack of Input Validation in `placeorder` API (Medium)
* **Status**: **RESOLVED**
* **Description**: POST requests to `/` gateway needed validation for essential order fields.
* **Resolution**: Input validation middleware was added on POST `/` endpoint to validate `instrument_token`, `price`, `quantity`, `transaction_type`, and `strategy_details.user_id`.
* **Code Location**:
  * [server.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Orders/placeOrders/server.js)

---

## 4. Hardcoded Virtual Account Creation Balance (Low)
* **Status**: **RESOLVED**
* **Description**: Creation of missing virtual accounts with hardcoded balance.
* **Resolution**: Account existence is strictly queried from MongoDB in `trade.js`. If non-existent, an error is returned instead of silently creating default accounts.
* **Code Location**:
  * [trade.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/trade.js)

---

## 5. Potential Startup Race Condition for Kafka Brokers (Medium)
* **Status**: **RESOLVED**
* **Description**: Kafka consumer connection attempts on startup during Docker Compose stack launches.
* **Resolution**: Implemented `connectWithRetry` helper across all Kafka consumer/producer services with up to 30 retry attempts and 5-second delays (2.5 minutes resilience window).

---

## 6. Redis Key Collision for Strategy Runner State (Critical)
* **Status**: **RESOLVED**
* **Description**: MSB strategy indicator state keys mapped by symbol (`strategies:msb:backtest:${symbol}`).
* **Resolution**: `getStrategyStateDetails.js` namespaces Redis keys with `deploymentId` (`strategies:${STRATEGY_NAME}:${mode}:${deploymentId}:${symbol}`).
* **Code Locations**:
  * [getStrategyStateDetails.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/redis_utils/getStrategyStateDetails.js)
  * [server.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/server.js)

---

## 7. Desynchronization Risk in Live Order Execution (Critical)
* **Status**: **RESOLVED**
* **Description**: `placeorder` handler called `triggerBackTestApp` before placing the live broker order.
* **Resolution**: `placeOrders/server.js` calls the Upstox broker API *first* for live orders. Internal ledger logging (`triggerBackTestApp`) is executed only after receiving a successful broker response.
* **Code Location**:
  * [server.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Orders/placeOrders/server.js)

---

## 8. Unvalidated Zero-Quantity Order Triggers (Medium)
* **Status**: **RESOLVED**
* **Description**: Strategy engines placing orders with `quantity <= 0`.
* **Resolution**: Added quantity validation checks in `triggerOrder` and trade calculation functions in `MSB.js` to suppress order placement when quantity is zero or negative.
* **Code Location**:
  * [MSB.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/kafka/services/Strategies/MSB/MSB.js)

---

## 9. Scheduled Exporter `timestamp` Query Bug (Critical)
* **Status**: **RESOLVED**
* **Description**: Exporter querying MongoDB collections using hardcoded `timestamp` field filter.
* **Resolution**: `exportCollections.js` dynamically queries by `created_at` for `trades`, `created_on` for `ledgers`, and `timestamp` for stock price ticks.
* **Code Location**:
  * [exportCollections.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/ScheduledServices/ExportToFile/exportCollections.js)

---

## 10. File Sanitization Mismatch between Exporter and Streamer (Critical)
* **Status**: **RESOLVED**
* **Description**: Mismatch in symbol name sanitization regex between exporter and streamer services.
* **Resolution**: Standardized symbol sanitization across `exportCollections.js`, `streamer.js`, and `clientServer.js` using identical `/[^a-zA-Z0-9-_]/g` regex.

---

## 11. Backtest WebSocket Stream Subscription Gap (Critical)
* **Status**: **RESOLVED**
* **Description**: WebSocket server in `BackTestApp` and `stream-to-client` missing backtest stream subscriptions.
* **Resolution**: `websocketService.js` subscribes to `backtest-stream-data` and publishes tick updates under `backtest:` Redis PubSub channels.

---

## 12. Backtest Reset Command Clears Incorrect Redis Keys (Critical)
* **Status**: **RESOLVED**
* **Description**: `resetBacktestDeployment` key clearing logic.
* **Resolution**: `resetBacktestDeployment` in `deployment.js` executes a non-blocking `SCAN` loop matching `*${deploymentIdStr}*` to delete all deployment-scoped keys.
* **Code Location**:
  * [deployment.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/deployment.js)

---

## 13. Database Collection Initialization Double-Colon Bug (Critical)
* **Status**: **RESOLVED**
* **Description**: Constructing Redis key resulting in double-colons (`strategies:live::${symbol}`).
* **Resolution**: `base_init.js` strips trailing colons (`redisKey.endsWith(':') ? redisKey.slice(0, -1) : redisKey`).
* **Code Location**:
  * [base_init.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/appInit/Init/base_init.js)

---

## 14. Quadratic Performance Degradation in Trade Ledger Creation (Critical)
* **Status**: **RESOLVED**
* **Description**: Trade insertion querying all historical trades to recalculate position size and entry price.
* **Resolution**: `trade.js` caches `position_size` and `average_entry_price` directly on `Deployment` records, updating them in $O(1)$ time upon trade execution.
* **Code Location**:
  * [trade.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/trade.js)

---

## 15. Single-Tenant Broker Hardcoding & Security Risk (Critical)
* **Status**: **RESOLVED**
* **Description**: Upstox authorization storing token using static non-namespaced key.
* **Resolution**: Redis access token functions in `AuthoriseUpstoxClient.js` require and append `user_id` to storage keys (`upstox_access_token:${userId}`).

---

## 16. Docker Image Run Failure due to Runtime Volume Dependency (Critical)
* **Status**: **RESOLVED**
* **Description**: Source imports depending on runtime-mounted directory.
* **Resolution**: Dockerfiles use `COPY ./redis_operations /app/redis_utils/redis_operations` and `scripts/copy_shared.sh` to bundle shared code into Docker images during build time.

---

## 17. Org Market-Data Token Cleared on Any User Expiry (Critical)
* **Status**: **RESOLVED**
* **Description**: `clearBrokerAccessToken` deleted the shared `redis_upstox_access_token` org key whenever any user's Upstox token expired, knocking out the vendor WebSocket feed for all tenants.
* **Resolution**: Org/admin Redis keys are deleted only when the expired broker belongs to an admin user; afterward `syncOrgAccessTokenIfAdmin()` attempts to repopulate from MongoDB.
* **Code Location**:
  * [broker.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/broker.js)

---

## 18. Global Upstox Unsubscribe on Per-User Remap (Critical)
* **Status**: **RESOLVED**
* **Description**: Deployment strike remap unsubscribed an instrument globally after checking only the remapping user's watchlist, starving other users of ticks for the same instrument.
* **Resolution**: `unsubscribeSymbolTokenIfUnused` now checks `UserSymbol` globally (`is_active: true`) before publishing unsubscribe.
* **Code Location**:
  * [deployment.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/deployment.js)

---

## 19. Unscoped Mongo Broker Token Fallback (High)
* **Status**: **RESOLVED**
* **Description**: `getAccessTokenFromRedis()` without `userId` and `getOrgAccessTokenFromRedis()` fell back to `findOne({ external_broker_id: 'upstox' })`, returning an arbitrary tenant's token.
* **Resolution**: User lookups require an explicit `userId`; org lookup uses only the admin-role user's broker and also seeds `:org` Redis key.
* **Code Location**:
  * [AuthoriseUpstoxClient.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Shared/AuthorisedUpstox/AuthoriseUpstoxClient.js)

---

## 20. Service Token Hardcoded User Impersonation (High)
* **Status**: **RESOLVED**
* **Description**: `authenticateOrServiceToken` defaulted missing `X-User-Id` to a seed user ObjectId, causing live trades and lifecycle actions to run as the wrong user.
* **Resolution**: `X-User-Id` is required for service-token auth; `placeOrders` and sweep signal logger send the real `strategy_details.user_id`; trade controller prefers body/`X-User-Id` under service auth.
* **Code Locations**:
  * [serviceTokenMiddleware.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/middlewares/serviceTokenMiddleware.js)
  * [trade.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/controllers/trade.js)
  * [dependency.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/MicroServices/Orders/placeOrders/dependency.js)

---

## 21. Symbols List Live Metrics Not Wired (Medium)
* **Status**: **RESOLVED**
* **Description**: Symbols list showed placeholder last price / 24h change / volume; WebSocket only forwarded LTP and UI used strict token equality.
* **Resolution**: Backend `extractMarketMetrics` forwards `change_pct` and `volume`; UI maintains capped `liveQuotes` with normalized token matching and displays live columns.
* **Code Locations**:
  * [websocketService.js](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestApp/src/services/websocketService.js)
  * [instrumentToken.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestUI/src/utils/instrumentToken.ts)
  * [SymbolsListView.tsx](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/BackTest/BackTestUI/src/components/SymbolsListView.tsx)
