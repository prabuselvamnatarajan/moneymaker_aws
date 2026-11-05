#!/bin/sh
# Build MoneyMaker Docker images. Deploy is ./scripts/deploy-k8s.sh.
#
# Usage:
#   ./scripts/build-images.sh
#   ./scripts/build-images.sh --profile e2e
#   ./scripts/build-images.sh --profile full --parallel 4
#   ./scripts/build-images.sh --help
#
# Profiles:
#   full — all custom images used by the Kubernetes stack (default)
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
. "$ROOT/scripts/lib/image-tag.sh"
. "$ROOT/scripts/lib/dockerhub.sh"

PROFILE="full"
PARALLEL=""
REGISTRY=""
IMAGE_TAG="latest"
DO_PUSH=0
PUSH_ONLY=0
FAIL=0

usage() {
  cat <<'EOF'
Usage: build-images.sh [options]

Options:
  --profile full|e2e   Image set to build (default: full)
  --parallel N         Build up to N images concurrently (default: 1 local, 4 in CI)
  --registry NAME      Docker registry prefix (e.g. prabuselvamnatarajan)
  --tag TAG            Docker image tag when using --registry (default: latest)
  --push               Push tagged images after every build in this run succeeds
  --push-only          Push registry tags already present locally; do not build
  --help               Show this help

Profiles:
  full  All custom images for the full Kubernetes stack
  e2e   backtestapp, backtestui, appinit (BackTest E2E path)

Examples:
  ./scripts/build-images.sh
  ./scripts/build-images.sh --profile e2e --parallel 4
  ./scripts/build-images.sh --profile full --registry prabuselvamnatarajan --tag latest --push
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
      [ $# -ge 2 ] || { echo "ERROR: --registry requires a value" >&2; exit 1; }
      REGISTRY="$2"
      shift 2
      ;;
    --tag)
      [ $# -ge 2 ] || { echo "ERROR: --tag requires a value" >&2; exit 1; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --push)
      DO_PUSH=1
      shift
      ;;
    --push-only)
      PUSH_ONLY=1
      shift
      ;;
    # Accepted so build-all.sh can forward deploy-k8s flags harmlessly
    --detach|--no-detach|--no-pull|--no-import)
      shift
      ;;
    --overlay)
      [ $# -ge 2 ] || { echo "ERROR: --overlay requires a value" >&2; exit 1; }
      shift 2
      ;;
    --compose)
      echo "ERROR: Docker Swarm compose deploy was removed. Use --overlay ci or --overlay full with ./scripts/deploy-k8s.sh." >&2
      exit 1
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

if [ "$DO_PUSH" -eq 1 ] && [ "$PUSH_ONLY" -eq 1 ]; then
  echo "ERROR: use either --push or --push-only" >&2
  exit 1
fi

if [ "$DO_PUSH" -eq 1 ] && [ -z "$REGISTRY" ]; then
  echo "ERROR: --push requires --registry" >&2
  exit 1
fi

if [ "$PUSH_ONLY" -eq 1 ] && [ -z "$REGISTRY" ]; then
  echo "ERROR: --push-only requires --registry" >&2
  exit 1
fi

if [ -n "$REGISTRY" ]; then
  validate_image_tag "$IMAGE_TAG" "image tag"
fi

# Filled only when --push is set. Each successful build writes one file.
# Pushes run after every build succeeds, so a failed image is not published.
PUSH_DIR=""
if [ "$DO_PUSH" -eq 1 ]; then
  PUSH_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mm-image-push.XXXXXX")
fi

log() {
  printf '[build-images] %s\n' "$*"
}

# Job format: kind|context|tag|extra
# kind: plain | appinit | kafka | strategy | microservice
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
    appinit)
      build_appinit "$_ctx" "$_tag"
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

  if [ -n "$REGISTRY" ]; then
    _base_name=$(printf '%s' "$_tag" | cut -d: -f1)
    _remote_tag="$REGISTRY/$_base_name:$IMAGE_TAG"
    log "Tagging $_tag -> $_remote_tag"
    docker tag "$_tag" "$_remote_tag"
    if [ "$DO_PUSH" -eq 1 ]; then
      printf '%s\n' "$_remote_tag" > "$PUSH_DIR/$_base_name"
    fi
  fi
}

