# AGENTS.md

## Cursor Cloud specific instructions

MoneyMaker is a Docker Swarm microservices algorithmic-trading platform (Node.js). The full stack (~26 images) is built/deployed with `./build-all.sh` (Swarm) and torn down with `./kill-moneymaker.sh`. For day-to-day development, the self-contained, externally-dependency-free product is the **Backtest web app**: `BackTest/BackTestApp` (Express REST API + WS) and `BackTest/BackTestUI` (React + Vite). The live-trading path (Upstox market feed/orders, the Kafka strategy pipeline, and the other `MicroServices/`) requires real Upstox broker credentials (`CLIENT_ID`/`CLIENT_SECRET`) and the full Swarm stack; it is out of scope for local backtest development.

### Infrastructure (MongoDB + Redis) via Docker
- There is **no systemd** in this VM. The Docker daemon does not auto-start and running containers do not survive a fresh pod. Start it once per session: `sudo dockerd > /tmp/dockerd.log 2>&1 &` (daemon is preconfigured for `fuse-overlayfs` + `containerd-snapshotter: false` in `/etc/docker/daemon.json`; iptables is set to legacy).
- MongoDB: the app requires a **replica set** (`replicaSet=rs0`). Run a single-node replica set and initiate it with host `localhost` (not the container hostname) so host processes can connect:
  - `sudo docker run -d --name mm-mongo -p 27017:27017 mongo:6.0 --replSet rs0 --bind_ip_all`
  - `sudo docker exec mm-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})'`
- Redis: use **redis-stack** (not plain redis) — the app calls RedisJSON (`JSON.SET`), which plain `redis` rejects with `ERR unknown command 'JSON.SET'`:
  - `sudo docker run -d --name mm-redis -p 6379:6379 -e REDIS_ARGS="--requirepass myStrongRedisPassword" redis/redis-stack-server:latest`
- Re-run containers only if they don't already exist (`sudo docker ps -a`).

### Run the Backtest API (`BackTest/BackTestApp`)
- `npm start` (`node src/server.js`), needs these env vars: `PORT=4000`, `MONGO_URI="mongodb://localhost:27017/?replicaSet=rs0"`, `MONGO_DB=BacktestApp`, `REDIS_URL="redis://:myStrongRedisPassword@localhost:6379"`, `JWT_ACCESS_SECRET=iam-access-secret`, `JWT_REFRESH_SECRET=iam-refresh-secret`, `BACKTEST_SERVICE_TOKEN=backtest-internal-service-token`.
- `MONGO_URI` must NOT include the database name — `connection.js` appends `MONGO_DB` itself.
- Kafka connection errors on boot are **expected and non-fatal** when Kafka isn't running; only the live-price WebSocket consumer needs Kafka. The REST API and DB are fully functional without it.
- Seed data: `node src/db/clear_and_seed.js` (wipe + seed) or `node src/db/seed.js` (users/roles only). Seed credentials come from the code, not `backtest_credentials.md`: standard user `user@cobratrades.com` / `userpassword123`, admin `admin@cobratrades.com` / `adminpassword123`.

### Run the Backtest UI (`BackTest/BackTestUI`)
- `npm run dev` → Vite on port 3000, served at `http://localhost:3000/backtest-ui/`, and it proxies `/backtestapp` → `http://localhost:4000` (so the API must be running).
- On first login the UI prompts for MFA setup — "Skip for now" is available.

### Lint / test / build
- UI lint/typecheck: `npm run lint` in `BackTest/BackTestUI` (runs `tsc --noEmit`).
- There is no real automated test suite; `BackTest/BackTestApp`'s `npm test` is a placeholder that exits non-zero.
