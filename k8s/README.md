# MoneyMaker on Kubernetes

Shared manifests live under `base/`. Environment differences are Kustomize
overlays. Deploy with `./scripts/deploy-k8s.sh --overlay <name>`.

| Overlay | Target | Notes |
| --- | --- | --- |
| `full` | local **k3s** (install if missing) | Traefik Ingress; hostPorts for local debugging |
| `ci` | k3s / CI | E2E subset (`replicas: 0` for unused services) |
| `dev` | **minikube** | nginx Ingress; host `algo.mrcobra.link`; self-signed TLS |
| `prod` | **EKS** (via GitHub Actions) | ALB + ACM; ECR images; Swarm replica floor restored on six services |

CPU, memory, application passwords, nginx, and `common-env` stay in the shared
base for every overlay. Autoscaling policy (`maxReplicas: 5`, 90% CPU/memory,
scale windows) is unchanged. Prod only raises **replicas and `minReplicas` to 3**
for the services that ran at 3 replicas in Swarm:

- `wsdatasplitter-consumer`
- `price-storer-consumer`
- `order-storer-consumer`
- `strategy-chooser-consumer`
- `backtest-streamer`
- `backtest-client`

HPA needs metrics-server (built into k3s; `deploy-k8s.sh` enables the minikube
addon for `dev` / local minikube).

## Layout

```
k8s/
  base/                 # One file per service, grouped by folder
    config/             # Shared Secret and ConfigMap
    data/               # Mongo, Redis, Kafka, Zookeeper
    gateway/            # reverse-proxy and Ingress
    backtest/           # backtest-app, ui, streamer, client
    consumers/          # Kafka consumers
    microservices/      # REST microservices (get-ltp, placeorder, ...)
    strategies/         # Strategy workers
    scheduled/          # appinit Job, export, mongo-express, redisinsight
    files/              # nginx.conf, TLS, mongo keyfile (copied at deploy)
  overlays/full/        # Local k3s full stack
  overlays/ci/          # E2E subset
  overlays/dev/         # minikube + nginx + algo.mrcobra.link
  overlays/prod/        # EKS + ALB/ACM + replica floor + RWX volumes
```

## Dev (minikube)

1. Start minikube and map the hostname in `/etc/hosts`:

```sh
minikube start
# With minikube tunnel (Docker driver), the tunnel binds ports on 127.0.0.1:
echo "127.0.0.1 algo.mrcobra.link" | sudo tee -a /etc/hosts
```

2. Build and deploy:

```sh
./scripts/build-images.sh --profile full
./scripts/deploy-k8s.sh --overlay dev
```

3. Run `minikube tunnel` (in a separate terminal or as a service):

```sh
minikube tunnel
```

`deploy-k8s.sh --overlay dev` requires a running minikube cluster, enables the
ingress and metrics-server addons, loads local images, and does **not** install
k3s.

The `dev` overlay patches `mongo-express` (port 8081) and `redisinsight` (port 8001)
to `type: LoadBalancer`. With `minikube tunnel` running, `minikube tunnel` routes traffic to them,
making them directly accessible from your host at:
- **Web App / BackTest UI**: `https://algo.mrcobra.link/backtest-ui/`
- **Mongo Express**: `http://algo.mrcobra.link:8081/` or `http://localhost:8081/`
- **RedisInsight**: `http://algo.mrcobra.link:8001/` or `http://localhost:8001/`

*(If `minikube tunnel` is not active, you can alternatively use `kubectl -n moneymaker port-forward svc/mongo-express 8081:8081` and `kubectl -n moneymaker port-forward svc/redisinsight 8001:8001`)*

TLS uses the existing self-signed cert from `certs/` (synced into `k8s/base/files/`).
Browsers will warn about the self-signed certificate.

## Prod (EKS + Terraform)

Prod runs on EKS and is driven entirely by GitHub Actions:

| Workflow | When | What |
| --- | --- | --- |
| `infra-apply.yml` | manual | `terraform/prod` plan → approval → apply, then `scripts/aws/install-cluster-addons.sh` (ALB controller, metrics-server, `k8s/cluster/storageclasses.yaml`) |
| `deploy.yml` → **Deploy to EKS** | every push to `main` after unit + e2e pass | `scripts/aws/deploy-prod.sh`: copy `sha-<commit>` images Docker Hub → ECR, create `moneymaker-secrets` from `PROD_APP_SECRETS`, `deploy-k8s.sh --overlay prod`, point `algo.mrcobra.link` at the ALB, smoke test |
| `market-hours.yml` | 08:17 and 16:07 IST Mon–Fri (+ retries) | `scripts/aws/market-mode.sh auto`: open = full capacity, close = live-trading services to 0, shared ones to 1, node floor 4 → 1 |
| `infra-destroy.yml` | manual | `scripts/aws/teardown-cluster.sh` (DNS, namespace, ALB, volumes) then `terraform destroy` |

