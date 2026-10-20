# MoneyMaker on Kubernetes

Shared manifests live under `base/`. Environment differences are Kustomize
overlays. Deploy with `./scripts/deploy-k8s.sh --overlay <name>`.

| Overlay | Target | Notes |
| --- | --- | --- |
| `full` | local **k3s** (install if missing) | Traefik Ingress; hostPorts for local debugging |
| `ci` | k3s / CI | E2E subset (`replicas: 0` for unused services) |
| `dev` | **minikube** | nginx Ingress; host `algo.mrcobra.link`; self-signed TLS |
| `prod` | **EKS** (apply-only) | ALB + ACM; Swarm replica floor restored on six services |

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

1. Start minikube and map the hostname to its IP:

```sh
minikube start
echo "$(minikube ip) algo.mrcobra.link" | sudo tee -a /etc/hosts
```

2. Build and deploy:

```sh
./scripts/build-images.sh --profile full
./scripts/deploy-k8s.sh --overlay dev
```

`deploy-k8s.sh --overlay dev` requires a running minikube cluster, enables the
ingress and metrics-server addons, loads local images, and does **not** install
k3s. TLS uses the existing self-signed cert from `certs/` (synced into
`k8s/base/files/`). Browsers will warn about the self-signed certificate.

## Prod (EKS + Terraform)

Infrastructure scaffold: [`terraform/prod`](../terraform/prod) (not applied by
this repo's scripts). Order of operations:

1. `terraform apply` in `terraform/prod` (see that README).
2. `aws eks update-kubeconfig` from the Terraform output.
3. Install the AWS Load Balancer Controller (Helm) using the IRSA role ARN.
4. Set `fileSystemId` in [`overlays/prod/efs-storageclass.yaml`](overlays/prod/efs-storageclass.yaml) from `efs_file_system_id`, then apply that StorageClass.
5. Set `CERTIFICATE_ARN` in [`overlays/prod/certificate-arn.env`](overlays/prod/certificate-arn.env) from `acm_certificate_arn`.
6. Push images to a registry the cluster can pull.
7. Deploy:

```sh
./scripts/deploy-k8s.sh --overlay prod --no-import
```

Prod apply skips k3s install, image import, and post-apply Ingress class
patches. The Ingress uses class `alb`, host `algo.mrcobra.link`, and ACM TLS at
the load balancer. `hostPort` bindings are removed. Mongo bootstrap signal and
`backtest-data` use ReadWriteMany (EFS).

After the ALB exists, set `alb_dns_name` / `alb_zone_id` in Terraform so Route 53
aliases `algo.mrcobra.link` to the load balancer.

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

## One-time AWS host migration (k3s EC2 path)

The GitHub Actions SSH job runs `./build-all.sh` on the Ubuntu host, which
deploys Kubernetes via the `full` overlay. Prepare the host once:

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

For the EKS path, use `terraform/prod` and `--overlay prod` instead.

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
