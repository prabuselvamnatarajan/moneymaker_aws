#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/kafka/services/Strategies/msb_pts"
npm test "$@"
