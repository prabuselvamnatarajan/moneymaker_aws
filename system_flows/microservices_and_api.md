# Microservices, APIs, and Nginx Gateway Routing

This document details the configuration of the API Gateway (Nginx reverse proxy), individual trading microservices, the `BackTestApp` backend service, and the front-end user interface.

## Gateway Routing (Nginx)

Nginx is the entry point for all web traffic, directing HTTP/HTTPS paths to internal Docker network services. It handles routing and strips prefixes where necessary.

### Ports and Protocol Mapping
* **HTTP Port 80** handles WebSocket proxying for streaming connections:
  * `/clientstreamer` -> Proxies to `stream-to-client:8080/` (converts HTTP connection to WebSocket Upgrade).
  * `/wsbacktest` -> Proxies to `backtest-streamer:8085/` (historical tick websocket stream).
  * `/backtestapp/` -> Proxies to `backtest-app:80/` (stripping prefix).
  * `/backtest-ui/` -> Proxies to `backtest-ui:80/backtest-ui/`.
* **HTTPS Port 443** enforces SSL (using a self-signed cert) and handles secure REST and configuration endpoints:
  * `/logedin` -> Proxies to `upstock-login:80/` (OAuth callback endpoint).
  * `/backtest` -> Proxies to `backtest-client:80/` (Backtest execution trigger).
  * `/connectsocket` -> Proxies to `connect-upstox-web-socket:80/` (WebSocket connection control).
  * `/ltp` -> Proxies to `get-ltp:80/` (Last Traded Price query).
  * `/ohlc` -> Proxies to `get-ohlc:80/` (Open, High, Low, Close query).
  * `/fullmarketquote` -> Proxies to `get-fullmarketquote:80/`.
  * `/placeorder` -> Proxies to `placeorder:80/` (Order placing endpoint).
  * `/orderbook` -> Proxies to `get-orderbook:80/`.
  * `/fundsandmargin` -> Proxies to `get-funds-and-margin:80/`.
  * `/putcalloptionchain` -> Proxies to `get-put-call-option-chain:80/`.
  * `/optioncontracts` -> Proxies to `get-option-contracts:80/`.

---

## Trading Microservices

Each microservice is built using Node.js and Express, designed to perform a scoped action. They utilize the shared account module to query credentials and access tokens from Redis/MongoDB.

### 1. UpstoxLogin (`MicroServices/UpstoxLogin`)
* **Endpoint**: `GET /`
* **Flow**:
  * If no `code` is present in query parameters: redirects the user to Upstox's login dialgue (`https://api.upstox.com/v2/login/authorization/dialog`).
  * If `code` is present: posts the code to Upstox's token endpoint to exchange it for an access token.
  * Saves the access token into the MongoDB `credentials` collection (updating if client_id already exists) and writes it to Redis key `redis_upstox_access_token`.

### 2. ConnectWS-Upstox (`MicroServices/ConnectWS-Upstox`)
* **Endpoint**: `GET /?symbol=...`
* **Flow**:
  * Queries Redis for `redis_upstox_access_token`.
  * Opens a market data feed WebSocket to Upstox (`wss://api.upstox.com/v3/feed/market-data-feed`).
  * Decodes messages using the Protobuf schema `MarketDataFeed.proto`.
  * Publishes JSON-decoded feeds to Kafka topic `incoming-ws-msg`.

### 3. PlaceOrders (`MicroServices/Orders/placeOrders`)
* **Endpoint**: `POST /`
* **Flow**:
  * Receives payload: `{ symbol, price, quantity, type_of_order, strategy_details }`.
  * Checks mode:
    * If `strategy_details.strategy_mode === "LIVE"` and `strategy_details.isTest === false`, it places a real order on Upstox using the Upstox SDK's `OrderApi.placeOrder(...)`.
    * If `isTest === true` or `strategy_mode !== "LIVE"`, it delegates the execution to BackTestApp's REST API: `POST /backtestapp/api/trade` (maps to `triggerBackTestApp(body)`).
  * Publishes order summary to Kafka topic `order_details` via `storeOrderDetails(body, brokerResponse)`.
  * If in paper/backtest mode, updates Redis key `account_balance:${account_id}` with the closing balance returned by BackTestApp.

### 4. Market Quote Services (`MicroServices/market-quote/*`)
* **getLTP (`GET /?symbol=...`)**: Fetches the Last Traded Price from Upstox.
* **getOHLC (`GET /?symbol=...&interval=...`)**: Fetches Open, High, Low, Close data.
* **fullMarketQuote (`GET /?symbol=...`)**: Fetches detailed quotes (bids/asks, volume, open interest).

### 5. Option Chain Services (`MicroServices/Option-Chain/*`)
* **option-contracts (`GET /?symbol=...&expiry=...`)**: Returns list of option contracts filtered by expiration date.
* **put-call-option-chain (`GET /?symbol=...&expiry=...`)**: Returns strike-aligned Call and Put options with pricing and Greeks.

---

## Core Backend Application (BackTestApp)

BackTestApp acts as the main system ledger and controller, managing virtual balances, accounts, strategies, user logins, and transaction history.

### Database Models (MongoDB `backtest` Database)
1. **User**: IAM registration (stores name, username, email, salt/password hash, and MFA configurations).
2. **Account**: Stores trading account details (broker name, account name, virtual balance, margin multiplier, and commission rate).
3. **Strategy**: Stores registered strategy templates (name, description).
4. **Deployment**: Connects a Strategy to an Account and Symbol, holding status (`RUNNING`, `PAUSED`, `STOPPED`), execution mode (`LIVE`, `PAPER`, `BACKTEST`), speed, and backtest date.
5. **Trade**: Holds detailed records of executed trades (buy/sell price, fees, realized P&L, associated strategy, account, and symbol).
6. **Ledger**: Chronological ledger of financial operations (deposits, withdrawals, balance changes, and audit notes).

### Key Controllers and Core Services
* **`trade.js` (createTrade)**:
  * Initiates Mongoose sessions for multi-document ACID updates.
  * Deducts entry price + commissions from virtual accounts on buys; adds sales revenue and calculates realized P&L on sells.
  * Inserts Trade and Ledger records sequentially, preventing race conditions on shared account balances.
* **`deployment.js` (transitionDeployment)**:
  * Transitions deployment state machine (`start`, `stop`, `pause`, `resume`).
  * Triggers virtual backtests via a webhook call to `BacktestClient`.
  * Synchronizes deployment states to Redis keys `strategies:live:${symbol}` and `strategies:backtest:${symbol}` for StrategyChooserConsumer routing.

---

## Backtest User Interface (BackTestUI)

A responsive single-page application built on Vite, React, and TypeScript.

* **Routing Gateway**: Accessible at `/backtest-ui/`. Proxied through Nginx.
* **API Client (`api.ts`)**: Encapsulates fetch calls to `/backtestapp` with token authorization headers. Supports:
  * **Dynamic Server-side Filtering**: Endpoints like `listForAccount`, `listForDeployment`, and `listForSymbol` query MongoDB via specific REST paths to enforce scoped list rendering, satisfying strict anti-caching UI rules.
* **Real-time Charting**: Connects a WebSocket to `/backtestapp/ws` to consume and render live prices (`splited-live-data` stream).
