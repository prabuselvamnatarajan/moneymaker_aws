# appInit & Scheduled Services (MSBStrategyInit, Secrets Hygiene) — Test Case Plan

## Scope
Covers `appInit` (the one-shot Mongo→Redis seeding job run at stack startup, `appInit/start.js` → `Init/base_init.js` driving two configs: `strategyChooser_Live.js` and `webSocketListening_Live.js`), the orphaned `ScheduledServices/MSBStrategyInit` service (never wired into deployment), and repository secrets-hygiene (`.gitignore` gaps, committed credentials).

## Prerequisites
- MongoDB `appInit` DB with `strategyChooser` and `webSocketListening` collections seeded with test documents
- Redis reachable
- Access to `docker-compose.yml` and `build-all.sh` for wiring verification
- Access to git history (`git log`, `git show`) for secrets-in-history verification (read-only inspection, no destructive operations)

## Test Cases

### appInit — Sequential Initialization

#### TC-AI-001: `start.js` runs `strategyChooser` config THEN `webSocketListening` config sequentially, not in parallel
- **Category**: Functional
- **Priority**: P1
- **Steps**: Instrument/log timestamps around each `baseInitMain` call
- **Expected Result**: The second `await baseInitMain(webSocketListeningConfig)` does not begin until the first fully completes — confirms the documented intent (avoiding races on the shared Redis client) is honored by the code structure.

#### TC-AI-002: Any failure in either init step causes `process.exit(1)`, failing the container/task visibly
- **Category**: Functional
- **Priority**: P1
- **Steps**: Force `base_init.js`'s `connect()` to throw (e.g., invalid `MONGO_URI`)
- **Expected Result**: Caught by `start.js`'s outer try/catch, logs the error, calls `process.exit(1)` — in a Swarm one-shot job/init container context, this correctly surfaces as a failed task rather than a silent success.

### appInit — `strategyChooser_Live` Seeding (Working Path)

#### TC-AI-003: Each `strategyChooser` Mongo document is written to Redis as a `json`-type key, keyed by its `targetProperty` value
- **Category**: Functional
- **Priority**: P0
- **Steps**: Seed `appInit.strategyChooser` with documents having a `symbol` (or whatever `PROPERTY_LIVE_STRATEGYCHOOSER` env names) field; run `appInit`
- **Expected Result**: For each document, a Redis key `strategies:live:<propertyValue>` is created via `RedisJson.setJson`, containing the full document as JSON — matches the trailing-colon-stripped `redisKey` (`strategies:live:` → `strategies:live`) plus `:<value>` reconstruction.

#### TC-AI-004: A document missing the configured `targetProperty` is skipped with a logged error, not a crash
- **Category**: Negative
- **Priority**: P1
- **Steps**: Seed a `strategyChooser` document with no `symbol` field (or whatever `targetProperty` names)
- **Expected Result**: `if (propertyValue === undefined) { console.error(...); continue; }` — skips this document, continues processing the rest.

#### TC-AI-005: Trailing colon in `REDIS_LIVE_STRATEGYCHOOSER`'s `key` config (`"strategies:live:"`) is correctly stripped before key construction (Regression — verify previously-reported bug is fixed)
- **Category**: Regression (verify fix)
- **Priority**: P0
- **Steps**: With the ACTUAL current `docker-compose.yml` value `REDIS_LIVE_STRATEGYCHOOSER: '{"key":"strategies:live:","data_type":"json"}'` (note the trailing colon in the JSON `key` value), run `appInit` and inspect the resulting Redis key names
- **Expected Result**: `base_init.js`'s `redisKey.endsWith(':') ? redisKey.slice(0,-1) : redisKey` correctly detects and strips the trailing colon BEFORE appending `:<propertyValue>` — resulting keys are `strategies:live:<value>` (single colon separator), NOT `strategies:live::<value>` (double colon). Confirms this specific "double-colon" defect that would otherwise mismatch every downstream consumer's key-lookup pattern (e.g., `getUserIdForSymbol` in `ConnectWS-Upstox/websocket.js` reads `strategies:live:${symbol}` — a double-colon mismatch would make EVERY seeded key invisible to every consumer across the whole system) is CURRENTLY FIXED in the code. Re-run this test after any future change to `base_init.js` or the env var format as a regression guard.

#### TC-AI-006: Existing Redis key for a given property value is correctly overwritten (not merged/appended) on each appInit run
- **Category**: Functional
- **Priority**: P1
- **Steps**: Run `appInit` twice with the same seeded Mongo data, modifying one document's non-key field between runs
- **Expected Result**: `RedisJson.setJson` overwrites the full JSON value — the second run's data fully replaces the first, no stale merged fields remain (JSON `set`, not a partial merge).

