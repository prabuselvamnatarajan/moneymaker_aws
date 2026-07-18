#!/bin/sh
# Shared helpers for MoneyMaker test runners. Source only — do not execute.
# Usage: . "$(dirname "$0")/lib/common.sh"   (from scripts/test/*.sh)
#        . "$ROOT/scripts/test/lib/common.sh" (from repo-root scripts)

# Resolve repo root. Prefer caller-set ROOT; otherwise derive from $0 (invoking script).
if [ -z "${ROOT:-}" ]; then
  _caller_dir="$(CDPATH= cd "$(dirname "$0")" && pwd)"
  if [ -d "$_caller_dir/scripts/test" ]; then
    # Invoked from repo root (e.g. run_all_test_cases.sh)
    ROOT="$_caller_dir"
  elif [ -f "$_caller_dir/suites.registry" ]; then
    # Invoked from scripts/test/
    ROOT="$(CDPATH= cd "$_caller_dir/../.." && pwd)"
  elif [ -f "$_caller_dir/../suites.registry" ]; then
    # Invoked from scripts/test/lib/
    ROOT="$(CDPATH= cd "$_caller_dir/../../.." && pwd)"
  else
    ROOT="$(CDPATH= cd "$_caller_dir/../.." && pwd)"
  fi
fi

E2E_DIR="${E2E_DIR:-$ROOT/e2e}"
TEST_SCRIPTS_DIR="${TEST_SCRIPTS_DIR:-$ROOT/scripts/test}"
SUITES_REGISTRY="${SUITES_REGISTRY:-$TEST_SCRIPTS_DIR/suites.registry}"

# Defaults matching e2e/playwright.config.ts
export API_BASE_URL="${API_BASE_URL:-http://localhost/backtestapp}"
export UI_BASE_URL="${UI_BASE_URL:-http://localhost/backtest-ui/}"
export BACKTEST_SERVICE_TOKEN="${BACKTEST_SERVICE_TOKEN:-backtest-internal-service-token}"

# Shared flags (set by parse_common_flags or callers)
NO_INSTALL="${NO_INSTALL:-0}"
NO_WAIT="${NO_WAIT:-0}"
WITH_SLOW="${WITH_SLOW:-0}"
WITH_SECRETS_AUDIT="${WITH_SECRETS_AUDIT:-0}"
RUN_COVERAGE="${RUN_COVERAGE:-0}"
DO_BUILD="${DO_BUILD:-0}"
GREP_PATTERN="${GREP_PATTERN:-}"
HEADED="${HEADED:-0}"

log_info() {
  printf '[test] %s\n' "$*"
}

log_warn() {
  printf '[test] WARN: %s\n' "$*" >&2
}

log_err() {
  printf '[test] ERROR: %s\n' "$*" >&2
}

die() {
  log_err "$*"
  exit 1
}

test_root_dir() {
  printf '%s\n' "$ROOT"
}

# Install e2e npm deps + Playwright browsers when needed.
# Set NO_INSTALL=1 to skip.
ensure_e2e_deps() {
  if [ "$NO_INSTALL" = "1" ]; then
    log_info "Skipping e2e dependency install (--no-install)"
    return 0
  fi

  [ -d "$E2E_DIR" ] || die "e2e directory not found: $E2E_DIR"
  [ -f "$E2E_DIR/package.json" ] || die "e2e/package.json not found"

  log_info "Ensuring e2e dependencies in $E2E_DIR"
  (
    cd "$E2E_DIR" || exit 1
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi

    # Install browsers if chromium is missing (best-effort check)
    if ! npx playwright --version >/dev/null 2>&1; then
      die "Playwright not available after npm install"
    fi
    # Always ensure browsers; --with-deps is safe / idempotent for CI/dev
    npx playwright install --with-deps
  ) || die "Failed to install e2e dependencies"
}

# Run Playwright from e2e/. Remaining args are passed through.
run_playwright() {
  [ -d "$E2E_DIR" ] || die "e2e directory not found: $E2E_DIR"
  log_info "Running: npx playwright test $*"
  (
    cd "$E2E_DIR" || exit 1
    npx playwright test "$@"
  )
}

run_coverage_check() {
  [ -d "$E2E_DIR" ] || die "e2e directory not found: $E2E_DIR"
  log_info "Running TC coverage check"
  (
    cd "$E2E_DIR" || exit 1
    npm run check-coverage
  )
}

# Parse shared flags from "$@". Sets globals and leaves remaining args in COMMON_REMAINING.
# Callers should: eval "set -- $COMMON_REMAINING" after, or use the array carefully.
# POSIX: we rebuild a string of remaining args.
parse_common_flags() {
  COMMON_REMAINING=""
  while [ $# -gt 0 ]; do
    case "$1" in
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
      --coverage)
        RUN_COVERAGE=1
        shift
        ;;
      --build)
        DO_BUILD=1
        shift
        ;;
      --headed)
        HEADED=1
        shift
        ;;
      --grep)
        [ $# -ge 2 ] || die "--grep requires a pattern"
        GREP_PATTERN="$2"
        shift 2
        ;;
      --)
        shift
        while [ $# -gt 0 ]; do
          COMMON_REMAINING="$COMMON_REMAINING $(printf '%s' "$1" | sed "s/'/'\\\\''/g; s/^/'/; s/$/'/")"
          shift
        done
        break
        ;;
      *)
        COMMON_REMAINING="$COMMON_REMAINING $(printf '%s' "$1" | sed "s/'/'\\\\''/g; s/^/'/; s/$/'/")"
        shift
        ;;
    esac
  done
  # Trim leading space
  COMMON_REMAINING=$(printf '%s' "$COMMON_REMAINING" | sed 's/^ //')
}
