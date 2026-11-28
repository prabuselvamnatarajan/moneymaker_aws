#!/usr/bin/env bash
# Deploy the tested images to EKS (the deploy job in .github/workflows/deploy.yml).
#
#   1. Read infra values from ConfigMap kube-system/moneymaker-infra
#      (written by install-cluster-addons.sh after terraform apply).
#   2. Copy each custom image from Docker Hub <ns>/<name>:<tag> to ECR <name>:<tag>.
#   3. Point the prod overlay at ECR:<tag> and the ACM certificate.
#   4. Create Secret moneymaker-secrets (and the Docker Hub pull secret).
#   5. kubectl apply -k k8s/overlays/prod via deploy-k8s.sh and wait.
#   6. UPSERT Route 53 <domain> -> ALB and smoke-test /backtestapp/health.
#
# Required env:
#   AWS_REGION, CLUSTER_NAME
#   IMAGE_REGISTRY    Docker Hub namespace the CI build pushed to
#   IMAGE_TAG         immutable tag the build pushed (sha-<commit>)
#   PROD_APP_SECRETS  dotenv text for moneymaker-secrets (see deploy-secrets.example.txt)
# Optional env:
#   DOCKERHUB_USERNAME / DOCKERHUB_TOKEN  create the dockerhub-pull secret
#   SKIP_DNS=1  do not touch Route 53 (test a deploy without moving the domain)
#
# Safe to run from a laptop: the two overlay files it edits are restored on exit.
set -euo pipefail

: "${AWS_REGION:?}" "${CLUSTER_NAME:?}" "${IMAGE_REGISTRY:?}" "${IMAGE_TAG:?}"
: "${PROD_APP_SECRETS:?PROD_APP_SECRETS (GitHub secret) is required}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAMESPACE=moneymaker
OVERLAY_DIR="$ROOT/k8s/overlays/prod"

log() { printf '[deploy-prod] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

# Keys every workload expects in moneymaker-secrets (mirrors k8s/base/config/app-secrets.yaml).
REQUIRED_SECRET_KEYS="MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD MONGO_URI MONGODB_URI REDIS_PASSWORD REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET BACKTEST_SERVICE_TOKEN ME_CONFIG_MONGODB_ADMINUSERNAME ME_CONFIG_MONGODB_ADMINPASSWORD ME_CONFIG_MONGODB_URL"

log "Configuring kubectl for $CLUSTER_NAME"
aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null

infra() {
  kubectl -n kube-system get configmap moneymaker-infra -o "jsonpath={.data.$1}"
}
kubectl -n kube-system get configmap moneymaker-infra >/dev/null 2>&1 \
  || die "ConfigMap kube-system/moneymaker-infra missing; run the Infrastructure Apply workflow first"
CERT_ARN="$(infra CERTIFICATE_ARN)"
ECR_REGISTRY="$(infra ECR_REGISTRY)"
DOMAIN_NAME="$(infra DOMAIN_NAME)"
ZONE_ID="$(infra ROUTE53_ZONE_ID)"
ECR_REPOSITORIES="$(infra ECR_REPOSITORIES)"
[ -n "$CERT_ARN" ] && [ -n "$ECR_REGISTRY" ] && [ -n "$ECR_REPOSITORIES" ] || die "moneymaker-infra ConfigMap is incomplete"

# Every :latest image without a registry in the prod render must have an ECR repo.
_rendered_custom=$(kubectl kustomize "$OVERLAY_DIR" | sed -n 's/^ *\(- \)\{0,1\}image: \([a-z0-9-]*\):latest$/\2/p' | sort -u)
for _img in $_rendered_custom; do
  case "$_img" in
    nginx|mongo-express) continue ;;  # third-party images that happen to use :latest
  esac
  case " $ECR_REPOSITORIES " in
    *" $_img "*) ;;
    *) die "image $_img has no ECR repository; add it to ecr_repositories in terraform/prod/variables.tf" ;;
  esac
done

# --- 2. Copy images Docker Hub -> ECR --------------------------------------
log "Logging in to ECR $ECR_REGISTRY"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null

for _img in $ECR_REPOSITORIES; do
  if aws ecr describe-images --region "$AWS_REGION" --repository-name "$_img" \
       --image-ids imageTag="$IMAGE_TAG" >/dev/null 2>&1; then
    log "ECR already has $_img:$IMAGE_TAG"
    continue
  fi
  log "Copying docker.io/$IMAGE_REGISTRY/$_img:$IMAGE_TAG -> $ECR_REGISTRY/$_img:$IMAGE_TAG"
  docker buildx imagetools create \
    --tag "$ECR_REGISTRY/$_img:$IMAGE_TAG" \
    "docker.io/$IMAGE_REGISTRY/$_img:$IMAGE_TAG"
done

