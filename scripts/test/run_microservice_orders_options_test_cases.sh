#!/bin/sh
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/MicroServices/Orders/getOrderBook" && npm test "$@"
cd "$ROOT/MicroServices/Option-Chain/put-call-option-chain" && npm test "$@"
cd "$ROOT/MicroServices/Option-Chain/option-contracts" && npm test "$@"
cd "$ROOT/MicroServices/Users/FundsAndMargin" && npm test "$@"
