#!/bin/sh
# Run BackTestUI browser Playwright tests (project=ui).
# Test plan: test_case_plans/BackTestUI.md
# Prerequisites: mongo1/2/3, redis, backtest-app, backtest-ui, reverse-proxy
# Note: UI tests require BackTestApp (API) healthy behind reverse-proxy.
#
# Usage:
#   ./scripts/test/run_backtest_ui_test_cases.sh
#   ./scripts/test/run_backtest_ui_test_cases.sh --headed
#   ./scripts/test/run_backtest_ui_test_cases.sh --grep TC-UI-024
#   ./scripts/test/run_backtest_ui_test_cases.sh backtest-ui/deploy-dialog.spec.ts
#   ./scripts/test/run_backtest_ui_test_cases.sh -- --debug

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd "$SCRIPT_DIR/../.." && pwd)"

. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/stack.sh"

SHOW_REPORT=0
EXTRA_PW_ARGS=""

usage() {
  cat <<'EOF'
Usage: run_backtest_ui_test_cases.sh [options] [spec-files...] [-- playwright-args...]

Options:
  --no-install     Skip npm ci / playwright install
  --no-wait        Skip stack health checks
  --grep PATTERN   Filter tests by title (Playwright -g)
  --headed         Run browser headed (visible)
  --report         Open HTML report after run
  --help           Show this help

Environment:
  UI_BASE_URL      Default: http://localhost/backtest-ui/
  API_BASE_URL     Default: http://localhost/backtestapp (required for login/data)
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
    --headed)
      HEADED=1
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
      EXTRA_PW_ARGS="$EXTRA_PW_ARGS $1"
      shift
      ;;
  esac
done

ensure_stack_ready ui
ensure_e2e_deps
ensure_playwright_browsers

PW_ARGS="--project=ui"

if [ "$HEADED" = "1" ]; then
  PW_ARGS="$PW_ARGS --headed"
fi

if [ -n "$GREP_PATTERN" ]; then
  PW_ARGS="$PW_ARGS -g $GREP_PATTERN"
fi

# shellcheck disable=SC2086
set -- $PW_ARGS $EXTRA_PW_ARGS

log_info "=== BackTestUI test suite (Playwright project=ui) ==="
if run_playwright "$@"; then
  STATUS=0
  log_info "BackTestUI suite PASSED"
else
  STATUS=$?
  log_err "BackTestUI suite FAILED (exit $STATUS)"
fi

if [ "$SHOW_REPORT" = "1" ]; then
  (
    cd "$E2E_DIR" || exit 1
    npx playwright show-report
  ) || true
fi

exit "$STATUS"
