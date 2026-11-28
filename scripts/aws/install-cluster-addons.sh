#!/usr/bin/env bash
# Install the cluster-level pieces Terraform does not manage, after
# `terraform apply` in terraform/prod:
#   - AWS Load Balancer Controller (Helm, IRSA role from Terraform)
#   - metrics-server (Helm; HPAs need it)
#   - StorageClasses gp3 (default) and efs-sc (k8s/cluster/storageclasses.yaml)
#   - ConfigMap kube-system/moneymaker-infra with the Terraform outputs the
#     app deploy needs, so the deploy job never has to read Terraform state.
#
# Usage: terraform -chdir=terraform/prod output -json > outputs.json
#        TF_OUTPUTS=outputs.json ./scripts/aws/install-cluster-addons.sh
set -euo pipefail

ALB_CONTROLLER_CHART_VERSION="${ALB_CONTROLLER_CHART_VERSION:-3.7.0}"
METRICS_SERVER_CHART_VERSION="${METRICS_SERVER_CHART_VERSION:-3.12.2}"

: "${TF_OUTPUTS:?TF_OUTPUTS must point at terraform output -json}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

log() { printf '[install-cluster-addons] %s\n' "$*"; }
out() { jq -er --arg k "$1" '.[$k].value' "$TF_OUTPUTS"; }

CLUSTER_NAME="$(out cluster_name)"
AWS_REGION="$(out aws_region)"
VPC_ID="$(out vpc_id)"
ALB_ROLE_ARN="$(out alb_controller_role_arn)"
EFS_ID="$(out efs_file_system_id)"
CERT_ARN="$(out acm_certificate_arn)"
ECR_REGISTRY="$(out ecr_registry)"
DOMAIN_NAME="$(out domain_name)"
ZONE_ID="$(out route53_zone_id)"
ECR_REPOSITORIES="$(jq -er '.ecr_repositories.value | join(" ")' "$TF_OUTPUTS")"

log "Configuring kubectl for $CLUSTER_NAME ($AWS_REGION)"
aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME"

# Access entries can take a few seconds to become effective after apply.
for _i in $(seq 1 30); do
  kubectl get nodes >/dev/null 2>&1 && break
  sleep 10
done
kubectl wait --for=condition=Ready nodes --all --timeout=600s

log "Installing AWS Load Balancer Controller chart $ALB_CONTROLLER_CHART_VERSION"
helm repo add eks https://aws.github.io/eks-charts >/dev/null 2>&1 || true
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ >/dev/null 2>&1 || true
helm repo update >/dev/null
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --version "$ALB_CONTROLLER_CHART_VERSION" \
  --set clusterName="$CLUSTER_NAME" \
  --set region="$AWS_REGION" \
  --set vpcId="$VPC_ID" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$ALB_ROLE_ARN" \
  --wait --timeout 10m

log "Installing metrics-server chart $METRICS_SERVER_CHART_VERSION"
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --version "$METRICS_SERVER_CHART_VERSION" \
  --wait --timeout 10m

log "Applying StorageClasses (efs-sc -> $EFS_ID)"
# Older clusters ship gp2 as default; only one class may be the default.
if kubectl get storageclass gp2 >/dev/null 2>&1; then
  kubectl annotate storageclass gp2 storageclass.kubernetes.io/is-default-class=false --overwrite
fi
sed "s/__EFS_FILE_SYSTEM_ID__/$EFS_ID/" "$ROOT/k8s/cluster/storageclasses.yaml" | kubectl apply -f -

log "Publishing Terraform outputs to ConfigMap kube-system/moneymaker-infra"
kubectl -n kube-system create configmap moneymaker-infra \
  --from-literal=CLUSTER_NAME="$CLUSTER_NAME" \
  --from-literal=AWS_REGION="$AWS_REGION" \
  --from-literal=CERTIFICATE_ARN="$CERT_ARN" \
  --from-literal=ECR_REGISTRY="$ECR_REGISTRY" \
  --from-literal=DOMAIN_NAME="$DOMAIN_NAME" \
  --from-literal=ROUTE53_ZONE_ID="$ZONE_ID" \
  --from-literal=EFS_FILE_SYSTEM_ID="$EFS_ID" \
  --from-literal=ECR_REPOSITORIES="$ECR_REPOSITORIES" \
  --dry-run=client -o yaml | kubectl apply -f -

log "Cluster add-ons ready"
