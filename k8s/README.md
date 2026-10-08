# MoneyMaker on Kubernetes

This directory is the MoneyMaker runtime: a single-node **k3s** cluster.
Service DNS names, environment variables, baseline replica counts, published
host ports, and nginx path routing match the previous stack so application
code keeps working unchanged. [`docker-compose.yml`](../docker-compose.yml) is
only a catalog of that layout. Deploy with `./scripts/deploy-k8s.sh`.

Stateless Deployments start at **1** replica. Each has a HorizontalPodAutoscaler
that adds one pod when CPU or memory stays at or above **90%** of the container
request (`maxReplicas: 5`). Services that bind a host port (`upstock-login`,
`mongo-express`, `redisinsight`) stay at one pod, because a second pod cannot
bind the same host port. Mongo, Kafka, Redis, and Zookeeper stay fixed
StatefulSets. The CI overlay removes the autoscalers so E2E replica counts stay
pinned. HPA needs metrics-server (built into k3s; `deploy-k8s.sh` enables the
minikube addon).

Host ports (same as before; HTTP/HTTPS stay on Traefik, which forwards to
`reverse-proxy`):

| Service | Host port |
| --- | --- |
| zookeeper | 2181 |
| kafka-broker-1 / 2 / 3 | 9092 / 9093 / 9094 |
| mongo1 / mongo2 / mongo3 | 27017 / 27018 / 27019 |
| redis | 6379 |
| mongo-express | 8081 |
| redisinsight | 8001 |
| upstock-login | 8080 |
| Ingress (Traefik → reverse-proxy) | 80, 443 |

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
  overlays/full/        # Full production-like stack
  overlays/ci/          # E2E subset (replicas=0 for unused services; CI nginx config)
```

## Local / CI deploy

```sh
./scripts/build-images.sh --profile full   # or --profile e2e
./scripts/deploy-k8s.sh --overlay full     # or --overlay ci

# Or both:
./build-all.sh
./build-all.sh --profile e2e --overlay ci --detach
```

`deploy-k8s.sh` will install k3s if no cluster is reachable, sync cert/keyfile
copies into `k8s/base/files/`, import local Docker images into k3s containerd,
and `kubectl apply -k` the chosen overlay.

## One-time AWS host migration (required before the next main deploy)

The GitHub Actions SSH job runs `./build-all.sh` on the Ubuntu host, which
deploys Kubernetes. Prepare the host once:

1. **Free ports 80 and 443** if an older Docker stack is still bound to them:
   ```sh
   docker stack rm moneymaker || true
   docker swarm leave --force || true
   ```
2. **Install k3s** (or let the first `./scripts/deploy-k8s.sh` do it as root/sudo):
   ```sh
   curl -sfL https://get.k3s.io | sudo sh -
   mkdir -p ~/.kube
   sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
   sudo chown "$USER:$USER" ~/.kube/config
   ```
3. **Confirm ports** 80 and 443 are free for Traefik (k3s Ingress).
4. **Pull and deploy**:
   ```sh
   cd /home/ubuntu/moneymaker_aws
   git pull origin main
   ./build-all.sh
   ```

## Tear down

```sh
./kill-moneymaker.sh            # keep PVCs (Mongo/Redis/shared data)
./kill-moneymaker.sh --wipe-data  # delete the whole namespace including PVCs
```

## Seed

```sh
./clear-and-seed.sh --yes
```

Runs `clear_and_seed.js` via `kubectl exec` in the `backtest-app` pod.
