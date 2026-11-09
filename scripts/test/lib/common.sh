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

# Ensure Node.js and npm are on PATH if nvm or default locations exist
if ! command -v node >/dev/null 2>&1; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null || true
  fi
  if ! command -v node >/dev/null 2>&1; then
    for _nvm_dir in "${HOME}/.nvm/versions/node"/*; do
      if [ -x "$_nvm_dir/bin/node" ]; then
        export PATH="$_nvm_dir/bin:$PATH"
      fi
    done
  fi
fi

E2E_DIR="${E2E_DIR:-$ROOT/e2e}"
TEST_SCRIPTS_DIR="${TEST_SCRIPTS_DIR:-$ROOT/scripts/test}"
SUITES_REGISTRY="${SUITES_REGISTRY:-$TEST_SCRIPTS_DIR/suites.registry}"

# Defaults matching e2e/playwright.config.ts
# Trailing slash required so Playwright relative paths stay under /backtestapp/
# Prefer 127.0.0.1 over localhost in CI — curl often resolves localhost to ::1 first,
# while some nginx configs only listen on IPv4.
if [ -z "${API_BASE_URL:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    _API_BASE="http://127.0.0.1/backtestapp"
  elif curl -k -sf --max-time 2 https://algo.mrcobra.link/backtestapp/health >/dev/null 2>&1; then
    _API_BASE="https://algo.mrcobra.link/backtestapp"
  else
    _API_BASE="http://localhost/backtestapp"
  fi
else
  _API_BASE="$API_BASE_URL"
fi
case "$_API_BASE" in
  */) export API_BASE_URL="$_API_BASE" ;;
  *)  export API_BASE_URL="${_API_BASE}/" ;;
esac
if [ -z "${UI_BASE_URL:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    _UI_BASE="http://127.0.0.1/backtest-ui/"
  elif curl -k -sf --max-time 2 https://algo.mrcobra.link/backtest-ui/ >/dev/null 2>&1; then
    _UI_BASE="https://algo.mrcobra.link/backtest-ui/"
  else
    _UI_BASE="http://localhost/backtest-ui/"
  fi
else
  _UI_BASE="$UI_BASE_URL"
fi
case "$_UI_BASE" in
  */) export UI_BASE_URL="$_UI_BASE" ;;
  *)  export UI_BASE_URL="${_UI_BASE}/" ;;
esac
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

# Install e2e npm packages when needed. Set NO_INSTALL=1 to skip.
# Does NOT install OS packages (that needs sudo). See ensure_playwright_browsers.
ensure_e2e_deps() {
  if [ "$NO_INSTALL" = "1" ]; then
    log_info "Skipping e2e dependency install (--no-install)"
    return 0
  fi

  [ -d "$E2E_DIR" ] || die "e2e directory not found: $E2E_DIR"
  [ -f "$E2E_DIR/package.json" ] || die "e2e/package.json not found"

  log_info "Ensuring e2e npm dependencies in $E2E_DIR"
  (
    cd "$E2E_DIR" || exit 1
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
    if ! npx playwright --version >/dev/null 2>&1; then
      die "Playwright not available after npm install"
    fi
  ) || die "Failed to install e2e npm dependencies"
}

# True if a Playwright chromium build is already cached.
_playwright_chromium_present() {
  [ -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ] || return 1
  ls -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium-* >/dev/null 2>&1
}

# Install Playwright browser binaries. Avoids --with-deps by default (sudo password hang).
# PLAYWRIGHT_WITH_DEPS=1 → npx playwright install --with-deps (CI/root only).
# Required for UI suite; not needed for API-only (request fixture).
ensure_playwright_browsers() {
  [ -d "$E2E_DIR" ] || die "e2e directory not found: $E2E_DIR"

  if _playwright_chromium_present; then
    log_info "Playwright chromium already present — skipping browser install"
    return 0
  fi

  if [ "$NO_INSTALL" = "1" ] && [ "${PLAYWRIGHT_WITH_DEPS:-0}" != "1" ]; then
    die "Playwright chromium not found and --no-install was set.
  Install once (interactive sudo for OS libs), then re-run:
    cd e2e && sudo npx playwright install-deps && npx playwright install chromium
  Or omit --no-install / set PLAYWRIGHT_WITH_DEPS=1 in CI.
  For API-only (no browser): ./run_all_test_cases.sh --suite backtest-app"
  fi

  log_info "Ensuring Playwright chromium in $E2E_DIR"
  (
    cd "$E2E_DIR" || exit 1
    if [ "${PLAYWRIGHT_WITH_DEPS:-0}" = "1" ]; then
      log_info "Installing browsers + system deps (PLAYWRIGHT_WITH_DEPS=1)"
      npx playwright install --with-deps chromium
    else
      # Browsers only — no sudo. Host libs may still be required at runtime.
      npx playwright install chromium
    fi
  ) || die "Playwright browser install failed.
  Fix once (interactive sudo), then re-run:
    cd e2e && sudo npx playwright install-deps && npx playwright install chromium
  Or in root/CI: PLAYWRIGHT_WITH_DEPS=1 ./run_all_test_cases.sh --suite backtest-ui
  For API-only tests (no browser): ./run_all_test_cases.sh --suite backtest-app"
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
