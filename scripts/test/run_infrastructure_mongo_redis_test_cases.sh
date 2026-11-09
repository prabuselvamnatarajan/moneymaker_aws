#!/bin/sh
# Run Mongo Express and RedisInsight Infrastructure Reachability & Manifest tests.
# Test plan: test_case_plans/infrastructure-mongo-redis.md (TC-DB-006, TC-DB-008)
#
# Usage:
#   ./scripts/test/run_infrastructure_mongo_redis_test_cases.sh
#   ./scripts/test/run_infrastructure_mongo_redis_test_cases.sh --manifest-only
#   ./scripts/test/run_infrastructure_mongo_redis_test_cases.sh --live-only
#   ./scripts/test/run_infrastructure_mongo_redis_test_cases.sh --host algo.mrcobra.link
#
# Tests:
#   1. TC-INFRA-MANIFEST-001: K8s dev overlay patches mongo-express & redisinsight to LoadBalancer
#   2. TC-INFRA-MANIFEST-002: Base definitions configure ports 8081 (mongo-express) & 8001 (redisinsight)
#   3. TC-DB-006: Mongo Express HTTP reachability on port 8081 (HTTP 401 basic auth or 200 authenticated)
#   4. TC-DB-008: RedisInsight HTTP reachability on port 8001 (HTTP 200)
#   5. TC-INFRA-K8S-001: Live cluster service verification (when kubectl is available)

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd "$SCRIPT_DIR/../.." && pwd)"

. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/stack.sh"

TARGET_HOST="${TARGET_HOST:-algo.mrcobra.link}"
RUN_MANIFEST=1
RUN_LIVE=1
LIVE_ONLY=0
FAILED=0

usage() {
  cat <<'EOF'
Usage: run_infrastructure_mongo_redis_test_cases.sh [options]

Options:
  --manifest-only    Run only K8s manifest validation tests
  --live-only        Run only live HTTP/cluster endpoint reachability tests
  --host HOSTNAME    Host to test (default: algo.mrcobra.link)
  --help             Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --no-install)
      # No npm deps needed for this suite
      shift
      ;;
    --no-wait)
      shift
      ;;
    --manifest-only)
      RUN_MANIFEST=1
      RUN_LIVE=0
      shift
      ;;
    --live-only)
      RUN_MANIFEST=0
      RUN_LIVE=1
      LIVE_ONLY=1
      shift
      ;;
    --host)
      [ $# -ge 2 ] || { log_err "--host requires a value"; exit 1; }
      TARGET_HOST="$2"
      shift 2
      ;;
    *)
      log_err "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

test_pass() {
  printf '  \033[32m✔ PASS\033[0m: %s\n' "$1"
}

test_fail() {
  printf '  \033[31m✘ FAIL\033[0m: %s\n' "$1"
  FAILED=$((FAILED + 1))
}

test_warn() {
  printf '  \033[33m⚠ WARN\033[0m: %s\n' "$1"
}

# ---------------------------------------------------------
# Part 1: Manifest Validation Tests
# ---------------------------------------------------------
if [ "$RUN_MANIFEST" -eq 1 ]; then
  log_info "=== Running Manifest Validation Tests ==="

  # Test 1: dev overlay patches mongo-express & redisinsight to LoadBalancer
  DEV_KUST="$ROOT/k8s/overlays/dev/kustomization.yaml"
  if [ -f "$DEV_KUST" ]; then
    if grep -q "name: mongo-express" "$DEV_KUST" && \
       grep -q "name: redisinsight" "$DEV_KUST" && \
       grep -q "value: LoadBalancer" "$DEV_KUST"; then
      test_pass "TC-INFRA-MANIFEST-001: dev overlay patches mongo-express and redisinsight to LoadBalancer"
    else
      test_fail "TC-INFRA-MANIFEST-001: dev overlay missing LoadBalancer patch for mongo-express or redisinsight"
    fi
  else
    test_fail "TC-INFRA-MANIFEST-001: $DEV_KUST not found"
  fi

  # Test 2: Base manifests specify port 8081 for mongo-express and 8001 for redisinsight
  ME_YAML="$ROOT/k8s/base/scheduled/mongo-express.yaml"
  RI_YAML="$ROOT/k8s/base/scheduled/redisinsight.yaml"
  if [ -f "$ME_YAML" ] && grep -q "port: 8081" "$ME_YAML"; then
    test_pass "TC-INFRA-MANIFEST-002a: mongo-express.yaml exposes port 8081"
  else
    test_fail "TC-INFRA-MANIFEST-002a: mongo-express.yaml missing port 8081"
  fi

  if [ -f "$RI_YAML" ] && grep -q "port: 8001" "$RI_YAML"; then
    test_pass "TC-INFRA-MANIFEST-002b: redisinsight.yaml exposes port 8001"
  else
    test_fail "TC-INFRA-MANIFEST-002b: redisinsight.yaml missing port 8001"
  fi
