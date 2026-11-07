#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/kafka/services/positionTrackerConsumer"
npm test "$@"
