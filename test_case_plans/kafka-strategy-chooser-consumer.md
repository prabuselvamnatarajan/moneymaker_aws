# Kafka: `strategy-chooser-consumer` — Test Case Plan

## Scope
Consumes ticks from `splited-live-data` (live) and `backtest-stream-data` (backtest) topics, looks up which strategies are actively watching each symbol (via `getStrategiesForSymbol` Redis lookup against `strategies:live:<symbol>`/`strategies:backtest:<symbol>` keys maintained by BackTestApp's `syncAllDeploymentsToRedis`), and fans out a per-strategy message to `<strategyName>_backtest_data` or `<strategyName>_live_data` topics. This is the routing layer between raw ticks and strategy execution containers.

## Prerequisites
- Redis populated with `strategies:live:<symbol>` / `strategies:backtest:<symbol>` JSON entries (via BackTestApp deployment sync)
- Kafka topics for at least one strategy (e.g., `msb_live_data`, `msb_backtest_data`, `liquidity_sweep_live_data`)
- Ability to inspect consumer group `strategy_chooser_group` lag/assignment

## Test Cases

### Live Routing

#### TC-SCC-001: Live tick fans out to every active strategy watching that symbol
- **Category**: Functional
- **Priority**: P0
- **Steps**: Two deployments (different strategies) both watch symbol RELIANCE in LIVE mode; publish a tick to `splited-live-data` keyed `RELIANCE`
- **Expected Result**: Two messages produced — one to `<strategyA>_live_data`, one to `<strategyB>_live_data` — each carrying `strategy_details` cloned from the respective Redis entry and `isTest:false`.

#### TC-SCC-002: PAPER-mode live deployment routes to the `_backtest_data`-suffixed topic (isTest semantics)
- **Category**: Functional
- **Priority**: P1
- **Steps**: A deployment with `strategy_mode:"PAPER"` (which BackTestApp marks `isTest:true` in its Redis sync) is active on a symbol; publish a live tick
- **Expected Result**: Message routes to `<strategyName>_backtest_data` (not `_live_data`) since `isTest` is true for PAPER — confirms PAPER trades share the "test" topic naming convention with actual backtests, purely based on the `isTest` flag, not the Kafka source topic.

#### TC-SCC-003: No active strategies for a symbol produces no output
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish a tick for a symbol with zero Redis-registered active strategies
- **Expected Result**: `getStrategiesForSymbol` returns an empty array; `Promise.all([])` resolves immediately with no messages produced, no error.

#### TC-SCC-004: Strategy data is cloned per-strategy to avoid mutation races
- **Category**: Regression (positive control)
- **Priority**: P2
- **Steps**: Two strategies active on the same symbol; inspect the two produced messages
- **Expected Result**: Each message's `strategy_details` is an independent clone (`{...strategy}`) — mutating one (`isTest` flag set) does not affect the other, even though `Promise.all` executes concurrently.

### Backtest Routing & Isolation

#### TC-SCC-005: Backtest tick is filtered to only the deployment matching its `deployment_id`
- **Category**: Functional / Security
- **Priority**: P0
- **Steps**: Two different BACKTEST deployments (different `deployment_id`) are active for the same symbol; publish a `backtest-stream-data` tick carrying `deployment_id:"A"`
- **Expected Result**: Only the strategy entry whose `deployment_id === "A"` receives a routed message; the other deployment's strategy entry is filtered out entirely — confirms backtest isolation between concurrent deployments on the same symbol.

#### TC-SCC-006: Stale backtest message with mismatched `run_id` is discarded
- **Category**: Regression
- **Priority**: P1
- **Steps**: A deployment was restarted, producing a new `backtest_run_id` in its Redis entry; publish a backtest tick carrying the OLD `run_id` for the same `deployment_id`
- **Expected Result**: `filteredStrategies` excludes the entry (logged as "Discarding stale backtest message") since `data.run_id !== strategy.backtest_run_id` — protects against ticks from a previous/aborted backtest run leaking into the current run.

#### TC-SCC-007: Backtest tick with no `deployment_id` on the message is NOT filtered
- **Category**: Negative
- **Priority**: P2
- **Steps**: Publish a `backtest-stream-data` tick with no `deployment_id` field
- **Expected Result**: The `if (isBackTest && data.deployment_id)` guard is skipped entirely (falsy `data.deployment_id`) — ALL active backtest strategies for that symbol receive the message unfiltered; verify whether this is an intentional fallback or a gap allowing unintended fan-out.

#### TC-SCC-008: Backtest ticks always route with `isTest:true` regardless of the strategy's own `isTest` flag
- **Category**: Functional
- **Priority**: P2
- **Steps**: Inspect `isTestMode = isTest || isBackTest` — for any message arriving on the backtest topic, confirm the produced message always uses `_backtest_data` topic and `isTest:true`.
- **Expected Result**: Confirmed — `isBackTest` alone is sufficient to force test-topic routing even if the Redis-cached `isTest` flag were somehow `false`.

### No-Retry Produce Failure (Critical Gap)

#### TC-SCC-009: Transient `producer.send()` failure has zero retry — kills the entire consumer
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #69
- **Steps**: Simulate a transient Kafka broker unavailability (e.g., mid-leader-election) precisely during a `producer.send()` call inside the per-strategy `Promise.all`
- **Expected Result** (current bug): Unlike `wsDataSplitterConsumer`/`storerConsumer`, no `async-retry` wraps this `producer.send()` call — the rejection propagates up through `Promise.all` to the outer `catch`, invoking `handleFatalError(error, 'message handling')` → likely `process.exit(1)`. A single transient produce failure kills the ENTIRE strategy-router replica (and by extension, since the topic likely has 1 partition per issue #54, potentially the only replica actively receiving messages), stopping strategy routing for every symbol/strategy until Swarm restarts the container.
- **Notes**: Contrast directly with `kafka-wsdatasplitter-consumer.md` TC-WDS-005/006 which DO retry.

#### TC-SCC-010: One strategy's produce failure in a multi-strategy fan-out aborts the whole batch (no partial delivery)
- **Category**: Regression
- **Priority**: P1
- **Steps**: Symbol has 2 active strategies; force `producer.send()` to fail only for the second strategy's message
- **Expected Result**: Because both sends are inside the same `Promise.all(filteredStrategies.map(...))`, a rejection from one aborts visibility into whether the other succeeded from the caller's perspective — the whole `eachMessage` handler throws, triggering fatal error handling even though strategy 1's message may have already been sent successfully (no compensating rollback, but also no idempotent-retry — inconsistent partial state).

### Redis Lookup Behavior

#### TC-SCC-011: `getStrategiesForSymbol` Redis lookup failure is not independently handled
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate Redis unavailability during `getStrategiesForSymbol` call
- **Expected Result**: Error propagates to the outer catch → `handleFatalError` — same fatal-crash behavior as the produce-failure case; verify whether Redis flakiness alone (unrelated to Kafka) can also take down this consumer.

#### TC-SCC-012: Symbol key casing consistency between tick `key` and Redis lookup
- **Category**: Functional
- **Priority**: P2
- **Steps**: Publish a tick keyed with lowercase symbol (`reliance`) when Redis strategy entries are keyed uppercase (`RELIANCE`)
- **Expected Result**: Verify `getStrategiesForSymbol`'s exact key format expectations — a casing mismatch would silently produce zero matched strategies (no ticks routed), a subtle no-op failure mode worth explicit regression coverage.

### Consumer Group / Topics

#### TC-SCC-013: Consumer correctly subscribes to both `TARGET_TOPIC` entries (comma-separated env parsing)
- **Category**: Functional
- **Priority**: P2
- **Steps**: Verify `TARGET_TOPIC: splited-live-data,backtest-stream-data` env var parsing subscribes to exactly two topics
- **Expected Result**: Both topics show up in the consumer group's subscription; messages from either are processed by the same `eachMessage` handler with `isBackTest` correctly distinguishing them via `topic === BACKTEST_TOPIC`.

#### TC-SCC-014: `BACKTEST_TOPIC` env override changes which topic is treated as backtest
- **Category**: Functional
- **Priority**: P2
- **Steps**: Change `BACKTEST_TOPIC` to a nonstandard value not in `TARGET_TOPIC`
- **Expected Result**: No topic ever matches `isBackTest`; all consumed messages treated as live — confirms tight coupling between the two env vars that must be kept consistent.
