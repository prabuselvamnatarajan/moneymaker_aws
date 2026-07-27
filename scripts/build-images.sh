#!/bin/sh
# Build MoneyMaker Docker images (no Swarm deploy).
#
# Usage:
#   ./scripts/build-images.sh
#   ./scripts/build-images.sh --profile e2e
#   ./scripts/build-images.sh --profile full --parallel 4
#   ./scripts/build-images.sh --help
#
# Profiles:
#   full — all custom images used by docker-compose.yml (default)
#   e2e  — BackTest E2E images only (backtestapp, backtestui, appinit)

set -eu

# Parallel builds use bash job control; re-exec under bash when needed.
if [ -z "${BASH_VERSION:-}" ] && [ "${_BUILD_IMAGES_BASH:-0}" != "1" ]; then
  if command -v bash >/dev/null 2>&1; then
    _BUILD_IMAGES_BASH=1 exec bash "$0" "$@"
  fi
fi

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/copy_shared.sh"

PROFILE="full"
PARALLEL=""
REGISTRY="${DOCKER_REGISTRY:-}"
PUSH_IMAGES="${PUSH_IMAGES:-0}"
FAIL=0

usage() {
  cat <<'EOF'
Usage: build-images.sh [options]

Options:
  --profile full|e2e   Image set to build (default: full)
  --parallel N         Build up to N images concurrently (default: 1 local, 4 in CI)
  --registry REGISTRY  Docker registry prefix (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/moneymaker)
  --push               Push images to registry after building (requires --registry)
  --help               Show this help

Profiles:
  full  All custom images for the full Swarm stack
  e2e   backtestapp, backtestui, appinit (BackTest E2E path)

Examples:
  ./scripts/build-images.sh
  ./scripts/build-images.sh --profile e2e --parallel 4
  ./scripts/build-images.sh --registry myregistry.io/moneymaker --push
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --profile)
      [ $# -ge 2 ] || { echo "ERROR: --profile requires full|e2e" >&2; exit 1; }
      PROFILE="$2"
      shift 2
      ;;
    --parallel)
      [ $# -ge 2 ] || { echo "ERROR: --parallel requires a number" >&2; exit 1; }
      PARALLEL="$2"
      shift 2
      ;;
    --registry)
      [ $# -ge 2 ] || { echo "ERROR: --registry requires a registry path" >&2; exit 1; }
      REGISTRY="$2"
      shift 2
      ;;
    --push)
      PUSH_IMAGES=1
      shift
      ;;
    # Accepted so build-all.sh can forward deploy-stack flags harmlessly
    --detach|--no-detach|--no-pull)
      shift
      ;;
    --compose)
      [ $# -ge 2 ] || { echo "ERROR: --compose requires a path" >&2; exit 1; }
      shift 2
      ;;
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

case "$PROFILE" in
  full|e2e) ;;
  *)
    echo "ERROR: --profile must be full or e2e (got: $PROFILE)" >&2
    exit 1
    ;;
esac

if [ -z "$PARALLEL" ]; then
  if [ "${CI:-}" = "true" ]; then
    PARALLEL=4
  else
    PARALLEL=1
  fi
fi

case "$PARALLEL" in
  ''|*[!0-9]*|0)
    echo "ERROR: --parallel must be a positive integer (got: $PARALLEL)" >&2
    exit 1
    ;;
esac

if [ "$PUSH_IMAGES" = "1" ] && [ -z "$REGISTRY" ]; then
  echo "ERROR: --push requires --registry to be set" >&2
  exit 1
fi

log() {
  printf '[build-images] %s\n' "$*"
}

# Job format: kind|context|tag
# kind: plain | kafka | strategy
JOBS=""

add_job() {
  JOBS="${JOBS}${JOBS:+
}$1|$2|$3"
}

run_one_job() {
  _kind="$1"
  _ctx="$2"
  _tag="$3"
  
  # If registry is set, tag with registry prefix
  if [ -n "$REGISTRY" ]; then
    _full_tag="${REGISTRY}/${_tag}"
  else
    _full_tag="$_tag"
  fi
  
  log "Building $_full_tag ($_kind: $_ctx)"
  case "$_kind" in
    plain)
      docker build -t "$_full_tag" "$_ctx"
      ;;
    kafka)
      build_kafka_service "$_ctx" "$_full_tag"
      ;;
    strategy)
      build_strategy "$_ctx" "$_full_tag"
      ;;
    *)
      echo "ERROR: unknown job kind: $_kind" >&2
      return 1
      ;;
  esac
  
  # Push to registry if requested
  if [ "$PUSH_IMAGES" = "1" ] && [ -n "$REGISTRY" ]; then
    log "Pushing $_full_tag"
    docker push "$_full_tag"
  fi
}

