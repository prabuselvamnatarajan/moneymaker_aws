# MongoDB Replica Set & Redis — Test Case Plan

## Scope
Covers the 3-node MongoDB replica set (`mongo1`/`mongo2`/`mongo3`, `rs0`), its admin UI `mongo-express`, the single Redis (redis-stack) instance backing sessions/state/pubsub, and its admin UI `redisinsight`. Also covers `appInit`'s Mongo→Redis seeding behavior.

## Prerequisites
- Full stack running with all 3 mongo nodes healthy and replica set initialized
- `mongosh`/`redis-cli` access for verification
- Credentials: Mongo `root`/`example` (authSource admin), Redis password `myStrongRedisPassword`

## Test Cases

### Replica Set Formation & Failover

#### TC-DB-001: Replica set initializes correctly on fresh cluster
- **Category**: Functional
- **Priority**: P0
- **Steps**: Fresh volumes; start `mongo1`, `mongo2`, `mongo3`; run `rs.status()` via `mongosh` against `mongo1`
- **Expected Result**: All 3 members join `rs0`, one PRIMARY and two SECONDARY, using `mongo-keyfile` for internal auth.

#### TC-DB-002: Application connects using full replica-set URI with all 3 seeds
- **Category**: Functional
- **Priority**: P0
- **Steps**: Verify `MONGO_URI` env on `backtest-app`, `appinit`, `exporttofile`, storer consumers all list `mongo1,mongo2,mongo3` with `replicaSet=rs0`
- **Expected Result**: Driver correctly discovers primary and fails over on primary loss (see TC-DB-003).

#### TC-DB-003: Primary failover — kill current PRIMARY container
- **Category**: Negative
- **Priority**: P0
- **Steps**: Identify PRIMARY; `docker stop` that container; monitor application writes (e.g., trade creation) during election window
- **Expected Result**: Brief write unavailability during election (~seconds), then writes succeed against newly elected PRIMARY without app restart; no data loss for acknowledged writes.

#### TC-DB-004: Mongo nodes rescheduled to different Swarm node lose local volume data
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #57
- **Preconditions**: Multi-node Swarm without placement constraints on mongo services
- **Steps**: Drain the node hosting `mongo2`; let Swarm reschedule it elsewhere
- **Expected Result** (bug): New instance starts with empty local volume under the same service name — risks replica-set corruption/hung bootstrap since it can't find prior oplog/data; contrast with `redis` which has `node.role == manager` pinning.

#### TC-DB-005: `mongod-bootstrap.conf` vs `mongod.conf` used correctly per init script
- **Category**: Functional
- **Priority**: P2
- **Steps**: Inspect `init-mongo1.sh` vs `init-mongo.sh` entrypoints; confirm bootstrap config is used only for initial rs.initiate() and normal config thereafter
- **Expected Result**: No conflicting configuration causes restart loops.

### Mongo-Express Exposure

#### TC-DB-006: `mongo-express` reachable on host port 8081 with trivial/default basic auth
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #56
- **Steps**: `curl http://<host>:8081/` or open in browser; attempt default `admin`/`pass` if prompted
- **Expected Result** (bug): No `ME_CONFIG_BASICAUTH_*` configured, so Mongo Express defaults apply (trivial creds) — full DB browse/edit/delete access to `stock_database`, `BacktestApp`, `UPLINK_SERVER_USER_DATA`, `appInit` databases.

#### TC-DB-007: `mongo-express` can mutate live trading/account data
- **Category**: Security
- **Priority**: P1
- **Steps**: Through mongo-express UI, edit an `Account.current_balance` field directly
- **Expected Result** (bug): Edit succeeds with no application-level audit trail — confirms the exposure is not just read-only.

### RedisInsight Exposure

#### TC-DB-008: `redisinsight` reachable on host port 8001 with no access control
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #56
- **Steps**: `curl http://<host>:8001/` or open in browser; add the `redis` instance using the known password from compose env
- **Expected Result** (bug): No login/access control on RedisInsight itself; once the Redis connection is added (password is in plaintext in compose), full keyspace browsing is possible — including `redis_upstox_access_token:*`, strategy state, deployment counters, session data.

