#!/bin/sh
# Template for future per-service test runners.
#
# Suite: <service-name>
# Test plan: test_case_plans/<plan>.md
# Prerequisites: docker services A, B, C (see docker-compose.yml)
# Automation: TBD (Playwright API / node:test / custom harness)
#
# Steps to enable a new suite:
#   1. Copy this file to run_<suite_id>_test_cases.sh
#   2. Implement the runner (call ensure_e2e_deps / run_playwright / custom harness)
#   3. Add or flip enabled=1 in scripts/test/suites.registry
#   4. Add e2e/<domain>/ specs when using Playwright
#
# Usage (once implemented):
#   ./scripts/test/run_<suite>_test_cases.sh [flags] [-- playwright-args...]

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd "$SCRIPT_DIR/../.." && pwd)"

. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/stack.sh"

die "Not implemented — enable in suites.registry when e2e/<service>/ (or equivalent harness) exists"
