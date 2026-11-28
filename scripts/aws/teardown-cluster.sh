#!/usr/bin/env bash
# Remove everything Kubernetes created in AWS outside Terraform, so that
# `terraform destroy` in terraform/prod can delete the VPC cleanly:
#   - Route 53 alias record for the domain (UPSERTed by deploy-prod.sh)
#   - the app namespace: Ingress -> ALB + its security groups, PVCs -> EBS volumes
#   - EFS access points created dynamically by the EFS CSI driver
#   - Helm releases installed by install-cluster-addons.sh
#
# Required env: AWS_REGION, CLUSTER_NAME
# THIS DELETES ALL APPLICATION DATA (Mongo, Redis, backtest volumes).
set -euo pipefail

: "${AWS_REGION:?}" "${CLUSTER_NAME:?}"
NAMESPACE=moneymaker
log() { printf '[teardown] %s\n' "$*"; }

if ! aws eks describe-cluster --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null 2>&1; then
  log "Cluster $CLUSTER_NAME not found; nothing to clean up in Kubernetes"
  exit 0
fi

aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null

infra() {
  kubectl -n kube-system get configmap moneymaker-infra -o "jsonpath={.data.$1}" 2>/dev/null || true
}
DOMAIN_NAME="$(infra DOMAIN_NAME)"
ZONE_ID="$(infra ROUTE53_ZONE_ID)"
EFS_ID="$(infra EFS_FILE_SYSTEM_ID)"

# --- DNS record --------------------------------------------------------------
if [ -n "$DOMAIN_NAME" ] && [ -n "$ZONE_ID" ]; then
  _rr="$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${DOMAIN_NAME}.' && Type=='A'] | [0]" --output json)"
  # Only remove the alias deploy-prod.sh created. A plain A record (e.g. the
  # old EC2 IP while testing with SKIP_DNS=1) is live traffic: leave it.
  _alias="$(printf '%s' "$_rr" | jq -r '.AliasTarget.DNSName // empty' 2>/dev/null || true)"
  if [ "$_rr" != "null" ] && [ -n "$_rr" ] && printf '%s' "$_alias" | grep -q 'elb\.amazonaws\.com\.\{0,1\}$'; then
    log "Deleting Route 53 alias $DOMAIN_NAME -> $_alias"
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
      --change-batch "$(jq -cn --argjson rr "$_rr" '{Changes: [{Action: "DELETE", ResourceRecordSet: $rr}]}')" >/dev/null
  elif [ "$_rr" != "null" ] && [ -n "$_rr" ]; then
    log "Route 53 $DOMAIN_NAME is not a load-balancer alias; leaving it"
  fi
fi

# --- Namespace (ALB, EBS volumes) ---------------------------------------------
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  log "Deleting Ingress (removes the ALB)"
  kubectl -n "$NAMESPACE" delete ingress --all --wait=true --timeout=10m || true
  log "Deleting namespace $NAMESPACE (PVCs -> EBS volumes)"
  kubectl delete namespace "$NAMESPACE" --wait=true --timeout=20m
fi

log "Waiting for controller-managed load balancers to disappear"
for _i in $(seq 1 60); do
  _lbs="$(aws resourcegroupstaggingapi get-resources --region "$AWS_REGION" \
    --resource-type-filters elasticloadbalancing:loadbalancer \
    --tag-filters "Key=elbv2.k8s.aws/cluster,Values=$CLUSTER_NAME" \
    --query 'length(ResourceTagMappingList)' --output text)"
  [ "$_lbs" = "0" ] && break
  sleep 10
done

log "Waiting for dynamically provisioned PersistentVolumes to be released"
for _i in $(seq 1 60); do
  _pvs="$(kubectl get pv -o jsonpath='{range .items[?(@.spec.storageClassName=="gp3")]}{.metadata.name}{"\n"}{end}' | grep -c . || true)"
  [ "$_pvs" = "0" ] && break
  sleep 10
done

# --- Dynamic EFS access points (efs-sc) ---------------------------------------
if [ -n "$EFS_ID" ]; then
  for _ap in $(aws efs describe-access-points --region "$AWS_REGION" --file-system-id "$EFS_ID" \
      --query "AccessPoints[?!(Tags[?Key=='Name' && (Value=='${CLUSTER_NAME}-mongo-init' || Value=='${CLUSTER_NAME}-backtest-data')])].AccessPointId" \
      --output text); do
    log "Deleting EFS access point $_ap"
    aws efs delete-access-point --region "$AWS_REGION" --access-point-id "$_ap"
  done
fi

# --- Helm releases ------------------------------------------------------------
helm -n kube-system uninstall cluster-autoscaler --wait 2>/dev/null || true
helm -n kube-system uninstall aws-load-balancer-controller --wait 2>/dev/null || true
helm -n kube-system uninstall metrics-server --wait 2>/dev/null || true

# --- Leftover controller security groups block VPC deletion -------------------
_vpc="$(aws eks describe-cluster --region "$AWS_REGION" --name "$CLUSTER_NAME" --query 'cluster.resourcesVpcConfig.vpcId' --output text)"
for _sg in $(aws ec2 describe-security-groups --region "$AWS_REGION" \
    --filters "Name=vpc-id,Values=$_vpc" "Name=tag:elbv2.k8s.aws/cluster,Values=$CLUSTER_NAME" \
    --query 'SecurityGroups[].GroupId' --output text); do
  log "Deleting leftover security group $_sg"
  aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$_sg" || true
done

log "Kubernetes-side cleanup done; terraform destroy can run now"
