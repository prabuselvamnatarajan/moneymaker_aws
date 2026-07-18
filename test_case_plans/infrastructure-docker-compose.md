# Docker Compose / Swarm Deployment — Test Case Plan

## Scope
Covers the `docker-compose.yml` stack (33+ services) deployed via `docker stack deploy` (Swarm) or `docker-compose up`: Zookeeper, 3 Kafka brokers, 3-node Mongo replica set, Redis, all Kafka consumers, all REST microservices, reverse proxy, and scheduled services. Focuses on startup ordering, networking, volumes, replication/partitioning, and build/deploy correctness.

## Prerequisites
- Docker Swarm initialized (`docker swarm init`) or Docker Compose v2 installed
- Access to `build-all.sh` and `scripts/copy_shared.sh`
- Ability to inspect running containers/services (`docker service ls`, `docker stack ps`, `docker logs`)
- A multi-node Swarm cluster (manager + ≥1 worker) for placement/volume tests

## Test Cases

### Startup Ordering & Health

#### TC-INF-001: Full stack cold start via `docker-compose up`
- **Category**: Functional
- **Priority**: P0
- **Preconditions**: No containers running; images built
- **Steps**: Run `docker-compose up -d`; observe service start order and logs
- **Expected Result**: Kafka-dependent consumers eventually connect once brokers are ready (compose respects `depends_on` ordering)
- **Notes**: This path works because plain `docker-compose up` honors `depends_on`.

#### TC-INF-002: Cold start via `docker stack deploy` (Swarm) — race condition
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #5
- **Preconditions**: Swarm initialized
- **Steps**: `docker stack deploy --compose-file docker-compose.yml moneymaker`; immediately tail logs of `wsdatasplitter-consumer`, `strategy-chooser-consumer`, `price-storer-consumer`
- **Expected Result** (current buggy behavior): Consumers crash-loop with Kafka connection errors before brokers finish leader election, since Swarm does not honor `depends_on` ordering and no healthcheck/`condition: service_healthy` exists
- **Notes**: Verify `restart_policy: condition: any` masks the failures via repeated restarts; count restarts in first 2 minutes.

#### TC-INF-003: No healthcheck block defined for Kafka brokers
- **Category**: Negative
- **Priority**: P1
- **Related Issue**: #5
- **Steps**: `docker inspect` each `kafka-broker-*` container; check `State.Health`
- **Expected Result**: No `Health` field present (no healthcheck configured) — confirms gap
- **Notes**: Proposed fix is adding `healthcheck:` + `condition: service_healthy`.

#### TC-INF-004: Consumer recovers after delayed broker availability
- **Category**: Functional
- **Priority**: P1
- **Steps**: Start Kafka brokers with an artificial delay (e.g., stop/start), then start a consumer service
- **Expected Result**: kafkajs retry/backoff eventually connects if retry budget outlasts broker election; verify exact failure if election takes longer than kafkajs's bounded retry budget

### Build & Image Correctness

#### TC-INF-005: Direct `docker build` on a Kafka service directory without `copy_shared.sh`
- **Category**: Negative
- **Priority**: P0
- **Related Issue**: #13
- **Steps**: `cd kafka/services/wsDataSplitterConsumer && docker build .` without running `scripts/copy_shared.sh` first
- **Expected Result**: Build fails — `./redis_operations` does not exist in directory context
- **Notes**: Confirms CI must call `copy_shared.sh`/`build-all.sh`, not raw `docker build`.

#### TC-INF-006: `build-all.sh` produces runnable images for all services
- **Category**: Functional
- **Priority**: P0
- **Steps**: Run `./build-all.sh` from repo root; then `docker-compose up`
- **Expected Result**: All images build successfully and containers start without `Cannot find module` errors

