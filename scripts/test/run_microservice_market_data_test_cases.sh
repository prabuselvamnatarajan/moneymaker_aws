#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/MicroServices/market-quote/getLTP" && npm test "$@"
cd "$ROOT/MicroServices/market-quote/getOHLC" && npm test "$@"
cd "$ROOT/MicroServices/market-quote/fullMarketQuote" && npm test "$@"
