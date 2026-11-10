#!/bin/sh
# Stack readiness helpers for MoneyMaker test runners. Source only.
# Requires scripts/test/lib/common.sh to be sourced first.
#
# Required services for BackTest suites (Kubernetes namespace "moneymaker"):
#   mongo1, mongo2, mongo3, redis, backtest-app, backtest-ui, reverse-proxy
# Ingress / Traefik forwards host :80 to Service reverse-proxy.

api_health_url() {
  printf '%s/health' "${API_BASE_URL%/}"
}

stack_health_max_retries() {
  if [ -n "${STACK_HEALTH_MAX_RETRIES:-}" ]; then
    printf '%s' "$STACK_HEALTH_MAX_RETRIES"
  elif [ "${CI:-}" = "true" ]; then
    printf '%s' "120"
  else
    printf '%s' "60"
  fi
}

stack_health_delay_sec() {
  if [ -n "${STACK_HEALTH_DELAY_SEC:-}" ]; then
    printf '%s' "$STACK_HEALTH_DELAY_SEC"
  elif [ "${CI:-}" = "true" ]; then
    printf '%s' "5"
  else
    printf '%s' "3"
  fi
}

# Best-effort Kubernetes workload summary for CI debugging.
log_k8s_workload_state() {
  _workload="${1:-deployment/backtest-app}"
  _ns="${K8S_NAMESPACE:-moneymaker}"
  if ! command -v kubectl >/dev/null 2>&1; then
    log_warn "kubectl not available — skipping workload state dump"
    return 0
  fi
  if ! kubectl cluster-info >/dev/null 2>&1; then
    log_warn "Kubernetes cluster not reachable — skipping workload state dump"
    return 0
  fi
  log_info "Kubernetes state for $_ns/$_workload:"
  kubectl -n "$_ns" get "$_workload" -o wide 2>/dev/null || log_warn "Could not get $_workload"
  _app=$(printf '%s' "$_workload" | sed 's#.*/##')
  kubectl -n "$_ns" get pods -l "app=${_app}" -o wide 2>/dev/null || true
  kubectl -n "$_ns" describe "$_workload" 2>/dev/null | tail -40 || true
  # Prefer Deployment/StatefulSet name for logs via label app=
  kubectl -n "$_ns" logs -l "app=${_app}" --tail=20 2>/dev/null || true
}

# Older name for log_k8s_workload_state. Accepts a Swarm-style service label
# (moneymaker_backtest-app) and dumps the matching Deployment.
log_swarm_service_state() {
  _svc="${1:-moneymaker_backtest-app}"
  # Map Swarm service name moneymaker_backtest-app → deployment/backtest-app
  _name=$(printf '%s' "$_svc" | sed 's/^moneymaker_//')
  log_k8s_workload_state "deployment/${_name}"
}

# Wait until URL returns HTTP success (curl -sf).
# Args: url [max_retries] [delay_seconds]
wait_for_url() {
  _url="$1"
  _max="${2:-60}"
  _delay="${3:-3}"
  _i=0

  log_info "Waiting for $_url (max ${_max}x${_delay}s)"
  while [ "$_i" -lt "$_max" ]; do
    if curl -k -sf --max-time 5 "$_url" >/dev/null 2>&1; then
      log_info "Ready: $_url"
      return 0
    fi
    _i=$((_i + 1))
    sleep "$_delay"
  done
  return 1
}

# Probe health URL; prints status/body hints for CI debugging.
# Returns 0 when body contains status ok.
_probe_backtest_health() {
  _url="$1"
  _tmp="$(mktemp 2>/dev/null || echo /tmp/mm-health.$$)"
  _code=$(curl -k -sS -o "$_tmp" -w "%{http_code}" --max-time 5 "$_url" 2>/dev/null || echo "000")
  _body=$(cat "$_tmp" 2>/dev/null || true)
  rm -f "$_tmp" 2>/dev/null || true
  case "$_body" in
    *'"status":"ok"'*|*'"status": "ok"'*)
      return 0
      ;;
  esac
  # Stash last probe for periodic logs
  LAST_HEALTH_CODE="$_code"
  LAST_HEALTH_BODY=$(printf '%s' "$_body" | head -c 200)
  return 1
}

# Poll GET $API_BASE_URL/health until status is ok (mirrors e2e/global-setup.ts).
wait_for_backtest_app() {
  _health_url="$(api_health_url)"
  _max="${1:-$(stack_health_max_retries)}"
  _delay="${2:-$(stack_health_delay_sec)}"
  _i=0
  LAST_HEALTH_CODE=""
  LAST_HEALTH_BODY=""
  _ns="${K8S_NAMESPACE:-moneymaker}"

  log_info "Waiting for BackTestApp health at $_health_url (max ${_max}x${_delay}s)"
  while [ "$_i" -lt "$_max" ]; do
    if _probe_backtest_health "$_health_url"; then
      log_info "BackTestApp is healthy"
      return 0
    fi
    _i=$((_i + 1))
    if [ "${CI:-}" = "true" ] && [ $((_i % 12)) -eq 0 ]; then
      log_info "Still waiting for BackTestApp ($_i/${_max})... last_http=${LAST_HEALTH_CODE} body=${LAST_HEALTH_BODY}"
      log_k8s_workload_state "deployment/backtest-app"
      log_k8s_workload_state "deployment/reverse-proxy"
      # Bypass Ingress: curl from a throwaway pod on the cluster network
      if command -v kubectl >/dev/null 2>&1; then
        kubectl -n "$_ns" run "mm-health-probe-$$" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -- \
          -sS -m 5 "http://backtest-app/health" 2>/dev/null \
          | head -c 200 | sed 's/^/[test] direct cluster health: /' || true
        kubectl -n "$_ns" run "mm-proxy-probe-$$" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -- \
          -sS -m 5 "http://reverse-proxy/backtestapp/health" 2>/dev/null \
          | head -c 200 | sed 's/^/[test] via reverse-proxy in-cluster: /' || true
      fi
    fi
    sleep "$_delay"
  done
  log_info "Final probe http=${LAST_HEALTH_CODE} body=${LAST_HEALTH_BODY}"
  log_k8s_workload_state "deployment/backtest-app"
  log_k8s_workload_state "deployment/reverse-proxy"
  return 1
}

# Poll GET $UI_BASE_URL until HTTP 200.
wait_for_backtest_ui() {
  wait_for_url "${UI_BASE_URL}" "$(stack_health_max_retries)" "$(stack_health_delay_sec)"
}

# Ensure stack endpoints are reachable.
# If NO_WAIT=1, warn and continue without failing.
# Args: optional suite hint — "api" | "ui" | "all" (default all)
ensure_stack_ready() {
  _mode="${1:-all}"

  if [ "$NO_WAIT" = "1" ]; then
    log_warn "Skipping stack health checks (--no-wait)"
    return 0
  fi

  case "$_mode" in
    api)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at $(api_health_url) — start the Kubernetes stack (./build-all.sh) or use --no-wait"
      fi
      ;;
    ui)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at $(api_health_url) — UI tests require the API behind reverse-proxy"
      fi
      if ! wait_for_backtest_ui; then
        die "BackTestUI not reachable at ${UI_BASE_URL} — ensure Ingress + reverse-proxy + backtest-ui are running"
      fi
      ;;
    all|*)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at $(api_health_url) — start the Kubernetes stack (./build-all.sh) or use --no-wait"
      fi
      if ! wait_for_backtest_ui; then
        log_warn "BackTestUI not reachable at ${UI_BASE_URL} — UI suite may fail"
      fi
      ;;
  esac
}