#### TC-INF-007: Swarm worker node without repo checkout — bind mount shadows baked code
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #13
- **Preconditions**: Multi-node Swarm; worker node has no local copy of repo (or an empty `./appInit/redis_operations` path)
- **Steps**: Deploy stack so a Kafka consumer replica is scheduled on the worker node; inspect container's `/app/redis_utils/redis_operations`
- **Expected Result** (bug): Directory is empty on the worker (bind mount shadows the image-baked files), causing `Cannot find module` crash at runtime
- **Notes**: Validates root cause distinct from build-time issue — this is a *runtime* volume mount problem even with correct images.

#### TC-INF-008: Plain REST microservices (no shared code) build independently
- **Category**: Functional
- **Priority**: P2
- **Steps**: Build `MicroServices/Orders/placeOrders` etc. directly without shared-code copy step
- **Expected Result**: Builds succeed since these services declare zero shared code at build time (per audit); confirm no hidden shared imports were missed

### Networking / Segmentation

#### TC-INF-009: All services share single flat `app-net` network
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #52
- **Steps**: From within a low-trust container (e.g., `get-ltp`), attempt to reach MongoDB (`mongo1:27017`), Redis (`redis:6379`), Kafka (`kafka-broker-1:9092`), `mongo-express:8081`, `redisinsight:8001`
- **Expected Result** (current insecure behavior): All connections succeed — no network segmentation exists despite `docker_and_stack.md` documenting `shared-net`/`kafka-net` isolation
- **Notes**: Regression check once network splitting fix is applied — reachability should then be restricted per service tier.

#### TC-INF-010: `attachable: true` on overlay network allows ad-hoc container attach
- **Category**: Security
- **Priority**: P2
- **Steps**: `docker run --network app-net ...` an unrelated container and probe internal services
- **Expected Result**: Currently succeeds (attachable overlay); flag as hardening gap.

### Kafka Topic Configuration

#### TC-INF-011: Auto-created application topics get default 1 partition / RF 1
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #54
- **Steps**: Delete all topics (fresh cluster); start producers/consumers that rely on auto-create (e.g., `splited-live-data`); inspect topic via `kafka-topics.sh --describe`
- **Expected Result** (bug): Topic created with `PartitionCount:1 ReplicationFactor:1` — no `KAFKA_CFG_DEFAULT_REPLICATION_FACTOR`/`KAFKA_CFG_NUM_PARTITIONS` set
- **Notes**: Only internal offsets topic gets RF 3 via `KAFKA_CFG_OFFSETS_TOPIC_REPLICATION_FACTOR`.

#### TC-INF-012: Idle consumer replicas due to single partition
- **Category**: Performance
- **Priority**: P1
- **Related Issue**: #54
- **Steps**: With `wsdatasplitter-consumer` at `replicas: 3` and topic at 1 partition, produce a burst of messages and observe per-replica consumption via consumer group describe (`kafka-consumer-groups.sh --describe --group ...`)
- **Expected Result**: Only 1 of 3 replicas is assigned the single partition and processes messages; 2 replicas sit idle — confirms wasted capacity and no parallelism.

#### TC-INF-013: Broker failure with RF=1 topic causes data loss / unavailability
- **Category**: Negative
- **Priority**: P0
- **Related Issue**: #54
- **Steps**: Identify which broker holds the only replica of a topic-partition; stop that broker container
- **Expected Result**: Topic becomes unavailable/produces fail until broker returns; no fault tolerance.

### Volumes

#### TC-INF-014: `redis.conf` bind mount is an empty directory, not a file
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #55
- **Steps**: Inspect `./redis.conf` in repo root; start `redis` service and `docker exec redis cat /usr/local/etc/redis/redis.conf`
- **Expected Result** (bug): Path is mounted as an empty directory; any config file that should exist there is absent; explicit `redis-server /usr/local/etc/redis/redis.conf` invocation would fail
- **Notes**: Redis currently starts fine only because entrypoint uses `REDIS_ARGS` env instead of `--include`ing this file.

