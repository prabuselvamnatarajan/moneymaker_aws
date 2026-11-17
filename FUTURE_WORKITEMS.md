<!--
  NOTE / INSTRUCTION FOR AGENTS & DEVELOPERS:
  MoneyMaker has zero active production customers.
  When any technical debt or workitem listed in this file is resolved and verified,
  REMOVE its corresponding entry from this document immediately.
  Once all technical debts listed here are fixed, DELETE this file entirely.
-->

# MoneyMaker — Future Workitems & Technical Debt Backlog

> [!IMPORTANT]
> **Zero Active Customers Policy**: MoneyMaker currently has zero active production customers. Developers and AI agents must NOT maintain or design for legacy backward-compatibility shims, obsolete database schemas, deprecated API aliases, dual implementation pathways, or transitional payload fallbacks.
>
> **Maintenance Instruction**: When any of the technical debts or workitems below is fixed, **remove its section from this file immediately**. When all listed debts are fixed, delete this file completely.

---

## 2. Decommission In-Strategy `candleBuilder.js`

- **Current State**:
  With the introduction of the centralized `timeframe-constructor` microservice, timeframe candles (`1m`, `3m`, `5m`, `15m`, etc.) are aggregated centrally and published as synchronized multi-timeframe snapshots on Kafka topics `timeframe_live_data` and `timeframe_backtest_data`. However, local in-process candle aggregation helpers still exist in:
  - `kafka/services/Strategies/MSB/candleBuilder.js`
  - `kafka/services/Strategies/msb_pts/candleBuilder.js`
- **Problem & Debt**:
  Keeping local candle builders inside individual strategy microservices leads to duplicate logic, dead code branches, and extra test surface area for deprecated paths.
- **Target Resolution**:
  1. Ensure all live and backtest deployment pipelines strictly route through `timeframe_live_data` / `timeframe_backtest_data`.
  2. Remove `buildTimeframeCandle` invocation and fallback branches from `kafka/services/Strategies/MSB/MSB.js` and `kafka/services/Strategies/msb_pts/MSB.js`.
  3. Delete `candleBuilder.js` and its associated unit test files (`__tests__/candleBuilder.test.js`) from both strategy packages.
- **Affected Files**:
  - `kafka/services/Strategies/MSB/candleBuilder.js`
  - `kafka/services/Strategies/MSB/__tests__/candleBuilder.test.js`
  - `kafka/services/Strategies/MSB/MSB.js`
  - `kafka/services/Strategies/msb_pts/candleBuilder.js`
  - `kafka/services/Strategies/msb_pts/__tests__/candleBuilder.test.js`
  - `kafka/services/Strategies/msb_pts/MSB.js`
- **Cleanup Action**: Remove this section once `candleBuilder.js` is deleted from all strategy directories.

---

## 3. Standardize Deployment Schema Exclusively on `timeframes: [String]`

- **Current State**:
  The `Deployment` model in `BackTestApp/src/models/deployment.js` maintains both singular `timeframe: String` (required) and plural `timeframes: [String]` (optional), alongside `data_mode: "tick" | "timeframe" | "hybrid"`.
- **Problem & Debt**:
  Consumer and strategy code must repeatedly execute fallback resolution (`dep.timeframes?.[0] || dep.timeframe || '1m'`) to cater to both fields.
- **Target Resolution**:
  1. Standardize `Deployment` schema in `BackTestApp` to make `timeframes: [String]` the single source of truth for requested candle intervals (defaulting to `['1m']`).
  2. Deprecate and drop the singular `timeframe` attribute from MongoDB schemas, API payloads, and frontend types.
  3. Simplify timeframe resolution in `StrategyChooserConsumer`, `Strategy.js`, and `deployment.js`.
- **Affected Files**:
  - `BackTest/BackTestApp/src/models/deployment.js`
  - `BackTest/BackTestApp/src/services/deployment.js`
  - `BackTest/BackTestApp/src/controllers/deployment.js`
  - `kafka/services/StrategyChooserConsumer/topicRoutingHelper.js`
  - `shared/strategy/Strategy.js`
- **Cleanup Action**: Remove this section once singular `timeframe` is removed from schema and code.

---

## 5. Consolidate `BackTestApp` Route Prefixing (Eliminate Dual Root & `/api` Mounting)

