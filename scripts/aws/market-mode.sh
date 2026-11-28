#!/usr/bin/env bash
# Market-hours capacity for prod (EKS). Indian equity market: 09:15-15:30 IST,
# Monday-Friday. Outside that window live-trading services sleep and the
# node group may shrink; backtesting, the UI and the data stores stay up.
#
#   ./scripts/aws/market-mode.sh open    full capacity
#   ./scripts/aws/market-mode.sh close   after-hours capacity
#   ./scripts/aws/market-mode.sh auto    open or close from the IST clock (default)
#
# Run by .github/workflows/market-hours.yml on a schedule and by
# scripts/aws/deploy-prod.sh after every deploy (a deploy re-applies the
# manifests, i.e. market-hours replicas, so auto puts it back to close).
#
# open  : SLEEP and REDUCE workloads back to their recorded market-hours
#         replicas / HPA minimums; node group min = MARKET_MIN_NODES.
# close : record those values in annotations, scale SLEEP to 0, REDUCE to 1;
#         node group min = AFTER_HOURS_MIN_NODES. Cluster Autoscaler then
#         removes the nodes that are no longer needed (~10-20 min).
#
# Required env: AWS_REGION, CLUSTER_NAME
# Idempotent: running the same mode twice changes nothing.
set -euo pipefail

: "${AWS_REGION:?}" "${CLUSTER_NAME:?}"
MODE="${1:-auto}"
NAMESPACE=moneymaker
MARKET_MIN_NODES="${MARKET_MIN_NODES:-4}"
AFTER_HOURS_MIN_NODES="${AFTER_HOURS_MIN_NODES:-1}"
# open window in IST, Monday(1)-Friday(5): 08:00 <= now < 16:00
OPEN_FROM="${OPEN_FROM:-0800}"
OPEN_UNTIL="${OPEN_UNTIL:-1600}"

# Live trading only: Upstox feed and broker APIs, live strategies, admin UIs.
SLEEP="
connect-upstox-web-socket
upstock-login
get-fullmarketquote
get-orderbook
get-funds-and-margin
get-option-contracts
msb-strategy
msb-pts-strategy
liquidity-sweep-strategy
mongo-express
redisinsight
"
# Shared by live trading and backtests: keep 1 replica after hours instead of
# the market-hours floor of 3.
REDUCE="
wsdatasplitter-consumer
price-storer-consumer
order-storer-consumer
strategy-chooser-consumer
timeframe-constructor
backtest-streamer
backtest-client
"
# Everything else (Mongo, Redis, Kafka, ZooKeeper, reverse-proxy, backtest-app,
# backtest-ui, *-strategy-backtest, placeorder, get-ltp, get-ohlc, option
# chain, position tracker, symbol resolver, stream-to-client, exporttofile)
# runs unchanged around the clock.

ANN_REPLICAS=moneymaker.io/market-replicas
ANN_HPA_MIN=moneymaker.io/market-min-replicas

log() { printf '[market-mode] %s\n' "$*"; }

if [ "$MODE" = "auto" ]; then
  _dow=$(TZ=Asia/Kolkata date +%u)
  _now=$(TZ=Asia/Kolkata date +%H%M)
  if [ "$_dow" -le 5 ] && [ "$_now" -ge "$OPEN_FROM" ] && [ "$_now" -lt "$OPEN_UNTIL" ]; then
    MODE=open
  else
    MODE=close
  fi
  log "auto: $(TZ=Asia/Kolkata date '+%a %H:%M IST') -> $MODE"
fi
case "$MODE" in
  open|close) ;;
  *) echo "usage: $0 open|close|auto" >&2; exit 1 ;;
esac

aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER_NAME" >/dev/null

exists() { kubectl -n "$NAMESPACE" get "$1" "$2" >/dev/null 2>&1; }
get() { kubectl -n "$NAMESPACE" get "$1" "$2" -o "jsonpath=$3" 2>/dev/null || true; }

# Remember the market-hours value once, from a live object that still has it.
remember() { # kind name annotation current
  _have=$(get "$1" "$2" "{.metadata.annotations.moneymaker\.io/${3#moneymaker.io/}}")
  if [ -z "$_have" ] || { [ "$4" -gt 1 ] && [ "$4" != "$_have" ]; }; then
    kubectl -n "$NAMESPACE" annotate "$1" "$2" "$3=$4" --overwrite >/dev/null
  fi
}