#### TC-DB-009: RedisInsight can browse/delete live trading state keys
- **Category**: Security
- **Priority**: P1
- **Steps**: Through RedisInsight, locate and delete a `liquidity_sweep:open:<accountId>` or `short_quantity:*` key while a live deployment is running
- **Expected Result**: Deletion succeeds silently, corrupting strategy state — confirms operational blast radius of the exposure.

### Redis Configuration

#### TC-DB-010: `redis.conf` bind-mount source is an empty directory
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #55
- **Steps**: `docker exec redis ls -la /usr/local/etc/redis/`; attempt `docker exec redis redis-cli CONFIG GET appendonly`
- **Expected Result**: `redis.conf` intended settings (e.g., `appendonly yes`) never actually applied since the repo path is an empty directory, not a file; Redis is running purely on `REDIS_ARGS` env (`--requirepass`, `--maxmemory`, `--maxmemory-policy allkeys-lru`) with no persistence guarantees beyond defaults.

#### TC-DB-011: Redis maxmemory eviction under load (`allkeys-lru`, 256mb cap)
- **Category**: Performance
- **Priority**: P2
- **Steps**: Fill Redis past 256MB with synthetic keys while live strategy state keys are active
- **Expected Result**: LRU eviction may evict active strategy/session keys (since policy is `allkeys-*`, not `volatile-*`), potentially causing state loss (e.g., MSB previous-high/low state) — validate whether critical keys have appropriate TTL/priority or if eviction is a real risk.

#### TC-DB-012: Redis auth required for all clients
- **Category**: Security
- **Priority**: P1
- **Steps**: Connect via `redis-cli -h <host>` without `-a <password>`, attempt any command
- **Expected Result**: `NOAUTH Authentication required` — confirms `--requirepass` is enforced; then verify all service `REDIS_URL` envs include the password.

#### TC-DB-013: Redis exposed on host port 6379
- **Category**: Security
- **Priority**: P2
- **Steps**: From outside the Docker network (host machine or external), attempt `redis-cli -h <public-ip> -p 6379`
- **Expected Result**: Port is published to host — reachable if host firewall doesn't restrict; combined with weak/shared password, represents exposure surface.

### appInit Seeding Behavior

#### TC-DB-014: `appinit` seeds `strategies:live:*` RedisJSON keys from Mongo on startup
- **Category**: Functional
- **Priority**: P1
- **Steps**: Populate `strategyChooser` collection in `appInit` Mongo DB with documents keyed by `symbolName`; restart `appinit` service; inspect Redis
- **Expected Result**: One RedisJSON key per document is created/refreshed under `strategies:live:` prefix, keyed by `symbolName` property.

#### TC-DB-015: `websocketlistening:live` seeding is a no-op due to data-shape mismatch
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #31
- **Steps**: Restart `appinit`; inspect Redis key `websocketlistening:live` (declared as a `list` type in `REDIS_LIVE_WEBSOCKETLISTENING`)
- **Expected Result** (bug): Key is `DEL`eted on every startup but never repopulated, since `addDataToRedisTarget`'s list/set branches only act when `data` is an array, while the seed data is a single Mongo document object — key silently ends up empty/missing after every restart.
- **Notes**: Also confirm no consumer currently reads this key (per code comment `# need to update this`), so the no-op currently causes no functional break — but is a landmine if wired up later.

#### TC-DB-016: `appinit` repeats full re-seed on every restart (wasted I/O)
- **Category**: Performance
- **Priority**: P2
- **Related Issue**: #31
- **Steps**: Restart `appinit` multiple times in a row; monitor Mongo query count and Redis DEL/SET volume
- **Expected Result**: Full collection scan + Redis rewrite happens every restart regardless of whether underlying data changed.

### Cross-Cutting Data Integrity

#### TC-DB-017: Mongo write concern/durability during replica election
- **Category**: Performance
- **Priority**: P2
- **Steps**: Inspect driver write concern defaults used by Mongoose connections across services (backtest-app, storer consumers)
- **Expected Result**: Confirm whether default write concern (`w:1`) risks acknowledged-but-unreplicated writes being rolled back on failover; document actual behavior for critical financial writes (ledger, trade).

#### TC-DB-018: MongoDB authSource/authentication required for all connections
- **Category**: Security
- **Priority**: P1
- **Steps**: Attempt to connect to `mongo1:27017` without credentials
- **Expected Result**: Authentication required (keyfile + auth enabled per replica set setup); unauthenticated connections rejected.