register_e2e_jobs() {
  add_job appinit ./appInit appinit:latest
  add_job plain ./BackTest/BackTestApp backtestapp:latest
  add_job plain ./BackTest/BackTestUI backtestui:latest
}

register_full_jobs() {
  add_job appinit ./appInit appinit:latest
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

# appinit's Docker context is the repo root. Other jobs copy and delete bake
# files inside that tree, so appinit runs only after those jobs finish.
OTHER_JOBS=""
APPINIT_JOBS=""
OLD_IFS="$IFS"
IFS='
'
for _line in $JOBS; do
  [ -n "$_line" ] || continue
  _kind=$(printf '%s' "$_line" | cut -d'|' -f1)
  if [ "$_kind" = "appinit" ]; then
    APPINIT_JOBS="${APPINIT_JOBS}${APPINIT_JOBS:+
}${_line}"
  else
    OTHER_JOBS="${OTHER_JOBS}${OTHER_JOBS:+
}${_line}"
  fi
done
IFS="$OLD_IFS"

PIDS=""
ACTIVE=0

flush_batch() {
  _save_ifs="$IFS"
  IFS=' '
  for _pid in $PIDS; do
    [ -n "$_pid" ] || continue
    if ! wait "$_pid"; then
      FAIL=1
    fi
  done
  IFS="$_save_ifs"
  PIDS=""
  ACTIVE=0
}

run_job_list() {
  _list="$1"
  PIDS=""
  ACTIVE=0
  _save_ifs="$IFS"
  IFS='
'
  for _line in $_list; do
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
      # Do not inherit an EXIT trap that would delete PUSH_DIR.
      trap - EXIT
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
  IFS="$_save_ifs"

  if [ -n "$PIDS" ]; then
    flush_batch
  fi
}

# Command substitutions inherit EXIT traps. Only the main shell may delete PUSH_DIR.
MAIN_BASHPID="${BASHPID:-$$}"
cleanup_push_dir() {
  [ "${BASHPID:-$$}" = "$MAIN_BASHPID" ] || return 0
  if [ -n "$PUSH_DIR" ]; then
    rm -rf "$PUSH_DIR"
    PUSH_DIR=""
  fi
}

trap 'cleanup_push_dir' EXIT

if [ "$PUSH_ONLY" -eq 1 ]; then
  _pushed=0
  PIDS=""
  ACTIVE=0
  _save_ifs="$IFS"
  IFS='
'
  _push_only_dir=$(mktemp -d "${TMPDIR:-/tmp}/mm-image-push-only.XXXXXX")
  for _line in $JOBS; do
    [ -n "$_line" ] || continue
    _tag=$(printf '%s' "$_line" | cut -d'|' -f3)
    _base=$(printf '%s' "$_tag" | cut -d: -f1)
    _remote="$REGISTRY/$_base:$IMAGE_TAG"
    if ! docker image inspect "$_remote" >/dev/null 2>&1; then
      if ! docker image inspect "$_tag" >/dev/null 2>&1; then
        echo "ERROR: missing local image $_remote (build it before --push-only)" >&2
        FAIL=1
        break
      fi
      log "Tagging $_tag -> $_remote"
      docker tag "$_tag" "$_remote"
    fi
    printf '%s\n' "$_remote" > "$_push_only_dir/$_base"
  done
  IFS="$_save_ifs"
  if [ "$FAIL" -eq 0 ]; then
    if [ -z "${DOCKERHUB_TOKEN:-}" ]; then
      if [ "${CI:-}" = "true" ]; then
        FAIL=1
        log "ERROR: DOCKERHUB_TOKEN is required in CI so pushed Hub repos stay public"
      else
        log "WARNING: DOCKERHUB_TOKEN unset; cannot ensure Hub repos are public"
      fi
    elif ! dockerhub_ensure_push_dir_public "$REGISTRY" "$_push_only_dir"; then
      FAIL=1
      log "ERROR: failed to ensure Docker Hub repositories are public"
    fi
  fi
  if [ "$FAIL" -eq 0 ]; then
    _save_ifs="$IFS"
    IFS='
