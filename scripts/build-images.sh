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
#   full — all custom images used by the Kubernetes / compose stack (default)
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
FAIL=0

usage() {
  cat <<'EOF'
Usage: build-images.sh [options]

Options:
  --profile full|e2e   Image set to build (default: full)
  --parallel N         Build up to N images concurrently (default: 1 local, 4 in CI)
  --help               Show this help

Profiles:
  full  All custom images for the full Kubernetes stack
  e2e   backtestapp, backtestui, appinit (BackTest E2E path)

Examples:
  ./scripts/build-images.sh
  ./scripts/build-images.sh --profile e2e --parallel 4
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
    # Accepted so build-all.sh can forward deploy-k8s flags harmlessly
    --detach|--no-detach|--no-pull|--no-import)
      shift
      ;;
    --compose|--overlay)
      [ $# -ge 2 ] || { echo "ERROR: $1 requires a value" >&2; exit 1; }
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

log() {
  printf '[build-images] %s\n' "$*"
}

# Job format: kind|context|tag|extra
# kind: plain | kafka | strategy | microservice
# extra (microservice only): redis | auth | placeorder
JOBS=""

add_job() {
  JOBS="${JOBS}${JOBS:+
}$1|$2|$3|${4:-}"
}

run_one_job() {
  _kind="$1"
  _ctx="$2"
  _tag="$3"
  _extra="${4:-}"
  log "Building $_tag ($_kind: $_ctx${_extra:+ mode=$_extra})"
  case "$_kind" in
    plain)
      docker build -t "$_tag" "$_ctx"
      ;;
    kafka)
      build_kafka_service "$_ctx" "$_tag"
      ;;
    strategy)
      build_strategy "$_ctx" "$_tag"
      ;;
    microservice)
      build_microservice "$_ctx" "$_tag" "${_extra:-auth}"
      ;;
    *)
      echo "ERROR: unknown job kind: $_kind" >&2
      return 1
      ;;
  esac
}

register_e2e_jobs() {
  add_job plain ./appInit appinit:latest
  add_job plain ./BackTest/BackTestApp backtestapp:latest
  add_job plain ./BackTest/BackTestUI backtestui:latest
}

register_full_jobs() {
  add_job plain ./appInit appinit:latest
  # Microservices: bake compose bind-mounts into the image (required for k8s)
  add_job microservice ./MicroServices/UpstoxLogin upstock-login:latest redis
  add_job microservice ./MicroServices/ConnectWS-Upstox connect-upstox-web-socket:latest auth

  add_job microservice ./MicroServices/market-quote/getLTP get-ltp:latest auth
  add_job microservice ./MicroServices/market-quote/getOHLC get-ohlc:latest auth
  add_job microservice ./MicroServices/market-quote/fullMarketQuote get-fullmarketquote:latest auth
  add_job microservice ./MicroServices/Orders/placeOrders placeorder:latest placeorder
  add_job microservice ./MicroServices/Orders/getOrderBook get-orderbook:latest auth
  add_job microservice ./MicroServices/Option-Chain/put-call-option-chain get-put-call-option-chain:latest auth
  add_job microservice ./MicroServices/Option-Chain/option-contracts get-option-contracts:latest auth
  add_job microservice ./MicroServices/Users/FundsAndMargin get-funds-and-margin:latest auth

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
  _extra=$(printf '%s' "$_line" | cut -d'|' -f4)

  if [ "$PARALLEL" -eq 1 ]; then
    if ! run_one_job "$_kind" "$_ctx" "$_tag" "$_extra"; then
      FAIL=1
      break
    fi
    continue
  fi

  (
    run_one_job "$_kind" "$_ctx" "$_tag" "$_extra"
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
