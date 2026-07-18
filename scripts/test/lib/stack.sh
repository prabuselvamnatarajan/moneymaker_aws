#!/bin/sh
# Stack readiness helpers for MoneyMaker test runners. Source only.
# Requires scripts/test/lib/common.sh to be sourced first.
#
# Required services for BackTest suites (Docker Swarm stack "moneymaker"):
#   mongo1, mongo2, mongo3, redis, backtest-app, backtest-ui, reverse-proxy
# Note: the nginx reverse-proxy service is named "reverse-proxy" in docker-compose.yml.

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
  _health_url="${API_BASE_URL%/}/health"
  _max="${1:-60}"
  _delay="${2:-3}"
  _i=0

  log_info "Waiting for BackTestApp health at $_health_url"
  while [ "$_i" -lt "$_max" ]; do
    _body=$(curl -sf --max-time 5 "$_health_url" 2>/dev/null || true)
    case "$_body" in
      *'"status":"ok"'*|*'"status": "ok"'*)
        log_info "BackTestApp is healthy"
        return 0
        ;;
    esac
    _i=$((_i + 1))
    sleep "$_delay"
  done
  return 1
}

# Poll GET $UI_BASE_URL until HTTP 200.
wait_for_backtest_ui() {
  wait_for_url "${UI_BASE_URL}" "${1:-60}" "${2:-3}"
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
        die "BackTestApp not reachable at ${API_BASE_URL}/health — start the Swarm stack (./build-all.sh) or use --no-wait"
      fi
      ;;
    ui)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at ${API_BASE_URL}/health — UI tests require the API behind reverse-proxy"
      fi
      if ! wait_for_backtest_ui; then
        die "BackTestUI not reachable at ${UI_BASE_URL} — ensure reverse-proxy + backtest-ui are running"
      fi
      ;;
    all|*)
      if ! wait_for_backtest_app; then
        die "BackTestApp not reachable at ${API_BASE_URL}/health — start the Swarm stack (./build-all.sh) or use --no-wait"
      fi
      if ! wait_for_backtest_ui; then
        log_warn "BackTestUI not reachable at ${UI_BASE_URL} — UI suite may fail"
      fi
      ;;
  esac
}