- **Current State**:
  `BackTest/BackTestApp/src/app.js` mounts Express routers at both `/` and `/api/` prefixes (e.g., `app.use('/auth', ...)` and `app.use('/api/auth', ...)`).
- **Problem & Debt**:
  Dual prefix mounting leads to routing ambiguities, prevents clean OpenAPI/Swagger specification generation, and complicates reverse proxy path rewrites.
- **Target Resolution**:
  1. Standardize all internal callers, microservices, tests, and frontend proxies on canonical `/api` prefixes.
  2. Remove root `/` duplicate router mounts from `BackTest/BackTestApp/src/app.js`.
- **Affected Files**:
  - `BackTest/BackTestApp/src/app.js`
  - `BackTest/BackTestApp/rules.md`
- **Cleanup Action**: Remove this section once root `/` prefix duplicates are eliminated.

---

## 6. Password Reset Token Delivery in `BackTestApp`

- **Current State**:
  In `BackTest/BackTestApp/src/controllers/auth.js`, password reset tokens are generated and logged via `console.log` in non-production environments (`// TODO: deliver token via email in production`), but no production email delivery service exists.
- **Problem & Debt**:
  In production mode, password reset requests succeed on the API but the user receives no email token, making password reset non-functional.
- **Target Resolution**:
  Implement production SMTP or transactional email delivery (e.g. AWS SES or Nodemailer) for password reset tokens, or implement administrative password reset.
- **Affected Files**:
  - `BackTest/BackTestApp/src/controllers/auth.js`
- **Cleanup Action**: Remove this section once email delivery or admin reset is implemented.

---

## 7. Migrate `liquidity_sweep` Strategy to Centralized Timeframe Snapshots

- **Current State**:
  In `kafka/services/Strategies/liquidity_sweep/modules/tickParser.js`, `parseTick` relies directly on raw vendor feeds with `feed.ltpc` and Upstox-specific `feed.marketOHLC` interval arrays (`ohlc1d: getOhlcByInterval(feed, '1d')`). Unlike `MSB` and `msb_pts`, it has not yet been updated to consume centralized timeframe snapshots from `timeframe_live_data` / `timeframe_backtest_data`.
- **Problem & Debt**:
  `liquidity_sweep` cannot currently benefit from centralized multi-timeframe construction or standardized vendor-agnostic snapshot slicing, and requires deployments to operate with `data_mode: "tick"`.
- **Target Resolution**:
  1. Update `kafka/services/Strategies/liquidity_sweep/modules/tickParser.js` to accept normalized timeframe snapshot objects (`msg.timeframes` and top-level `msg.ltp`).
  2. Use centralized timeframe candles for intraday levels and prior day references rather than vendor-specific `marketOHLC`.
  3. Add test coverage for snapshot-based execution in `liquidity_sweep/__tests__/`.
- **Affected Files**:
  - `kafka/services/Strategies/liquidity_sweep/modules/tickParser.js`
  - `kafka/services/Strategies/liquidity_sweep/LiquiditySweep.js`
  - `kafka/services/Strategies/liquidity_sweep/__tests__/`
- **Cleanup Action**: Remove this section once `liquidity_sweep` natively consumes timeframe snapshots.

---

## 8. Unify Raw Tick Kafka Topic Naming (`splited-live-data` -> `live_data`)

- **Current State**:
  Historically, the Kafka topic produced by `wsDataSplitterConsumer` was named `splited-live-data` (including a typographical error "splited"). All architectural documentation and recent specifications refer to this base tick stream as `live_data`.
- **Problem & Debt**:
  Drift between documentation (`live_data`) and legacy configuration (`splited-live-data`) requires dual topic configurations and mapping aliases in Docker/Kubernetes environment variables.
- **Target Resolution**:
  1. Standardize `wsDataSplitterConsumer` default output topic to `live_data`.
  2. Update consumers (`timeframe-constructor`, `StrategyChooserConsumer`, `positionTrackerConsumer`, `storerConsumer`, `websocketService`) to consume `live_data`.
  3. Align environment variables across `docker-compose.yml` and `k8s/` manifests.
- **Affected Files**:
  - `kafka/services/wsDataSplitterConsumer/batchSplitter.js`
  - `docker-compose.yml`
  - `k8s/base/consumers/`
  - `system_flows/`
- **Cleanup Action**: Remove this section once `splited-live-data` is renamed across the stack.

---