register_e2e_jobs() {
  add_job plain ./appInit appinit:latest
  add_job plain ./BackTest/BackTestApp backtestapp:latest
  add_job plain ./BackTest/BackTestUI backtestui:latest
}

register_full_jobs() {
  add_job plain ./appInit appinit:latest
  add_job plain ./MicroServices/UpstoxLogin upstock-login:latest
  add_job plain ./MicroServices/ConnectWS-Upstox connect-upstox-web-socket:latest

  add_job plain ./MicroServices/market-quote/getLTP get-ltp:latest
  add_job plain ./MicroServices/market-quote/getOHLC get-ohlc:latest
  add_job plain ./MicroServices/market-quote/fullMarketQuote get-fullmarketquote:latest
  add_job plain ./MicroServices/Orders/placeOrders placeorder:latest
  add_job plain ./MicroServices/Orders/getOrderBook get-orderbook:latest
  add_job plain ./MicroServices/Option-Chain/put-call-option-chain get-put-call-option-chain:latest
  add_job plain ./MicroServices/Option-Chain/option-contracts get-option-contracts:latest
  add_job plain ./MicroServices/Users/FundsAndMargin get-funds-and-margin:latest

  add_job kafka ./kafka/services/wsDataSplitterConsumer wsdatasplitterconsumer:latest
  add_job kafka ./kafka/services/storerConsumer storer-consumer:latest
  add_job kafka ./kafka/services/StrategyChooserConsumer strategy-chooser-consumer:latest
  add_job kafka ./kafka/services/positionTrackerConsumer position-tracker-consumer:latest
  add_job kafka ./kafka/services/deploymentSymbolResolverConsumer deployment-symbol-resolver-consumer:latest

  add_job plain ./BackTest/BacktestStreamer backteststreamer:latest
  add_job plain ./BackTest/BacktestClient backtestclient:latest
  add_job plain ./BackTest/BackTestApp backtestapp:latest
  add_job plain ./BackTest/BackTestUI backtestui:latest
  add_job plain ./ScheduledServices/ExportToFile exporttofile:latest

  add_job kafka ./kafka/services/streamToClient stream-to-client:latest

  add_job strategy ./kafka/services/Strategies/MSB msb-strategy:latest
  add_job strategy ./kafka/services/Strategies/msb_pts msb-pts-strategy:latest
  add_job strategy ./kafka/services/Strategies/liquidity_sweep liquidity-sweep-strategy:latest
}

if [ "$PROFILE" = "e2e" ]; then
  register_e2e_jobs
else
  register_full_jobs
fi

JOB_COUNT=0
OLD_IFS="$IFS"
IFS='
'
for _line in $JOBS; do
  [ -n "$_line" ] || continue
  JOB_COUNT=$((JOB_COUNT + 1))
done
IFS="$OLD_IFS"

log "Profile=$PROFILE parallel=$PARALLEL — queued $JOB_COUNT image build(s)"

PIDS=""
ACTIVE=0

flush_batch() {
  for _pid in $PIDS; do
    if ! wait "$_pid"; then
      FAIL=1
    fi
  done
  PIDS=""
  ACTIVE=0
}

OLD_IFS="$IFS"
IFS='
'
for _line in $JOBS; do
  [ -n "$_line" ] || continue
  _kind=$(printf '%s' "$_line" | cut -d'|' -f1)
  _ctx=$(printf '%s' "$_line" | cut -d'|' -f2)
  _tag=$(printf '%s' "$_line" | cut -d'|' -f3)

  if [ "$PARALLEL" -eq 1 ]; then
    if ! run_one_job "$_kind" "$_ctx" "$_tag"; then
      FAIL=1
      break
    fi
    continue
  fi

  (
    run_one_job "$_kind" "$_ctx" "$_tag"
  ) &
  PIDS="$PIDS $!"
  ACTIVE=$((ACTIVE + 1))
  if [ "$ACTIVE" -ge "$PARALLEL" ]; then
    flush_batch
    if [ "$FAIL" -ne 0 ]; then
      break
    fi
  fi
done
IFS="$OLD_IFS"

if [ -n "$PIDS" ]; then
  flush_batch
fi

if [ "$FAIL" -ne 0 ]; then
  log "ERROR: one or more image builds failed"
  exit 1
fi

log "All image builds completed (profile=$PROFILE)"
exit 0
