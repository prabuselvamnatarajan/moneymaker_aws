#!/bin/sh
# Run BackTestApp API Playwright tests (project=api).
# Test plans: test_case_plans/BackTestApp-*.md
# Prerequisites: mongo1/2/3, redis, backtest-app, reverse-proxy
#
# Usage:
#   ./scripts/test/run_backtest_app_test_cases.sh
#   ./scripts/test/run_backtest_app_test_cases.sh --no-wait
#   ./scripts/test/run_backtest_app_test_cases.sh --grep TC-ACC-001
#   ./scripts/test/run_backtest_app_test_cases.sh --with-slow
#   ./scripts/test/run_backtest_app_test_cases.sh --with-secrets-audit
#   ./scripts/test/run_backtest_app_test_cases.sh backtest-app/iam-auth.spec.ts
#   ./scripts/test/run_backtest_app_test_cases.sh -- --reporter=list

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd "$SCRIPT_DIR/../.." && pwd)"

. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/stack.sh"

SHOW_REPORT=0
EXTRA_PW_ARGS=""

usage() {
  cat <<'EOF'
Usage: run_backtest_app_test_cases.sh [options] [spec-files...] [-- playwright-args...]

Options:
  --no-install           Skip npm ci / playwright install
  --no-wait              Skip stack health checks
  --grep PATTERN         Filter tests by title (Playwright -g)
  --with-slow            Also run @slow project
  --with-secrets-audit   Also run api-no-secrets project (needs API_NO_SECRETS_BASE_URL)
  --report               Open HTML report after run
  --help                 Show this help

Environment:
  API_BASE_URL           Default: http://localhost/backtestapp
  BACKTEST_SERVICE_TOKEN Default: backtest-internal-service-token
  API_NO_SECRETS_BASE_URL  Required for --with-secrets-audit
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --no-install)
      NO_INSTALL=1
      shift
      ;;
    --no-wait)
      NO_WAIT=1
      shift
      ;;
    --with-slow)
      WITH_SLOW=1
      shift
      ;;
    --with-secrets-audit)
      WITH_SECRETS_AUDIT=1
      shift
      ;;
    --report)
      SHOW_REPORT=1
      shift
      ;;
    --grep)
      [ $# -ge 2 ] || die "--grep requires a pattern"
      GREP_PATTERN="$2"
      shift 2
      ;;
    --)
      shift
      EXTRA_PW_ARGS="$*"
      break
      ;;
    -*)
      die "Unknown option: $1 (use --help)"
      ;;
    *)
      # Spec file or path relative to e2e/
      EXTRA_PW_ARGS="$EXTRA_PW_ARGS $1"
      shift
      ;;
  esac
done

ensure_stack_ready api
ensure_e2e_deps

PW_ARGS="--project=api"

if [ "$WITH_SLOW" = "1" ]; then
  PW_ARGS="$PW_ARGS --project=slow"
fi

if [ "$WITH_SECRETS_AUDIT" = "1" ]; then
  if [ -z "${API_NO_SECRETS_BASE_URL:-}" ]; then
    log_warn "--with-secrets-audit set but API_NO_SECRETS_BASE_URL is empty; api-no-secrets may be skipped/fail"
  fi
  PW_ARGS="$PW_ARGS --project=api-no-secrets"
fi

if [ -n "$GREP_PATTERN" ]; then
  PW_ARGS="$PW_ARGS -g $GREP_PATTERN"
fi

# shellcheck disable=SC2086
set -- $PW_ARGS $EXTRA_PW_ARGS

log_info "=== BackTestApp test suite (Playwright project=api) ==="
if run_playwright "$@"; then
  STATUS=0
  log_info "BackTestApp suite PASSED"
else
  STATUS=$?
  log_err "BackTestApp suite FAILED (exit $STATUS)"
fi

if [ "$SHOW_REPORT" = "1" ]; then
  (
    cd "$E2E_DIR" || exit 1
    npx playwright show-report
  ) || true
fi

exit "$STATUS"