close_deploy() { # name target_replicas
  exists deployment "$1" || { log "skip $1 (not deployed)"; return 0; }
  _cur=$(get deployment "$1" '{.spec.replicas}')
  [ "${_cur:-0}" -gt 0 ] && remember deployment "$1" "$ANN_REPLICAS" "$_cur"
  if exists hpa "$1"; then
    _min=$(get hpa "$1" '{.spec.minReplicas}')
    [ "${_min:-1}" -gt 1 ] && remember hpa "$1" "$ANN_HPA_MIN" "$_min"
    [ "${_min:-1}" -gt 1 ] && kubectl -n "$NAMESPACE" patch hpa "$1" --type merge -p '{"spec":{"minReplicas":1}}' >/dev/null
  fi
  # replicas=0 also pauses the HPA (it does not scale a Deployment up from 0).
  if [ "${_cur:-0}" != "$2" ]; then
    log "$1: $_cur -> $2"
    kubectl -n "$NAMESPACE" scale deployment "$1" --replicas="$2" >/dev/null
  fi
}

open_deploy() { # name
  exists deployment "$1" || { log "skip $1 (not deployed)"; return 0; }
  if exists hpa "$1"; then
    _want_min=$(get hpa "$1" "{.metadata.annotations.moneymaker\.io/market-min-replicas}")
    _min=$(get hpa "$1" '{.spec.minReplicas}')
    if [ -n "$_want_min" ] && [ "$_want_min" != "$_min" ]; then
      kubectl -n "$NAMESPACE" patch hpa "$1" --type merge -p "{\"spec\":{\"minReplicas\":$_want_min}}" >/dev/null
    fi
  fi
  _want=$(get deployment "$1" "{.metadata.annotations.moneymaker\.io/market-replicas}")
  _want=${_want:-1}
  _cur=$(get deployment "$1" '{.spec.replicas}')
  if [ "${_cur:-0}" -lt "$_want" ]; then
    log "$1: $_cur -> $_want"
    kubectl -n "$NAMESPACE" scale deployment "$1" --replicas="$_want" >/dev/null
  fi
}

nodegroup_min() { # min
  _ng=$(kubectl -n kube-system get configmap moneymaker-infra -o 'jsonpath={.data.NODE_GROUP_NAME}' 2>/dev/null || true)
  if [ -z "$_ng" ]; then
    log "WARNING: NODE_GROUP_NAME missing from moneymaker-infra; node group left as is (re-run Infrastructure Apply)"
    return 0
  fi
  read -r _cmin _cdes _cmax <<EOF2
$(aws eks describe-nodegroup --region "$AWS_REGION" --cluster-name "$CLUSTER_NAME" --nodegroup-name "$_ng" \
    --query 'nodegroup.scalingConfig.[minSize,desiredSize,maxSize]' --output text)
EOF2
  [ "$1" -le "$_cmax" ] || { log "WARNING: min $1 > max $_cmax; using $_cmax"; set -- "$_cmax"; }
  _des=$_cdes
  [ "$_des" -lt "$1" ] && _des=$1
  if [ "$_cmin" != "$1" ] || [ "$_cdes" != "$_des" ]; then
    log "node group $_ng: min $_cmin -> $1, desired $_cdes -> $_des (max $_cmax)"
    aws eks update-nodegroup-config --region "$AWS_REGION" --cluster-name "$CLUSTER_NAME" \
      --nodegroup-name "$_ng" --scaling-config "minSize=$1,maxSize=$_cmax,desiredSize=$_des" >/dev/null
  else
    log "node group $_ng already min=$1"
  fi
}

if [ "$MODE" = "open" ]; then
  # Nodes first, so pods have somewhere to start.
  nodegroup_min "$MARKET_MIN_NODES"
  for _d in $SLEEP $REDUCE; do open_deploy "$_d"; done
else
  for _d in $SLEEP; do close_deploy "$_d" 0; done
  for _d in $REDUCE; do close_deploy "$_d" 1; done
  # Lower the floor only; Cluster Autoscaler drains and removes spare nodes.
  nodegroup_min "$AFTER_HOURS_MIN_NODES"
fi
log "mode=$MODE applied"
