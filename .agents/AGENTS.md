# Project Guidelines & Rules

- **No Legacy Compatibility Mandate (Zero Active Production Customers)**: MoneyMaker currently has zero active customers in production. Developers and AI agents MUST NOT create, maintain, or design for legacy backward-compatibility shims, obsolete database schemas, deprecated API aliases, dual implementation pathways, or transitional payload fallbacks. Redundant or obsolete code paths must be aggressively pruned rather than preserved for backward compatibility. Always prefer clean, direct, modern implementations.
- **No Hardcoded Absolute Host Paths**: NEVER hardcode local host absolute machine paths (e.g., `/home/prabu/...`, `/Users/...`, `C:\Users\...`) in application source code, Docker configuration files, scripts, mount bindings, or fallback logic. Always use dynamic paths, environment variables (e.g., `process.env.SHARED_DIR`), or relative paths from `process.cwd()`.
- **Fail Loud & Fast On Errors**: NEVER use silent fallbacks or hardcoded local directory fallback chains that mask underlying path configuration or container mount failures. If a required service, file, directory, or mount binding is missing or fails, throw an explicit, descriptive error immediately (fail loud) so that deployment or container configuration issues in production or IDC environments are surfaced right away.
- **Timeframe Candle Architecture**: Strategy breakout & structure signals (e.g. MSB) MUST evaluate exclusively on finalized closed candles (`closedCandle` emitted on timeframe bucket rollover). Intra-bar tick updates (`formingCandle`) MUST NOT evaluate structure breakout signals or trigger new entry orders. Real-time position risk management (Target & Stop-Loss points/percentage) MUST evaluate on every tick (`ltp`) continuously without waiting for candle completion.
- **Centralized Timeframe Processing Framework**: Timeframe candles (`1m`, `3m`, `5m`, `15m`, etc.) are aggregated centrally in `timeframe-constructor` from raw ticks and published as synchronized multi-timeframe snapshots to `timeframe_live_data`. `StrategyChooserConsumer` dynamically slices snapshots to match each tenant deployment's requested timeframes from Redis (`timeframes` / `data_mode`). Strategies evaluate real-time risk on tick `ltp` and breakout signals on `closedCandle`.
- **Comprehensive Test Coverage & Quality**: Every service, microservice, consumer, strategy, script, and feature MUST maintain comprehensive unit and integration/e2e tests covering all normal flows, boundary conditions, edge cases (e.g. malformed payloads, network disconnects, null/missing fields, duplicate executions, concurrent requests, out-of-order data, auth and RBAC boundaries, fail-loud triggers). New or modified functionality MUST include corresponding test cases in its designated test suite before shipping to prevent regressions and ensure backward compatibility.
- **Test Real Codebase Only (No Self-Testing or Duplicate Logic)**: All test cases MUST directly import, execute, and assert against the actual production code, functions, services, and modules in the codebase. Tests MUST NEVER re-declare, copy-paste, or mirror production business logic as local functions inside the test suite ("self-testing"). If a function or logic is not currently exported or accessible for testing, refactor the production code to export pure helper functions or modularize components so that the test suite executes the real implementation. Tests must run and pass both locally and inside their respective Docker container images (`scripts/run-image-unit-tests.sh`), catching regressions in genuine production logic.

## Future Workitems & Technical Debt Backlog

See [FUTURE_WORKITEMS.md](file:///home/prabu/.gemini/antigravity-cli/worktrees/MoneyMaker%20GitLab%20AWS/tick_timeframe_code_flow/FUTURE_WORKITEMS.md) for full descriptions, affected files, and target solutions.

> [!NOTE]
> **Maintenance Instruction**: When any technical debt or workitem is fixed, remove its corresponding entry from [FUTURE_WORKITEMS.md](file:///home/prabu/.gemini/antigravity-cli/worktrees/MoneyMaker%20GitLab%20AWS/tick_timeframe_code_flow/FUTURE_WORKITEMS.md) immediately. Once all debts are resolved, delete `FUTURE_WORKITEMS.md`.

The following workitems represent planned technical debt cleanup and modernizations permitted by the Zero Active Customers mandate:

1. **Unified Trade Ingestion (`placeOrders` -> `/trades`)**:
   - `MicroServices/Orders/placeOrders` (`dependency.js:triggerBackTestApp`) currently calls `POST /api/trade` on `BackTestApp` using `X-Service-Token`.
   - *Action*: Update `placeOrders` to use the authenticated `/trades` (or `/api/trades`) endpoint directly with service-token authentication, then remove the unauthenticated legacy `/api/trade` route and its backward-compatibility handler from `BackTestApp/src/routes/tradeRoute.js` and `BackTestApp/src/controllers/trade.js`.

2. **Decommission In-Strategy `candleBuilder.js`**:
   - With `timeframe-constructor` centrally aggregating raw ticks into multi-timeframe candles on `timeframe_live_data` / `timeframe_backtest_data`, individual strategy microservices (`MSB`, `msb_pts`) no longer need local in-process candle building.
   - *Action*: Once all backtest and live pipelines exclusively stream timeframe snapshots, remove `candleBuilder.js` and its local tests from `kafka/services/Strategies/MSB/` and `kafka/services/Strategies/msb_pts/`.

3. **Standardize Deployment Schema on `timeframes: [String]`**:
   - The `Deployment` model in `BackTestApp` maintains both singular `timeframe: String` and plural `timeframes: [String]`.
   - *Action*: Deprecate the singular `timeframe` field entirely in favor of `timeframes: [String]` and `data_mode: "tick" | "timeframe" | "hybrid"`, removing fallback resolution logic across `StrategyChooserConsumer`, `Strategy.js`, and `deployment.js`.

4. **Remove Legacy State Migrations in Strategies**:
   - In `kafka/services/Strategies/msb_pts/MSB.js`, legacy state fields (`lastBuyPrice`, `lastSellPrice`) are kept alongside `position: { direction, entryPrice }` for historical state recovery (`TC-MPT-003`).
   - *Action*: Simplify state structure to only use `position`, removing `lastBuyPrice` / `lastSellPrice` backfills.

5. **Consolidate `BackTestApp` Route Prefixing**:
   - `BackTestApp/src/app.js` mounts routes at both `/` and `/api/` prefixes for backward compatibility.
   - *Action*: Standardize all internal callers, tests, and frontend proxies on the `/api` prefix and remove dual mounting at root `/`.