# --- 3. Render-time overlay inputs (restored on exit, never committed) -----
_backup_dir="$(mktemp -d)"
cp "$OVERLAY_DIR/kustomization.yaml" "$OVERLAY_DIR/certificate-arn.env" "$_backup_dir/"
_secret_file=""
cleanup() {
  cp "$_backup_dir/kustomization.yaml" "$_backup_dir/certificate-arn.env" "$OVERLAY_DIR/"
  rm -rf "$_backup_dir"
  [ -z "$_secret_file" ] || rm -f "$_secret_file"
}
trap cleanup EXIT
printf 'CERTIFICATE_ARN=%s\n' "$CERT_ARN" > "$OVERLAY_DIR/certificate-arn.env"
{
  printf '\n# Added by scripts/aws/deploy-prod.sh\nimages:\n'
  for _img in $ECR_REPOSITORIES; do
    printf '  - name: %s\n    newName: %s/%s\n    newTag: "%s"\n' "$_img" "$ECR_REGISTRY" "$_img" "$IMAGE_TAG"
  done
} >> "$OVERLAY_DIR/kustomization.yaml"

# --- 4. Namespace and secrets ----------------------------------------------
kubectl apply -f "$ROOT/k8s/base/namespace.yaml" >/dev/null

_secret_file="$(mktemp)"
chmod 600 "$_secret_file"
printf '%s\n' "$PROD_APP_SECRETS" | tr -d '\r' | grep -Ev '^[[:space:]]*(#|$)' > "$_secret_file" || true
for _k in $REQUIRED_SECRET_KEYS; do
  grep -q "^${_k}=" "$_secret_file" || die "PROD_APP_SECRETS is missing $_k"
done
log "Applying Secret moneymaker-secrets"
kubectl -n "$NAMESPACE" create secret generic moneymaker-secrets \
  --from-env-file="$_secret_file" --dry-run=client -o yaml \
  | kubectl label --local -f - app.kubernetes.io/part-of=moneymaker -o yaml \
  | kubectl apply -f - >/dev/null

if [ -n "${DOCKERHUB_TOKEN:-}" ] && [ -n "${DOCKERHUB_USERNAME:-}" ]; then
  log "Applying Docker Hub pull secret"
  kubectl -n "$NAMESPACE" create secret docker-registry dockerhub-pull \
    --docker-server=https://index.docker.io/v1/ \
    --docker-username="$DOCKERHUB_USERNAME" \
    --docker-password="$DOCKERHUB_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

# --- 5. Apply and wait -----------------------------------------------------
"$ROOT/scripts/deploy-k8s.sh" --overlay prod --no-import --no-detach

# --- 6. DNS + smoke test ---------------------------------------------------
log "Waiting for the ALB hostname on Ingress moneymaker"
ALB_HOST=""
for _i in $(seq 1 60); do
  ALB_HOST="$(kubectl -n "$NAMESPACE" get ingress moneymaker -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [ -n "$ALB_HOST" ] && break
  sleep 10
done
[ -n "$ALB_HOST" ] || die "Ingress has no ALB hostname after 10 minutes (check aws-load-balancer-controller logs)"
log "ALB: $ALB_HOST"

ALB_ZONE_ID="$(aws elbv2 describe-load-balancers --region "$AWS_REGION" \
  --query "LoadBalancers[?DNSName=='$ALB_HOST'].CanonicalHostedZoneId | [0]" --output text)"
[ -n "$ALB_ZONE_ID" ] && [ "$ALB_ZONE_ID" != "None" ] || die "could not find the ALB's hosted zone id"

if [ "${SKIP_DNS:-0}" = "1" ]; then
  log "SKIP_DNS=1: leaving Route 53 $DOMAIN_NAME unchanged"
else
log "UPSERT Route 53 $DOMAIN_NAME -> $ALB_HOST"
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$(jq -cn \
  --arg name "$DOMAIN_NAME" --arg host "$ALB_HOST" --arg zone "$ALB_ZONE_ID" '{
    Comment: "moneymaker deploy",
    Changes: [{Action: "UPSERT", ResourceRecordSet: {
      Name: $name, Type: "A",
      AliasTarget: {HostedZoneId: $zone, DNSName: $host, EvaluateTargetHealth: true}}}]}')" >/dev/null
fi

log "Smoke test https://$DOMAIN_NAME/backtestapp/health via the ALB"
for _i in $(seq 1 30); do
  # -k: hit the ALB by its own name, so the cert (issued for $DOMAIN_NAME) won't match.
  if curl -fsSk -o /dev/null -H "Host: $DOMAIN_NAME" "https://$ALB_HOST/backtestapp/health"; then
    log "Deploy of $IMAGE_TAG is healthy"
    exit 0
  fi
  sleep 10
done
die "health check did not pass within 5 minutes"
