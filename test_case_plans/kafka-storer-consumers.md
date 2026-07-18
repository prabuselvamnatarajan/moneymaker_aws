# Kafka: `price-storer-consumer` & `order-storer-consumer` — Test Case Plan

## Scope
Both services run the identical `storerConsumer.js` image (`storer-consumer:latest`) with different env configuration: `price-storer-consumer` reads `splited-live-data` and writes to Mongo database `stock_database` (one collection per symbol); `order-storer-consumer` reads `order_details` topic and writes to Mongo database `order_details` (one collection per instrument_token). Both use `async-retry` around the Mongo insert.

## Prerequisites
- MongoDB replica set reachable
- Kafka topics `splited-live-data` and `order_details` produceable
- Ability to inspect Mongo collection lists per target database

## Test Cases

### Core Storage — price-storer-consumer

#### TC-STG-001: Live tick is stored in a per-symbol Mongo collection
- **Category**: Functional
- **Priority**: P0
- **Steps**: Publish a tick keyed `RELIANCE` to `splited-live-data`
- **Expected Result**: A document is inserted into `stock_database.RELIANCE` collection with `{timestamp: <now>, ...tickData}`.

#### TC-STG-002: Each distinct symbol creates its own new collection on first tick
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish first-ever ticks for 3 new symbols
- **Expected Result**: 3 new collections auto-created in `stock_database` (MongoDB auto-creates collections on first insert); no pre-provisioning required.

#### TC-STG-003: `timestamp` field is server-side generated, not trusted from the tick payload
- **Category**: Functional
- **Priority**: P2
- **Steps**: Publish a tick with its own embedded `timestamp` field that differs from wall-clock time
- **Expected Result**: The stored document's top-level `timestamp` is `new Date()` at insert time, overriding/coexisting with (not derived from) any tick-embedded timestamp field — verify no field name collision if the tick payload itself also has a `timestamp` key (spread order: `{timestamp: new Date(), ...data}` means `data.timestamp`, if present, WINS since it's spread after — confirm this precedence explicitly).

### Core Storage — order-storer-consumer

#### TC-STG-004: Order detail message is stored keyed by `instrument_token`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Publish an order-audit message to `order_details` topic keyed by `instrument_token`
- **Expected Result**: Document inserted into `order_details.<instrument_token>` collection.

#### TC-STG-005: Per-instrument collection fragmentation makes cross-cutting order queries impossible
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #68
- **Steps**: Place orders across 500 distinct instruments; attempt to answer "show me all orders in the last hour across all instruments"
- **Expected Result** (current bug): There is no single `orders` collection — the only way to answer this query is enumerating and querying all 500+ per-instrument collections individually (`db.listCollections()` + fan-out), which is impractical for audit/compliance reporting and causes unbounded collection-count growth in the `order_details` database over time (contrast with `price-storer`, where per-symbol fragmentation is a reasonable design for tick data, but is inappropriate for order audit records).

#### TC-STG-006: Extremely high instrument-token cardinality causes MongoDB collection-count pressure
- **Category**: Performance / Regression
- **Priority**: P2
- **Related Issue**: #68
- **Steps**: Simulate order activity across thousands of distinct instrument tokens over time (e.g., options with many strikes/expiries)
- **Expected Result**: Collection count in `order_details` DB grows unbounded; verify whether this approaches MongoDB's practical per-database collection limits or degrades `listCollections`/backup performance at scale.

### Retry Behavior

#### TC-STG-007: Transient Mongo write failure is retried up to 5 times
- **Category**: Functional
- **Priority**: P1
- **Steps**: Simulate a transient Mongo write error (e.g., brief replica-set failover) during `storeInMongoDB`
- **Expected Result**: `async-retry` (5 retries, 1s min timeout) retries the insert; succeeds once Mongo recovers within the window; no duplicate insert occurs since only the DB write itself is retried (no side-channel like the wsDataSplitter's dual-write issue) — verify no double-insert if the first attempt partially succeeded (Mongo insert is normally atomic per-document, so this should be safe, but confirm).

#### TC-STG-008: All 5 retries exhausted triggers fatal error handling
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate sustained Mongo unavailability across all retry attempts
- **Expected Result**: Error escalates to `handleFatalError(error, 'message handling')` after retries exhaust — verify this crashes the specific replica (Swarm restarts it) rather than silently dropping the tick/order forever; assess data-loss risk for ticks/orders during a prolonged Mongo outage exceeding the retry budget.

### Malformed Input

#### TC-STG-009: Non-JSON message value causes `JSON.parse` to throw, routed to fatal handler
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish a malformed (non-JSON) message to either topic
- **Expected Result**: Parse error caught by `eachMessage`'s try/catch → `handleFatalError('message handling')`.

#### TC-STG-010: Message with no key (`message.key` null) 
- **Category**: Negative
- **Priority**: P2
- **Steps**: Publish a message to `splited-live-data`/`order_details` with a null key
- **Expected Result**: `message.key.toString()` throws a TypeError on null — verify this crash path is handled the same way as other malformed-input cases, and whether producers upstream can realistically ever omit the key (both `wsDataSplitterConsumer` and `placeOrders`/order paths always set a key — confirm this invariant holds end-to-end).

### Scaling & Consumer Groups

#### TC-STG-011: Both services run 3 replicas under distinct consumer groups (`storer-group` vs `order_storer_group`)
- **Category**: Functional
- **Priority**: P2
- **Steps**: Verify `TARGET_GROUP_ID` differs between the two deployments despite sharing the same image
- **Expected Result**: No cross-interference between price and order storage consumer groups; each independently manages its own offsets on its own topic.

#### TC-STG-012: MongoDB connection retry on startup before Kafka connection
- **Category**: Functional
- **Priority**: P2
- **Related Issue**: #5
- **Steps**: Start the service with Mongo temporarily unreachable
- **Expected Result**: `connectWithRetry(client, 'MongoDB Client')` blocks/retries (30 attempts, 5s delay) BEFORE the Kafka consumer even attempts to connect — confirms Mongo readiness is a hard prerequisite; verify total worst-case startup delay (up to 150s for Mongo + 150s for Kafka) doesn't exceed any external orchestration health-check timeout.

### Environment Configuration Sanity

#### TC-STG-013: `TARGET_COLLECTION_NAME` env var actually controls the Mongo *database* name, not collection
- **Category**: Regression (naming confusion)
- **Priority**: P2
- **Steps**: Inspect `client.db(TARGET_COLLECTION_NAME)` usage vs. the env var's name
- **Expected Result**: Confirm the env var is misleadingly named — `TARGET_COLLECTION_NAME` (`stock_database` / `order_details` per compose) is actually used as the **database** name (`client.db(...)`), while the actual collection name is derived dynamically from the Kafka message key (symbol/instrument_token). Flag as a documentation/naming clarity issue, not a functional bug.
