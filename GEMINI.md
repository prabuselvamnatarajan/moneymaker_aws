after every changes the AI need to update the git with proper message for the changes. so i will have a all the changes tracked.

# Development System Config
- Operating System: win32
- the default terminal is powershell

# Tech Stack
This project is a collection of microservices primarily built with Node.js. It uses Kafka for messaging, MongoDB as a database, and Redis for caching. The services are containerized using Docker.

## Key Technologies used:
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **Messaging:** Kafka
- **Caching:** Redis
- **Containerization:** Docker
- **API Communication:** REST, WebSockets, gRPC (protobuf)
- **Other Libraries:**
    - `axios` for making HTTP requests
    - `ws` for WebSocket communication
    - `kafkajs` for interacting with Kafka
    - `mongodb` for interacting with MongoDB
    - `protobufjs` for working with Protocol Buffers
    - `dotenv` for managing environment variables
    - `luxon` and `node-cron` for scheduling tasks
# rules:
    - need to update the memory with the gemini.md file once it is modified. so keep track of gemini.md file
    - **Dynamic Data Loading**: Detail views (account-detail, strategy-detail, symbol-detail) and list views (transactions, dashboard log stream) MUST self-fetch their own data via scoped server-side API calls when the user navigates to them. NEVER rely on client-side filtering of globally fetched/paginated data (such as accounts, strategies, symbols, order directions like BUY/SELL, booking status, or date ranges) — this causes false positives where a deployment has transactions in the DB but they don't appear in the UI because the initial global fetch didn't include them due to pagination limits. Use endpoints like `/trades?account_id=...`, `/trades?deployment_id=...`, `/trades?symbol=...` for scoped fetches. Always show a loading skeleton and a Refresh button. Client-side filtering of entity states, directions, or statuses is strictly prohibited in list views, as pagination must reflect correct count and page boundaries for those filtered subsets.
    - **Full Responsiveness**: All UI screens MUST be fully responsive and work correctly across all viewport sizes: mobile (320px+), tablet (768px), and desktop (1280px+). Use mobile-first CSS with Tailwind breakpoints (sm, md, lg, xl). Use responsive grid layouts (e.g., `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). Tables must use `overflow-x-auto` with `min-w-[...]` on the table itself. Modals/overlays must be scrollable on small screens. Sidebar must collapse to a drawer on mobile.
    - **Cascading Deletions**: Deleting any base entity (such as Strategy, Account, or Symbol/UserSymbol) or deployment MUST perform a cascading deletion. When a base entity is deleted, all associated deployments, positions, trades/transactions, and ledger logs belonging to the user for that entity must be deleted. Deleting a deployment must delete its associated positions, trades, and ledgers. Implement this in the service layer using strict ownership checks (ensuring users only edit/delete their own entities).
    - **No Hardcoded Absolute Host Paths**: NEVER hardcode local host absolute machine paths (e.g., `/home/prabu/...`, `/Users/...`, `C:\Users\...`) in application source code, Docker configuration files, scripts, mount bindings, or fallback logic. Always use dynamic paths, environment variables (e.g., `process.env.SHARED_DIR`), or relative paths from `process.cwd()`.
    - **Fail Loud & Fast On Errors**: NEVER use silent fallbacks or hardcoded local directory fallback chains that mask underlying path configuration or container mount failures. If a required service, file, directory, or mount binding is missing or fails, throw an explicit, descriptive error immediately (fail loud) so that deployment or container configuration issues in production or IDC environments are surfaced right away.
    - **Timeframe Candle Architecture**: Strategy breakout & structure signals (e.g. MSB) MUST evaluate exclusively on finalized closed candles (`closedCandle` emitted on timeframe bucket rollover). Intra-bar tick updates (`formingCandle`) MUST NOT evaluate structure breakout signals or trigger new entry orders. Real-time position risk management (Target & Stop-Loss points/percentage) MUST evaluate on every tick (`ltp`) continuously without waiting for candle completion.
    - **CI/CD Pipeline & Docker Hub**: Images are public under the Docker Hub namespace in `DOCKERHUB_USERNAME` (default `prabuselvamnatarajan`). The GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the full image set on every branch push and pushes it immediately: `latest` on `main`, or the sanitized branch name on other branches (characters outside `[A-Za-z0-9_.-]` become `-`, truncated to 128 characters; a non-main name that sanitizes to `latest` fails). Unit tests and end-to-end tests then run in parallel, each pulling those published tags — unit tests as a matrix of one runner per image with a real `npm test` script, e2e on a fresh runner that pulls only the E2E profile so Kubernetes does not share disk with the full image build. The CI overlay does not restart workloads after that first import. There is no second promotion step; a failed test does not roll the tag back. AWS deploy on `main` runs only after both test jobs pass and only when that commit is still the branch tip: it pulls `--tag latest`, imports the images, restarts workloads that use them, and fails if the core rollouts do not become ready. A superseded commit skips the AWS deploy. When a non-main branch is deleted on GitHub, the `cleanup-branch-images.yml` workflow triggers `./scripts/delete-branch-images.sh` to delete all corresponding image tags from Docker Hub via its REST API (requiring `DOCKERHUB_TOKEN` with Read, Write, Delete permissions), preventing stale feature tags from accumulating. The server directory is `$HOME/moneymaker_aws` unless the `DEPLOY_PATH` repository variable is set. Local development still builds with `./build-all.sh` or `./scripts/build-images.sh`.
    - **Comprehensive Test Coverage & Quality**: Every service, microservice, consumer, strategy, script, and feature MUST maintain comprehensive unit and integration/e2e tests covering all normal flows, boundary conditions, edge cases (e.g. malformed payloads, network disconnects, null/missing fields, duplicate executions, concurrent requests, out-of-order data, auth and RBAC boundaries, fail-loud triggers). New or modified functionality MUST include corresponding test cases in its designated test suite before shipping to prevent regressions and ensure backward compatibility.