#### TC-AI-007: `strategyChooser` data type does NOT go through `clearRedisKeyIfNeeded` (only `list`/`set`/`hash` do) — verify no unnecessary DEL for `json` type
- **Category**: Functional
- **Priority**: P2
- **Steps**: Inspect Redis command trace during a `strategyChooser` (json type) init run
- **Expected Result**: No `DEL` command issued before the `JSON.SET` — confirms `clearRedisKeyIfNeeded`'s `['list','set','hash'].includes(dataType)` guard correctly excludes `json` (and `string`) types, which are naturally idempotent-overwrite on `SET`/`JSON.SET` without needing a pre-clear.

### appInit — `webSocketListening_Live` Seeding (Broken Path)

#### TC-AI-008: `websocketlistening:live` list key is DELeted on every appInit run but is NEVER repopulated, because `data` is a single Mongo document object, not an array
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #31
- **Steps**: Seed `appInit.webSocketListening` with one or more documents; run `appInit`; inspect the Redis key `websocketlistening:live` before and after
- **Expected Result** (current bug): `base_init.js`'s loop iterates over EACH Mongo document individually (`for (const item of data)`), calling `clearRedisKeyIfNeeded` (which DELs the list key, since `data_type:"list"`) then `addDataToRedisTarget(redisTarget, 'list', redisItemKey, item)` — but `item` here is a single plain object (one Mongo document), NOT an array. `addDataToRedisTarget`'s `list` branch explicitly checks `if (Array.isArray(data))` before doing anything — since `item` is never an array, this check is ALWAYS false, and the function silently no-ops (returns without pushing anything). Net effect: the key is deleted every run and never refilled — `websocketlistening:live` ends every appInit run as an EMPTY (or nonexistent) list, regardless of how much data exists in MongoDB.
- **Notes**: Doubly moot because (per TC-AI-009) nothing currently reads this key anyway — but this is a "landmine" per the issue: if a future consumer is wired up expecting this key to be populated, it will find it permanently empty with no error anywhere in the pipeline.

#### TC-AI-009: `websocketlistening:live` has NO current consumer anywhere in the codebase — confirmed dead/wasted seeding work
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #31
- **Steps**: Search the entire codebase (`kafka/`, `MicroServices/`, `BackTest/`) for any read of the `websocketlistening:live` Redis key
- **Expected Result**: Zero matches — confirms the `docker-compose.yml` comment (`# need to update this`) is accurate; every appInit run performs a full Mongo `find({})` + N Redis DEL operations for zero net effect (no data is ever available for anyone to read, and nothing tries to read it) — pure wasted I/O on every stack restart.