Setup order and GitHub settings: [`terraform/prod/README.md`](../terraform/prod/README.md)
and [`.github/workflows/deploy-secrets.example.txt`](../.github/workflows/deploy-secrets.example.txt).

### Market-hours capacity

Nodes are `t3a.large` (2 vCPU / 8 GiB) in one AZ, sized by Cluster Autoscaler
between the node group's min and max (6). `market-mode.sh` moves the min:

| | Market (08:00–16:00 IST, Mon–Fri) | After hours / weekends |
| --- | --- | --- |
| Live trading (Upstox feed + login, quote/orderbook/funds/contracts APIs, live strategies, mongo-express, redisinsight) | normal | **0** |
| Shared consumers, backtest-streamer/client (floor 3) | 3 (HPA up to 5) | **1** |
| Mongo, Redis, Kafka, backtest-app/UI, `*-backtest` strategies, placeorder, LTP/OHLC/option chain, … | normal | normal |
| Node group min | 4 | 1 (autoscaler removes idle nodes) |

Edit the `SLEEP` / `REDUCE` lists at the top of `scripts/aws/market-mode.sh`
to change what sleeps. Force a mode: Actions → Market Hours Capacity → Run
workflow (`open` / `close`). Every deploy runs `auto`, so a deploy at night
does not wake live trading.

What the `prod` overlay changes vs base: Ingress class `alb`, host
`algo.mrcobra.link`, ACM TLS at the ALB, ALB → `reverse-proxy:443` (HTTPS) with
health check `/backtestapp/health`; `hostPort` removed; Mongo bootstrap signal
and `backtest-data` on EFS (RWX); replica floor of 3 on six services; the base
dev Secret `moneymaker-secrets` is dropped (created by the deploy instead);
every workload gets `imagePullSecrets: dockerhub-pull`. Image names are pointed
at ECR by an `images:` block the deploy appends on the runner.

## Local / CI (full and ci)

```sh
./scripts/build-images.sh --profile full   # or --profile e2e
./scripts/deploy-k8s.sh --overlay full     # or --overlay ci

# Or both:
./build-all.sh
./build-all.sh --profile e2e --overlay ci --detach
```

`deploy-k8s.sh` (full/ci) will install k3s if no cluster is reachable, sync
cert/keyfile copies into `k8s/base/files/`, import local Docker images into k3s
containerd (or minikube), and `kubectl apply -k` the chosen overlay.

Host ports on the **full** overlay (HTTP/HTTPS stay on Traefik → reverse-proxy):

| Service | Host port |
| --- | --- |
| zookeeper | 2181 |
| kafka-broker-1 / 2 / 3 | 9092 / 9093 / 9094 |
| mongo1 / mongo2 / mongo3 | 27017 / 27018 / 27019 |
| redis | 6379 |
| mongo-express | 8081 |
| redisinsight | 8001 |
| Ingress (Traefik → reverse-proxy) | 80, 443 |

## Old EC2 + k3s host

Production used to be a single EC2 host deployed over SSH with the `full`
overlay. That job has been removed from `deploy.yml`. Once EKS is serving
`algo.mrcobra.link`, the old instance can be stopped. The `full` overlay is still
used for local k3s.

## Tear down

```sh
./kill-moneymaker.sh            # keep PVCs (Mongo/Redis/shared data)
./kill-moneymaker.sh --wipe-data  # delete namespace + PVCs + Mongo init-signal hostPath
```

`--wipe-data` also clears `/var/lib/moneymaker/mongo-init-signal` on the node
(minikube/k3s hostPath). Leaving that signal after wiping PVCs used to skip
`rs.initiate` and leave apps stuck on `ReplicaSetNoPrimary`. Bootstrap scripts
also re-validate the signal: if `done` exists but the replica set is not
configured, they clear it and re-bootstrap.

## Seed

```sh
./clear-and-seed.sh --yes
```

Runs `clear_and_seed.js` via `kubectl exec` in the `backtest-app` pod.
