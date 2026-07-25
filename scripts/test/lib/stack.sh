#!/bin/sh
# Stack readiness helpers for MoneyMaker test runners. Source only.
# Requires scripts/test/lib/common.sh to be sourced first.
#
# Required services for BackTest suites (Docker Swarm stack "moneymaker"):
#   mongo1, mongo2, mongo3, redis, backtest-app, backtest-ui, reverse-proxy
# Note: the nginx reverse-proxy service is named "reverse-proxy" in docker-compose.yml.

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

# Best-effort Swarm task summary for CI debugging.
log_swarm_service_state() {
  _service="${1:-moneymaker_backtest-app}"
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    log_warn "Docker Swarm is not active — skipping service state dump"
    return 0
  fi
  log_info "Swarm service state for $_service:"
  docker service ps "$_service" --no-trunc 2>/dev/null || log_warn "Could not inspect $_service"
  # Tail recent logs — especially useful for reverse-proxy nginx host-not-found exits
  docker service logs "$_service" --tail 20 2>/dev/null || true
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
    if curl -sf --max-time 5 "$_url" >/dev/null 2>&1; then
      log_info "Ready: $_url"
      return 0
    fi
    _i=$((_i + 1))
    sleep "$_delay"
  done
  return 1
}

# Poll GET $API_BASE_URL/health until status is ok (mirrors e2e/global-setup.ts).
wait_for_backtest_app() {
  _health_url="$(api_health_url)"
  _max="${1:-$(stack_health_max_retries)}"
  _delay="${2:-$(stack_health_delay_sec)}"
  _i=0

  log_info "Waiting for BackTestApp health at $_health_url (max ${_max}x${_delay}s)"
  while [ "$_i" -lt "$_max" ]; do
    _body=$(curl -sf --max-time 5 "$_health_url" 2>/dev/null || true)
    case "$_body" in
      *'"status":"ok"'*|*'"status": "ok"'*)
        log_info "BackTestApp is healthy"
        return 0
        ;;
    esac
    _i=$((_i + 1))
    if [ "${CI:-}" = "true" ] && [ $((_i % 12)) -eq 0 ]; then
      log_info "Still waiting for BackTestApp ($_i/${_max})..."
      log_swarm_service_state "moneymaker_backtest-app"
      log_swarm_service_state "moneymaker_reverse-proxy"
    fi
    sleep "$_delay"
  done
  log_swarm_service_state "moneymaker_backtest-app"
  log_swarm_service_state "moneymaker_reverse-proxy"
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
        die "BackTestApp not reachable at $(api_health_url) — start the Swarm stack (./build-all.sh) or use --no-wait"
      fi
      ;;
    ui)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at $(api_health_url) — UI tests require the API behind reverse-proxy"
      fi
      if ! wait_for_backtest_ui; then
        die "BackTestUI not reachable at ${UI_BASE_URL} — ensure reverse-proxy + backtest-ui are running"
      fi
      ;;
    all|*)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at $(api_health_url) — start the Swarm stack (./build-all.sh) or use --no-wait"
      fi
      if ! wait_for_backtest_ui; then
        log_warn "BackTestUI not reachable at ${UI_BASE_URL} — UI suite may fail"
      fi
      ;;
  esac
}