#### TC-AI-010: If a consumer were wired up expecting a populated list, it would silently find an empty list forever post-fix-attempt (until `addDataToRedisTarget`'s list/set branches are also fixed to accept single items)
- **Category**: Regression (forward-looking regression guard)
- **Priority**: P2
- **Related Issue**: #31
- **Steps**: Hypothetically fix ONLY the "wire up a consumer" half of this issue without also fixing `addDataToRedisTarget`'s array-only guard
- **Expected Result**: Document that BOTH halves of the fix (per the issue's proposed fix) are required together — wiring a consumer alone would surface a "no data available" failure mode rather than a functioning feature, since the seeding logic itself needs to either push single items or restructure to aggregate all documents into one array before calling `addDataToRedisTarget`.

### MSBStrategyInit — Orphaned Service

#### TC-AI-011: `MSBStrategyInit` is NOT present in `docker-compose.yml` under any service name
- **Category**: Regression / Bug (verify orphan status)
- **Priority**: P1
- **Related Issue**: #30
- **Steps**: Search `docker-compose.yml` for any reference to `MSBStrategyInit` (service name, image, build context path)
- **Expected Result**: Zero matches — confirms the service has a complete `Dockerfile`/`scheduler.js`/`util.js`/`exportCollections.js` implementation but is never deployed as part of the stack; it cannot run in the current system regardless of its internal correctness.

#### TC-AI-012: `MSBStrategyInit` is NOT present in `build-all.sh`
- **Category**: Regression / Bug (verify orphan status)
- **Priority**: P2
- **Related Issue**: #30
- **Steps**: Search `build-all.sh` for any build step referencing `MSBStrategyInit`
- **Expected Result**: Zero matches — the image is never built, reinforcing the "dead code" classification; even manually starting it would require an ad-hoc `docker build`/`docker run` outside the normal deployment tooling.

#### TC-AI-013: `addSymbolsToWatchListToRedis()` is a permanent no-op stub, confirming the service provides zero functional value even if it WERE deployed
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #30
- **Steps**: Invoke `addSymbolsToWatchListToRedis()` directly (unit-level)
- **Expected Result**: Logs `"addSymbolsToWatchListToRedis is currently not active."` and returns immediately — no Redis writes, no Mongo reads, nothing; confirms this isn't just "undeployed" but also internally incomplete.

#### TC-AI-014: `MSBStrategyInit`'s export/scheduler logic duplicates `ScheduledServices/ExportToFile` almost verbatim, creating a maintenance-drift risk
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #30
- **Steps**: Diff `MSBStrategyInit/scheduler.js`/`exportCollections.js` against `ExportToFile/scheduler.js`/`exportCollections.js`
- **Expected Result**: Confirm near-identical export logic exists in both places — any future bugfix (e.g., issue #53's volume-path fix) applied to `ExportToFile` will NOT automatically apply to this orphaned duplicate, so if `MSBStrategyInit` is ever revived, it will resurrect any already-fixed bugs unless updated in lockstep.

#### TC-AI-015: If manually deployed, `MSBStrategyInit`'s outbound calls to the reverse proxy would fail TLS validation without an explicit override
- **Category**: Negative (forward-looking / documentation)
- **Priority**: P2
- **Related Issue**: #30
- **Steps**: If manually running this service against the real nginx reverse proxy (self-signed cert per `infrastructure-nginx-reverse-proxy.md`), observe `getLTP`'s `fetch(GET_LTP_URL)` call behavior
- **Expected Result**: Standard Node `fetch` rejects self-signed/untrusted certs by default — the call fails with a TLS validation error unless `NODE_TLS_REJECT_UNAUTHORIZED=0` (or an equivalent CA-trust configuration) is set, exactly as flagged in the issue's impact note. Document this as a required follow-up if the service is ever revived rather than deleted.

#### TC-AI-016: `getRelatedStrikePrices` correctly computes a symmetric ITM/OTM strike grid around the nearest round strike
- **Category**: Functional (unit-level, in case of future revival)
- **Priority**: P2
- **Steps**: Call `getRelatedStrikePrices(10023, 50, 5)`
- **Expected Result**: `CallLastInTheMoney = floor(10023/50)*50 = 10000`; returns `[9750,9800,9850,9900,9950,10000,10050,10100,10150,10200,10250]` (5 below, the ATM strike, 5 above) — pure function, verify math independent of the service's deployment status.

### Secrets Hygiene

#### TC-AI-017: `.gitignore` fails to exclude bare `*.env` files (only excludes `.env` and `*.env.*`)
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #58
- **Steps**: Inspect `.gitignore` patterns; check whether `upstock-login.env` (a bare-`.env`-suffixed filename, not matching `.env` exactly nor `*.env.*`) is tracked by git
- **Expected Result** (current bug): Confirmed — `git ls-files` includes `upstock-login.env`; the `.gitignore` pattern gap means any file named `<anything>.env` (as opposed to exactly `.env` or `<anything>.env.<anything>`) is NOT excluded and gets committed.

#### TC-AI-018: Git history contains real Upstox `CLIENT_SECRET`, MongoDB Atlas credentials, JWT tokens, and the Mongo replica-set keyfile
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #58
- **Steps**: Run `git log --all --full-history -- '*.env'` and inspect historical blob contents for `upstock-login.env` and `mongo/mongo-keyfile`; run `git log -p` (scoped/targeted, not a full destructive operation) against these paths
- **Expected Result**: Confirms real secret material (client secret, DB credentials, keyfile bytes used for MongoDB internal cluster authentication) is present in commit history — even if these files are deleted or gitignored NOW, historical commits retain the plaintext values indefinitely unless the history itself is rewritten (`git filter-repo`/BFG) and force-pushed, and all exposed credentials are rotated.
- **Notes**: This test is READ-ONLY inspection only — do NOT perform history rewriting or force-push as part of test execution; that is a remediation action requiring explicit owner sign-off, not a test case action.

#### TC-AI-019: Currently-tracked `mongo/mongo-keyfile` is still present in the working tree and used unchanged as the live replica-set auth secret
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #58
- **Steps**: Check whether `mongo/mongo-keyfile` is currently used by the running `mongo1`/`mongo2`/`mongo3` services (per `docker-compose.yml`) as their `--keyFile` argument
- **Expected Result**: If YES (the file referenced in a public/shared git history is the SAME file actively securing internal replica-set authentication in production), this is an active, exploitable secret exposure, not just a historical record — anyone with read access to the git history could forge internal cluster authentication. Highest-priority remediation candidate: rotate this keyfile immediately regardless of history-rewriting timeline.

#### TC-AI-020: A corrected `.gitignore` pattern (`*.env`) would have prevented `upstock-login.env` from ever being tracked — verify the fix going forward
- **Category**: Regression (verify fix, if applied)
- **Priority**: P1
- **Related Issue**: #58
- **Steps**: After applying the proposed `.gitignore` fix (`*.env` instead of `.env`/`*.env.*`), create a new test file `newservice.env` with dummy content and run `git status`
- **Expected Result**: The new file shows as ignored/untracked-and-excluded, confirming the pattern fix is effective for future files (though it does nothing to remediate already-committed history — see TC-AI-018).