fi

# ---------------------------------------------------------
# Part 2: Live Cluster & HTTP Endpoint Reachability Tests
# ---------------------------------------------------------
if [ "$RUN_LIVE" -eq 1 ]; then
  log_info "=== Running Live Endpoint Reachability Tests ==="

  # Test 3: K8s cluster service checks (if kubectl is reachable)
  ME_TYPE=""
  RI_TYPE=""
  ME_EXT=""
  if command -v kubectl >/dev/null 2>&1 && kubectl cluster-info >/dev/null 2>&1; then
    NS="${K8S_NAMESPACE:-moneymaker}"
    ME_TYPE=$(kubectl -n "$NS" get svc mongo-express -o jsonpath='{.spec.type}' 2>/dev/null || echo "")
    RI_TYPE=$(kubectl -n "$NS" get svc redisinsight -o jsonpath='{.spec.type}' 2>/dev/null || echo "")

    if [ "$ME_TYPE" = "LoadBalancer" ] && [ "$RI_TYPE" = "LoadBalancer" ]; then
      test_pass "TC-INFRA-K8S-001: Services mongo-express and redisinsight are configured as LoadBalancer in namespace $NS"
    elif [ -n "$ME_TYPE" ] && [ -n "$RI_TYPE" ]; then
      test_warn "TC-INFRA-K8S-001: Services exist but are type ($ME_TYPE, $RI_TYPE); if running on Minikube, LoadBalancer is required for minikube tunnel"
    else
      test_warn "TC-INFRA-K8S-001: mongo-express / redisinsight services not found in namespace $NS"
    fi

    # Check for external IP (127.0.0.1 tunnel binding)
    ME_EXT=$(kubectl -n "$NS" get svc mongo-express -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [ -n "$ME_EXT" ]; then
      test_pass "TC-INFRA-K8S-002: Service mongo-express has LoadBalancer external IP assigned ($ME_EXT)"
    else
      test_warn "TC-INFRA-K8S-002: Service mongo-express has no external IP yet (is 'minikube tunnel' running?)"
    fi
  else
    log_info "kubectl or cluster not available; skipping live K8s service inspection"
  fi

  # Helper to probe an HTTP endpoint
  # Args: host, port, path, auth_flag, expected_code
  probe_http() {
    _host="$1"
    _port="$2"
    _path="${3:-/}"
    _auth="${4:-}"
    _expected="$5"

    _url="http://${_host}:${_port}${_path}"
    if [ -n "$_auth" ]; then
      _code=$(curl -s -o /dev/null -w "%{http_code}" -u "$_auth" --max-time 5 "$_url" 2>/dev/null || echo "000")
    else
      _code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$_url" 2>/dev/null || echo "000")
    fi

    if [ "$_code" = "$_expected" ]; then
      return 0
    else
      return 1
    fi
  }

  # Check whether live reachability is expected to be accessible
  HAS_TUNNEL=0
  if [ "$ME_TYPE" = "LoadBalancer" ] && [ -n "$ME_EXT" ]; then
    HAS_TUNNEL=1
  fi

  # Test 4: Mongo Express on port 8081 (localhost)
  if probe_http "127.0.0.1" "8081" "/" "" "401"; then
    test_pass "TC-DB-006a: mongo-express reachable at 127.0.0.1:8081 (HTTP 401 Unauthorized basic-auth challenge)"
  elif probe_http "127.0.0.1" "8081" "/" "admin:pass" "200"; then
    test_pass "TC-DB-006a: mongo-express reachable at 127.0.0.1:8081 (HTTP 200 OK with admin:pass)"
  elif [ "$LIVE_ONLY" = "1" ] || [ "$HAS_TUNNEL" = "1" ]; then
    test_fail "TC-DB-006a: mongo-express NOT reachable at 127.0.0.1:8081 (check if minikube tunnel or port-forward is active)"
  else
    test_warn "TC-DB-006a: mongo-express not reachable at 127.0.0.1:8081 (services are type '${ME_TYPE:-ClusterIP}' without LoadBalancer external IP; requires 'minikube tunnel' or 'kubectl port-forward')"
  fi

  # Test 5: Mongo Express on port 8081 (TARGET_HOST)
  if probe_http "$TARGET_HOST" "8081" "/" "" "401"; then
    test_pass "TC-DB-006b: mongo-express reachable at ${TARGET_HOST}:8081 (HTTP 401 basic-auth challenge)"
  elif probe_http "$TARGET_HOST" "8081" "/" "admin:pass" "200"; then
    test_pass "TC-DB-006b: mongo-express reachable at ${TARGET_HOST}:8081 (HTTP 200 with admin:pass)"
  elif [ "$LIVE_ONLY" = "1" ] || [ "$HAS_TUNNEL" = "1" ]; then
    test_fail "TC-DB-006b: mongo-express NOT reachable at ${TARGET_HOST}:8081 (ensure ${TARGET_HOST} resolves to 127.0.0.1 in /etc/hosts)"
  else
    test_warn "TC-DB-006b: mongo-express not reachable at ${TARGET_HOST}:8081 (requires active tunnel or port-forward)"
  fi

  # Test 6: RedisInsight on port 8001 (localhost)
  if probe_http "127.0.0.1" "8001" "/" "" "200"; then
    test_pass "TC-DB-008a: redisinsight reachable at 127.0.0.1:8001 (HTTP 200 OK)"
  elif [ "$LIVE_ONLY" = "1" ] || [ "$HAS_TUNNEL" = "1" ]; then
    test_fail "TC-DB-008a: redisinsight NOT reachable at 127.0.0.1:8001 (check if minikube tunnel or port-forward is active)"
  else
    test_warn "TC-DB-008a: redisinsight not reachable at 127.0.0.1:8001 (services are type '${RI_TYPE:-ClusterIP}' without LoadBalancer external IP; requires 'minikube tunnel' or 'kubectl port-forward')"
  fi

  # Test 7: RedisInsight on port 8001 (TARGET_HOST)
  if probe_http "$TARGET_HOST" "8001" "/" "" "200"; then
    test_pass "TC-DB-008b: redisinsight reachable at ${TARGET_HOST}:8001 (HTTP 200 OK)"
  elif [ "$LIVE_ONLY" = "1" ] || [ "$HAS_TUNNEL" = "1" ]; then
    test_fail "TC-DB-008b: redisinsight NOT reachable at ${TARGET_HOST}:8001 (ensure ${TARGET_HOST} resolves to 127.0.0.1 in /etc/hosts)"
  else
    test_warn "TC-DB-008b: redisinsight not reachable at ${TARGET_HOST}:8001 (requires active tunnel or port-forward)"
  fi
fi

# ---------------------------------------------------------
# Summary
# ---------------------------------------------------------
if [ "$FAILED" -eq 0 ]; then
  log_info "All tests passed successfully!"
  exit 0
else
  log_err "$FAILED test(s) failed."
  exit 1
fi
