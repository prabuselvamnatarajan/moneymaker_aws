#!/bin/sh
# Print a JSON array of image names whose package.json defines a real test script.
# Images whose test script is missing or is npm's "no test specified" placeholder are omitted.
set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

exec python3 - "$ROOT" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
pairs = [
    ("appinit", "appInit/package.json"),
    ("upstock-login", "MicroServices/UpstoxLogin/package.json"),
    ("connect-upstox-web-socket", "MicroServices/ConnectWS-Upstox/package.json"),
    ("get-ltp", "MicroServices/market-quote/getLTP/package.json"),
    ("get-ohlc", "MicroServices/market-quote/getOHLC/package.json"),
    ("get-fullmarketquote", "MicroServices/market-quote/fullMarketQuote/package.json"),
    ("placeorder", "MicroServices/Orders/placeOrders/package.json"),
    ("get-orderbook", "MicroServices/Orders/getOrderBook/package.json"),
    ("get-put-call-option-chain", "MicroServices/Option-Chain/put-call-option-chain/package.json"),
    ("get-option-contracts", "MicroServices/Option-Chain/option-contracts/package.json"),
    ("get-funds-and-margin", "MicroServices/Users/FundsAndMargin/package.json"),
    ("wsdatasplitterconsumer", "kafka/services/wsDataSplitterConsumer/package.json"),
    ("storer-consumer", "kafka/services/storerConsumer/package.json"),
    ("strategy-chooser-consumer", "kafka/services/StrategyChooserConsumer/package.json"),
    ("position-tracker-consumer", "kafka/services/positionTrackerConsumer/package.json"),
    ("deployment-symbol-resolver-consumer", "kafka/services/deploymentSymbolResolverConsumer/package.json"),
    ("backteststreamer", "BackTest/BacktestStreamer/package.json"),
    ("backtestclient", "BackTest/BacktestClient/package.json"),
    ("backtestapp", "BackTest/BackTestApp/package.json"),
    ("backtestui", "BackTest/BackTestUI/package.json"),
    ("exporttofile", "ScheduledServices/ExportToFile/package.json"),
    ("stream-to-client", "kafka/services/streamToClient/package.json"),
    ("msb-strategy", "kafka/services/Strategies/MSB/package.json"),
    ("msb-pts-strategy", "kafka/services/Strategies/msb_pts/package.json"),
    ("liquidity-sweep-strategy", "kafka/services/Strategies/liquidity_sweep/package.json"),
]

built = set(re.findall(r"^  add_job\s+\S+\s+\S+\s+([a-z0-9-]+):latest\b", (root / "scripts/build-images.sh").read_text(encoding="utf-8"), re.M))
known = {name for name, _rel in pairs}
if built != known:
    missing = sorted(built - known)
    extra = sorted(known - built)
    sys.stderr.write(f"ERROR: unit-test image map does not match build-images.sh (missing={missing} extra={extra})\n")
    sys.exit(1)

images = []
for name, rel in pairs:
    path = root / rel
    if not path.is_file():
        sys.stderr.write(f"ERROR: missing package.json for {name}: {path}\n")
        sys.exit(1)
    package = json.loads(path.read_text(encoding="utf-8"))
    test = (package.get("scripts") or {}).get("test")
    if not isinstance(test, str) or not test.strip():
        continue
    if "no test specified" in test:
        continue
    images.append(name)

if not images:
    sys.stderr.write("ERROR: no images have a real unit test script\n")
    sys.exit(1)

sys.stdout.write(json.dumps(images, separators=(",", ":")))
sys.stdout.write("\n")
PY
