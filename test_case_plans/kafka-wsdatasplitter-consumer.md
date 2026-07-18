# Kafka: `wsdatasplitter-consumer` — Test Case Plan

## Scope
Consumes raw multi-symbol tick batches from topic `incoming-ws-msg` (produced by `ConnectWS-Upstox`), splits each batch into per-symbol messages, republishes each to Kafka topic `splited-live-data` (keyed by symbol) AND publishes the same payload to a Redis pub/sub channel (`${LIVE_PREFIX}:${symbol}`) for real-time UI consumption. Runs with 3 replicas, consumer group `WS_data_splitter`.

## Prerequisites
- Kafka brokers, Redis reachable
- A producer capable of publishing a synthetic multi-symbol JSON payload to `incoming-ws-msg`
- A Kafka consumer client subscribed to `splited-live-data` and a Redis subscriber on `live:<symbol>` for verification
- `REDIS_URL`, `LIVE_PREFIX` (default `live`), `KAFKA_BROKERS` configured

## Test Cases

### Core Splitting & Fan-out

#### TC-WDS-001: Multi-symbol batch is split into one Kafka message per symbol
- **Category**: Functional
- **Priority**: P0
- **Steps**: Publish `{RELIANCE:{...tick...}, TCS:{...tick...}}` to `incoming-ws-msg`
- **Expected Result**: Two separate messages produced to `splited-live-data`, each keyed by the respective symbol (`key=RELIANCE`, `key=TCS`), each `value.symbol_name` set to the symbol.

#### TC-WDS-002: Each symbol is also published to its own Redis channel
- **Category**: Functional
- **Priority**: P0
- **Steps**: Same as above; subscribe to `live:RELIANCE` and `live:TCS` beforehand
- **Expected Result**: Both channels receive the JSON-stringified tick payload matching what was sent to Kafka.

#### TC-WDS-003: Latency metadata attached before split
- **Category**: Functional
- **Priority**: P2
- **Steps**: Inspect produced message's `value.latency.beforeSplit`
- **Expected Result**: `calculateLatency(key, value)` populates a numeric latency figure based on the tick's embedded timestamp vs. processing time.

#### TC-WDS-004: Symbol names containing single quotes are sanitized in the Redis channel name
- **Category**: Functional
- **Priority**: P2
- **Steps**: Use a symbol key containing a `'` character (if realistically possible from upstream) and observe the resulting channel name
- **Expected Result**: `redisPublishChannel` strips `'` characters (`key.replace(/'/g, "")`) before use.

### Retry & Duplicate-Message Risk

#### TC-WDS-005: Transient Kafka produce failure is retried, then Redis publish succeeds — no duplication
- **Category**: Functional
- **Priority**: P1
- **Steps**: Simulate a single transient Kafka broker blip that resolves within the retry window; observe outcome
- **Expected Result**: `async-retry` (5 retries, 1s min timeout) retries the *entire* block (Kafka send + Redis publish) until both succeed; exactly one successful Kafka message and one Redis publish result once the retry succeeds.

#### TC-WDS-006: Kafka produce succeeds but Redis publish fails — retry duplicates the Kafka message
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #63
- **Steps**: Simulate Redis being unreachable (or `redisPubSub.publish` throwing) while Kafka producer is healthy, for a single incoming symbol tick; monitor both the Kafka topic and Redis channel across the 5 retry attempts
- **Expected Result** (current bug): Because `producer.send()` and `redisPubSub.publish()` are wrapped together inside a single `retry(...)` block, the first attempt's Kafka send succeeds but throws on the Redis publish, triggering a retry that RE-SENDS the same tick to Kafka. Confirm the `splited-live-data` topic ends up with duplicate messages (same key, same value) for a single upstream tick once Redis recovers or the retries exhaust.
- **Notes**: Downstream consumers (`StrategyChooserConsumer`) will process the duplicate tick twice, potentially firing duplicate BUY/SELL signals — verify this cascades by checking `strategy_chooser_group` behavior in a follow-up integration test.

#### TC-WDS-007: All 5 retries exhausted (both Kafka and Redis persistently failing) triggers fatal error handling
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate sustained failure of both Kafka and Redis for a full symbol's processing
- **Expected Result**: After 5 failed attempts, the error propagates to the outer `catch`, invoking `handleFatalError(error, 'message processing')` — verify actual behavior (process exit vs. logged-and-continue) per `kafkaErrorHandler.js`.

#### TC-WDS-008: A fresh Kafka producer is created and connected per incoming batch message
- **Category**: Performance
- **Priority**: P2
- **Steps**: Inspect `processAndProduceMessages` — a new `kafka.producer()` is instantiated and `connectWithRetry`'d on every call
- **Expected Result**: Confirm the producer is properly disconnected in the `finally` block after each batch; assess connection churn overhead under high message-batch throughput (each incoming Kafka message triggers a full producer connect/disconnect cycle).

### Malformed Input

#### TC-WDS-009: Malformed (non-JSON) message on `incoming-ws-msg` triggers fatal error handling, not silent drop
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish a non-JSON string to `incoming-ws-msg`
- **Expected Result**: `JSON.parse` throws; caught by the `eachMessage` try/catch, routed to `handleFatalError(error, 'message handling')` — verify whether this crashes the consumer replica (potential availability impact vs. graceful skip-and-continue).

#### TC-WDS-010: Empty object `{}` as message value produces no downstream messages
- **Category**: Negative
- **Priority**: P2
- **Steps**: Publish `{}` to `incoming-ws-msg`
- **Expected Result**: `Object.entries({})` is empty; loop body never executes; no Kafka/Redis output, no error.

### Consumer Group / Scaling

#### TC-WDS-011: 3 replicas share the consumer group and process disjoint partitions
- **Category**: Functional
- **Priority**: P1
- **Steps**: With `wsdatasplitter-consumer` scaled to 3 replicas, produce many messages to `incoming-ws-msg` and observe distribution across replica logs
- **Expected Result**: Standard Kafka consumer-group partition assignment applies; cross-reference with `infrastructure-docker-compose.md` TC-INF-012 regarding the topic's actual partition count possibly limiting effective parallelism to 1 replica if RF/partition defaults (#54) are in effect.

#### TC-WDS-012: Consumer crash triggers `registerKafkaCrashHandler` and container restart
- **Category**: Negative
- **Priority**: P1
- **Steps**: Force the underlying kafkajs consumer to emit a `CRASH` event (e.g., disconnect the broker mid-session past retry budget)
- **Expected Result**: `registerKafkaCrashHandler(consumer)` reacts appropriately (process exit) so Swarm's `restart_policy: condition: any` cycles the container; verify logs show the crash reason clearly for observability.

### Startup / Connectivity

#### TC-WDS-013: Consumer retries connecting to Kafka/Redis on startup with backoff (30 attempts, 5s delay)
- **Category**: Functional
- **Priority**: P1
- **Related Issue**: #5
- **Steps**: Start the service before Kafka brokers are ready; observe startup logs
- **Expected Result**: `connectWithRetry` logs warnings and retries up to 30 times at 5s intervals before throwing `Failed to connect to ... after maximum retries` — verify this retry budget is sufficient to outlast typical broker election delays in the Swarm deployment scenario described in issue #5.

#### TC-WDS-014: Redis PubSub connects before the Kafka consumer is created
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trace `startServer()` execution order
- **Expected Result**: `redisPubSub` connects first, then `createConsumer()` runs; a Redis outage at startup blocks the whole service from ever subscribing to Kafka (fail-fast rather than partial degradation).
