#!/bin/sh
# MoneyMaker — run all enabled (or selected) automated test suites.
#
# Usage:
#   ./run_all_test_cases.sh                          # all enabled suites
#   ./run_all_test_cases.sh --suite backtest-app     # one suite
#   ./run_all_test_cases.sh --suite backtest-ui
#   ./run_all_test_cases.sh --suite backtest-app,backtest-ui
#   ./run_all_test_cases.sh --build                  # build-all.sh first
#   ./run_all_test_cases.sh --no-wait                # skip health polling
#   ./run_all_test_cases.sh --coverage               # check-coverage after tests
#   ./run_all_test_cases.sh --list                   # show registry
#   ./run_all_test_cases.sh --suite backtest-ui -- --headed
#   ./run_all_test_cases.sh --help

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

. "$ROOT/scripts/test/lib/common.sh"
. "$ROOT/scripts/test/lib/stack.sh"

SUITE_FILTER=""
LIST_ONLY=0
PASSTHROUGH=""

usage() {
  cat <<'EOF'
Usage: run_all_test_cases.sh [options] [-- suite-script-args...]

Options:
  --suite ID[,ID...]   Run only these suite ids (from suites.registry)
  --build              Run ./build-all.sh before tests (images + stack deploy)
  --no-install         Skip npm ci / playwright install in suite runners
  --no-wait            Skip stack health checks
  --coverage           Run e2e TC coverage check after suites
  --list               List suites in suites.registry and exit
  --help               Show this help

Examples:
  ./run_all_test_cases.sh
  ./run_all_test_cases.sh --suite backtest-ui
  ./run_all_test_cases.sh --suite backtest-app --coverage
  ./run_all_test_cases.sh --suite backtest-ui -- --headed
  ./run_all_test_cases.sh --suite backtest-app -- --grep TC-ACC-001

Suite registry: scripts/test/suites.registry
EOF
}

list_suites() {
  printf '%-32s %-8s %s\n' "SUITE_ID" "ENABLED" "DESCRIPTION"
  printf '%-32s %-8s %s\n' "--------" "-------" "-----------"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    suite_id=$(printf '%s' "$line" | cut -d'|' -f1)
    enabled=$(printf '%s' "$line" | cut -d'|' -f3)
    desc=$(printf '%s' "$line" | cut -d'|' -f4-)
    printf '%-32s %-8s %s\n' "$suite_id" "$enabled" "$desc"
  done < "$SUITES_REGISTRY"
}

# Returns 0 if suite_id is in comma-separated SUITE_FILTER (or filter empty = all)
suite_selected() {
  _id="$1"
  if [ -z "$SUITE_FILTER" ]; then
    return 0
  fi
  _IFS="$IFS"
  IFS=','
  for _s in $SUITE_FILTER; do
    IFS="$_IFS"
    if [ "$_s" = "$_id" ]; then
      return 0
    fi
  done
  IFS="$_IFS"
  return 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --suite)
      [ $# -ge 2 ] || die "--suite requires a suite id (or comma-separated list)"
      SUITE_FILTER="$2"
      shift 2
      ;;
    --build)
      DO_BUILD=1
      shift
      ;;
    --no-install)
      NO_INSTALL=1
      shift
      ;;
    --no-wait)
      NO_WAIT=1
      shift
      ;;
    --coverage)
      RUN_COVERAGE=1
      shift
      ;;
    --)
      shift
      PASSTHROUGH="$*"
      break
      ;;
    *)
      die "Unknown option: $1 (use --help)"
      ;;
  esac
done

[ -f "$SUITES_REGISTRY" ] || die "Suite registry not found: $SUITES_REGISTRY"

if [ "$LIST_ONLY" = "1" ]; then
  list_suites
  exit 0
fi

if [ "$DO_BUILD" = "1" ]; then
  log_info "Running ./build-all.sh (images + Swarm stack deploy)"
  "$ROOT/build-all.sh" || die "build-all.sh failed"
fi

# Install npm deps once; suite scripts get --no-install to skip npm reinstall.
# UI runner still calls ensure_playwright_browsers (installs chromium if missing).
ensure_e2e_deps
export NO_INSTALL=1

ensure_stack_ready all

PASSED=""
FAILED=""
SKIPPED=""
RAN_ANY=0

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
  esac

  suite_id=$(printf '%s' "$line" | cut -d'|' -f1)
  script=$(printf '%s' "$line" | cut -d'|' -f2)
  enabled=$(printf '%s' "$line" | cut -d'|' -f3)
  desc=$(printf '%s' "$line" | cut -d'|' -f4-)

  if ! suite_selected "$suite_id"; then
    continue
  fi

  # Explicit --suite can target a disabled future suite (will fail if script missing/stub)
  if [ -z "$SUITE_FILTER" ] && [ "$enabled" != "1" ]; then
    continue
  fi

  script_path="$TEST_SCRIPTS_DIR/$script"
  if [ ! -f "$script_path" ]; then
    log_warn "Suite $suite_id: script missing ($script) — skipping"
    SKIPPED="$SKIPPED $suite_id"
    continue
  fi

  if [ ! -x "$script_path" ]; then
    chmod +x "$script_path" 2>/dev/null || true
  fi

  RAN_ANY=1
  log_info "------------------------------------------------------------"
  log_info "Running suite: $suite_id — $desc"
  log_info "------------------------------------------------------------"

  # Forward NO_WAIT and passthrough args to suite script
  suite_args="--no-install"
  if [ "$NO_WAIT" = "1" ]; then
    suite_args="$suite_args --no-wait"
  fi

  # shellcheck disable=SC2086
  if "$script_path" $suite_args $PASSTHROUGH; then
    PASSED="$PASSED $suite_id"
    log_info "Suite $suite_id: PASSED"
  else
    FAILED="$FAILED $suite_id"
    log_err "Suite $suite_id: FAILED"
  fi
done < "$SUITES_REGISTRY"

if [ "$RAN_ANY" = "0" ]; then
  if [ -n "$SUITE_FILTER" ]; then
    die "No matching suites for --suite $SUITE_FILTER (use --list)"
  fi
  die "No enabled suites found in $SUITES_REGISTRY"
fi

if [ "$RUN_COVERAGE" = "1" ]; then
  log_info "------------------------------------------------------------"
  if run_coverage_check; then
    log_info "Coverage check PASSED"
  else
    FAILED="$FAILED coverage"
    log_err "Coverage check FAILED"
  fi
fi

log_info "==================== SUMMARY ===================="
[ -n "$PASSED" ] && log_info "PASSED: $PASSED"
[ -n "$FAILED" ] && log_err "FAILED: $FAILED"
[ -n "$SKIPPED" ] && log_warn "SKIPPED: $SKIPPED"
log_info "================================================="

if [ -n "$FAILED" ]; then
  exit 1
fi
exit 0