'
    for _line in $JOBS; do
      [ -n "$_line" ] || continue
      _tag=$(printf '%s' "$_line" | cut -d'|' -f3)
      _base=$(printf '%s' "$_tag" | cut -d: -f1)
      _remote="$REGISTRY/$_base:$IMAGE_TAG"
      (
        trap - EXIT
        log "Pushing $_remote"
        _retry=0
        _max_retries=3
        while [ "$_retry" -lt "$_max_retries" ]; do
          if docker push "$_remote"; then
            break
          fi
          _retry=$((_retry + 1))
          if [ "$_retry" -lt "$_max_retries" ]; then
            log "WARN: Failed to push $_remote (attempt $_retry). Retrying in 5 seconds..."
            sleep 5
          else
            log "ERROR: Failed to push $_remote after $_max_retries attempts."
            exit 1
          fi
        done
      ) &
      PIDS="$PIDS $!"
      ACTIVE=$((ACTIVE + 1))
      _pushed=$((_pushed + 1))
      if [ "$ACTIVE" -ge "$PARALLEL" ]; then
        flush_batch
        if [ "$FAIL" -ne 0 ]; then
          break
        fi
      fi
    done
    IFS="$_save_ifs"
    if [ -n "$PIDS" ]; then
      flush_batch
    fi
  fi
  rm -rf "$_push_only_dir"
  if [ "$_pushed" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
    FAIL=1
    log "ERROR: --push-only found no images"
  fi
  if [ "$FAIL" -ne 0 ]; then
    log "ERROR: one or more image pushes failed"
    exit 1
  fi
  log "Pushed $_pushed image(s) to $REGISTRY:$IMAGE_TAG"
  exit 0
fi

run_job_list "$OTHER_JOBS"
if [ "$FAIL" -eq 0 ]; then
  run_job_list "$APPINIT_JOBS"
fi

if [ "$FAIL" -ne 0 ]; then
  cleanup_push_dir
  log "ERROR: one or more image builds failed"
  exit 1
fi

if [ "$DO_PUSH" -eq 1 ]; then
  # New Hub repos inherit the account default (often private). Make them
  # public before push so unit/e2e/deploy runners can pull without login.
  if [ -z "${DOCKERHUB_TOKEN:-}" ]; then
    if [ "${CI:-}" = "true" ]; then
      cleanup_push_dir
      log "ERROR: DOCKERHUB_TOKEN is required in CI so pushed Hub repos stay public"
      exit 1
    fi
    log "WARNING: DOCKERHUB_TOKEN unset; cannot ensure Hub repos are public"
  elif ! dockerhub_ensure_push_dir_public "$REGISTRY" "$PUSH_DIR"; then
    cleanup_push_dir
    log "ERROR: failed to ensure Docker Hub repositories are public"
    exit 1
  fi
  _pushed=0
  PIDS=""
  ACTIVE=0
  for _f in "$PUSH_DIR"/*; do
    [ -f "$_f" ] || continue
    _remote=$(cat "$_f")
    [ -n "$_remote" ] || continue
    (
      trap - EXIT
      log "Pushing $_remote"
      _retry=0
      _max_retries=3
      while [ "$_retry" -lt "$_max_retries" ]; do
        if docker push "$_remote"; then
          break
        fi
        _retry=$((_retry + 1))
        if [ "$_retry" -lt "$_max_retries" ]; then
          log "WARN: Failed to push $_remote (attempt $_retry). Retrying in 5 seconds..."
          sleep 5
        else
          log "ERROR: Failed to push $_remote after $_max_retries attempts."
          exit 1
        fi
      done
    ) &
    PIDS="$PIDS $!"
    ACTIVE=$((ACTIVE + 1))
    _pushed=$((_pushed + 1))
    if [ "$ACTIVE" -ge "$PARALLEL" ]; then
      flush_batch
      if [ "$FAIL" -ne 0 ]; then
        break
      fi
    fi
  done
  if [ -n "$PIDS" ]; then
    flush_batch
  fi
  if [ "$_pushed" -eq 0 ]; then
    FAIL=1
    log "ERROR: --push set but no images were tagged"
  fi
  if [ "$FAIL" -ne 0 ]; then
    cleanup_push_dir
    log "ERROR: one or more image pushes failed"
    exit 1
  fi
  log "Pushed $_pushed image(s) to $REGISTRY:$IMAGE_TAG"
fi

cleanup_push_dir
log "All image builds completed (profile=$PROFILE)"
exit 0