#### TC-INF-015: Backtest data pipeline volumes are disconnected between writer and readers
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #53
- **Steps**: Let `exporttofile` run its cron export; then trigger a backtest deployment that reads from `backtest-data`/`SHARED_DIR`
- **Expected Result** (bug): Files written by `exporttofile` to `exported_stock_data` volume at `/exported_stock_data/<date>/...` are never visible to `backtest-streamer`/`msb-strategy-backtest` etc., which read `backtest-data` volume at `/shared/exportedData/<date>/<symbol>.json` — backtest fails to find data unless manually placed
- **Notes**: Confirm the orphaned `shared-space` volume is declared but mounted nowhere.

#### TC-INF-016: Mongo replica nodes lack Swarm placement constraints
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #57
- **Preconditions**: Multi-node Swarm
- **Steps**: Force-reschedule `mongo2` task to a different node (drain original node); inspect data directory
- **Expected Result** (bug): New node starts with a fresh empty local `mongo2-data` volume under the same service name, risking replica set corruption or hung bootstrap — unlike `redis`/`redisinsight` which pin `node.role == manager`
- **Notes**: Compare with TC-INF-017.

#### TC-INF-017: Redis correctly pinned to manager node
- **Category**: Regression (positive control)
- **Priority**: P2
- **Steps**: Inspect `redis` and `redisinsight` service `deploy.placement.constraints`
- **Expected Result**: Both correctly declare `node.role == manager`, confirming the inconsistency is isolated to Mongo services.

### Kafka/Zookeeper Legacy Images & Docs Drift

#### TC-INF-018: Orphaned Dockerfiles under `kafka/broker/`, `kafka/zookeeper/`, `mongo/Dockerfile`
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #61
- **Steps**: Search repo for these Dockerfiles; confirm they are not referenced by `docker-compose.yml` or `build-all.sh`
- **Expected Result**: Confirmed orphaned/dead; flag for removal or documentation update.

#### TC-INF-019: `system_flows/docker_and_stack.md` service names diverge from compose file
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #61
- **Steps**: Diff service names in docs (`zookeeper-1`, `nginx-load-balancer`) against actual `docker-compose.yml` service keys
- **Expected Result**: Mismatches confirmed; docs reference nonexistent service names.

### Restart / Resilience

#### TC-INF-020: `restart_policy: condition: any` masks persistent crash loops
- **Category**: Negative
- **Priority**: P1
- **Steps**: Intentionally break a consumer's env var (e.g., bad `MONGO_URI`); deploy; observe `docker service ps` restart count over 5 minutes
- **Expected Result**: Container restarts indefinitely without surfacing a terminal failure state to operators; no alerting on crash-loop.

#### TC-INF-021: Scaling consumer replicas up/down
- **Category**: Functional
- **Priority**: P2
- **Steps**: `docker service scale moneymaker_price-storer-consumer=5`; verify new replicas join the same consumer group without duplicate processing beyond Kafka's own partition-assignment guarantees
- **Expected Result**: Replicas beyond partition count remain idle (see TC-INF-012); no crash on scale-up/down.

### Environment / Secrets in Compose

#### TC-INF-022: JWT secrets and service tokens defined in plaintext in compose env
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #36, #58
- **Steps**: `git show` or `grep` `docker-compose.yml` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BACKTEST_SERVICE_TOKEN`
- **Expected Result**: Static values (`iam-access-secret`, `backtest-internal-service-token`) are committed in plaintext and reused across environments — should be Docker secrets or externally injected.

#### TC-INF-023: `NODE_TLS_REJECT_UNAUTHORIZED: "0"` scoped only to `placeorder`
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #17
- **Steps**: Inspect env of `placeorder` container vs other services calling `reverse-proxy` over HTTPS internally
- **Expected Result**: Only `placeorder` disables TLS validation; confirm this affects the entire Node process including calls to `api-hft.upstox.com`, not just internal reverse-proxy calls.
