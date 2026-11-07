#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/MicroServices/ConnectWS-Upstox"
npm test "$@"
