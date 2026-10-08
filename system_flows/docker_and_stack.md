# Containerization, Orchestration, and Stack Configuration

This document describes the container setup of the MoneyMaker system.

**Runtime:** Kubernetes (k3s). Manifests live under [`k8s/`](../k8s/).
Deploy with `./scripts/deploy-k8s.sh` (or `./build-all.sh`).
[`docker-compose.yml`](../docker-compose.yml) is a catalog of service names,
env, and replica counts. It is not used to start the stack.
See [`k8s/README.md`](../k8s/README.md).

## Kubernetes map

```
       +--------------------------------------------------------------+
       |         Traefik Ingress (host :80 / :443)                     |
       +------------------------------+-------------------------------+
                                      |
       +------------------------------v-------------------------------+
       |              Service reverse-proxy (nginx)                    |
       |         path routing from certs/nginx.conf                    |
       +------------------------------+-------------------------------+
                                      |
       +------------------------------v-------------------------------+
       |              Namespace: moneymaker                             |
       |  Deployments + StatefulSets (mongo*, kafka-broker-*, redis,   |
       |  zookeeper, consumers, strategies, microservices, backtest-*) |
       +--------------------------------------------------------------+
```

All workloads share one namespace so Compose-compatible short DNS names
(`mongo1`, `kafka-broker-1`, `placeorder`, `backtest-app`, …) resolve without
code changes.

## Network Isolation Map (historical / aspirational)

The older design described two bridge networks. The running Swarm compose file
used a single overlay (`moneymaker_net`). Kubernetes keeps a single namespace;
NetworkPolicies can be added later without renaming Services.

```
       +--------------------------------------------------------------+
       |                  nginx-load-balancer (Gateway)               |
       +------------------------------+-------------------------------+
                                      |
       +------------------------------v-------------------------------+
       |                         shared-net                           |
       |  (Microservices, MongoDB, Redis, BackTestApp, BackTestUI)     |
       +------------------------------+-------------------------------+
                                      |
       +------------------------------v-------------------------------+
       |                          kafka-net                           |
       |     (Zookeeper, Kafka Brokers, Strategy & Storer Consumers)  |
       +--------------------------------------------------------------+
```

1. **`shared-net` (Bridge Network)**:
   * Connects the REST API microservices, Nginx reverse proxy, MongoDB replica set nodes, Redis instance, `backtest-app`, and `backtest-ui`.
   * Enforces REST communications, database accesses, and session management.
2. **`kafka-net` (Bridge Network)**:
   * Connects the Zookeeper node, three Kafka brokers, Kafka producers, and consumers.
   * Isolates high-frequency event streaming traffic from general REST APIs.
   * Services like `StrategyChooserConsumer` and strategy execution bots connect to both `shared-net` and `kafka-net` to fetch configurations from Redis/Mongo and consume ticks from Kafka.

---

## Service Catalog

### 1. Base Infrastructure

#### Zookeeper & Kafka Brokers
* **`zookeeper-1`**: Coordinate partition leaders and brokers.
* **`kafka-broker-1`**, **`kafka-broker-2`**, **`kafka-broker-3`**: Form a three-node cluster with metadata replication. Connects to host port `9092` (via cluster listener) and internally within `kafka-net` via port `9093`.

#### Databases
* **`redis`**: High-speed memory storage running on port `6379`. Persisted on the host machine using a Docker volume.
* **`mongo-db-node-1`**, **`mongo-db-node-2`**, **`mongo-db-node-3`**: A three-node MongoDB replica set configured using an internal keyfile (`/etc/mongo-keyfile`) for cluster authentication. Provides ACID transactions.

### 2. Core Gateways and Interfaces

* **`nginx-load-balancer`**: Maps host ports `80` (HTTP) and `443` (HTTPS) to route traffic. Binds `certs/nginx.conf` and SSL certificates into the container.
* **`backtest-ui`**: Serves the Vite React single-page application using Nginx. Routed on path `/backtest-ui/`.
* **`backtest-app`**: Node.js Express server running the main database interface, user administration, and virtual transaction engines.

### 3. Historical Backtesting Cluster

* **`backtest-streamer`**: WebSocket server (`ws://backtest-streamer:8085`) that streams ticks from JSON files. Volume-mounts `shared-exported-data` to access historical datasets.
* **`backtest-client`**: Bridges the streamer to Kafka by connecting to the streamer WebSocket and pushing ticks to the `backtest-stream-data` topic.

### 4. Live Data Feed Core

* **`upstock-login`**: Handles Upstox authentication callback and updates credentials in Redis and Mongo.
* **`connect-upstox-web-socket`**: Connects to the Upstox WebSocket API, decodes binary Protobuf data, and publishes to the `incoming-ws-msg` Kafka topic.

### 5. API Microservices

* **`get-ltp`**, **`get-ohlc`**, **`get-fullmarketquote`**: Retrieve pricing information from Upstox.
* **`get-orderbook`**, **`get-funds-and-margin`**: Retrieve execution book and leverage parameters.
* **`get-put-call-option-chain`**, **`get-option-contracts`**: Option analysis APIs.
* **`placeorder`**: Gateway routing orders to Upstox (live) or `backtest-app` (mock/virtual).

### 6. Event Consumers and Workers

* **`ws-data-splitter-consumer`**: Consumes from `incoming-ws-msg` and publishes parsed ticks to `splited-live-data` topic and Redis Pub/Sub channels.
* **`strategy-chooser-consumer`**: Inspects Redis active strategy listings and forwards ticks to specific strategy topics.
* **`storer-consumer-live`**: Stores ticks in `stock_live_data` database collections.
* **`order-storer-consumer`**: Stores executed orders in `order_details` collections.
* **`stream-to-client`**: Web Server bridging Redis Pub/Sub channels to UI WebSocket clients on `/clientstreamer`.
* **`msb-strategy-live`**: Evaluates trends and issues signals on live feeds.
* **`msb-strategy-backtest`**: Evaluates trends and issues signals on historical simulation feeds.

### 7. Scheduled Tasks

* **`msb-strategy-init-service`**: Scheduled options mapping cron task.
* **`scheduled-export-file`**: Daily exporter pulling data from MongoDB to the shared volume `/shared/exportedData/`.

---

## Data Volumes and Persistence

* **`mongodb-data-1`**, **`mongodb-data-2`**, **`mongodb-data-3`**: Store the MongoDB replica set data files, ensuring data survives container restarts.
* **`redis-data`**: Stores Redis key snapshots.
* **`shared-exported-data`**: Shared directory mounted at `/shared/exportedData` across `backtest-streamer` (read-only) and `scheduled-export-file` (read-write), enabling the backtest streamer to read historical ticks generated by the exporter.
