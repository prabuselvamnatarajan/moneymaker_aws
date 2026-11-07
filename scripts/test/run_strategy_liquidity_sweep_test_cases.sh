#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/kafka/services/Strategies/liquidity_sweep"
npm test "$@"
