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