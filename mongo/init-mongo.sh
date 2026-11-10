#!/bin/bash
set -e

echo "Preparing keyfile..."
cp -f /etc/mongo-keyfile /data/keyfile || { rm -f /data/keyfile && cp /etc/mongo-keyfile /data/keyfile; }
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

stop_mongod_and_wait() {
  echo "Stopping mongod..."
  mongod --shutdown --dbpath /data/db || true
  local waited=0
  while pgrep -x mongod >/dev/null 2>&1 && [ "$waited" -lt 30 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if pgrep -x mongod >/dev/null 2>&1; then
    echo "mongod did not exit cleanly after shutdown, sending SIGKILL..."
    pkill -9 -x mongod || true
    sleep 1
  fi
  rm -f /data/db/mongod.lock
}

# Returns 0 when this node has a valid replica-set config (setName present).
mongo_rs_configured() {
  mongosh --quiet --eval '
    try {
      var h = db.hello();
      if (h && h.setName) quit(0);
      quit(1);
    } catch (e) {
      quit(1);
    }
  ' >/dev/null 2>&1
}

# Stale /init-signal/done + wiped data must re-wait for mongo1 bootstrap.
if [ -f /init-signal/done ]; then
  echo "Init signal present — validating replica set before skipping bootstrap..."
  mongod --config /etc/mongod.conf --fork --logpath /tmp/mongod-probe.log
  until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
    sleep 1
  done
  if mongo_rs_configured; then
    echo "Replica set OK — starting with auth..."
    stop_mongod_and_wait
    exec mongod --config /etc/mongod.conf
  fi
  echo "Stale init signal (no replica set config) — clearing and waiting for re-bootstrap..."
  stop_mongod_and_wait
  stale_mtime="$(stat -c %Y /init-signal/done 2>/dev/null || true)"
fi

echo "Starting MongoDB WITHOUT auth for bootstrap (secondary)..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "Waiting for bootstrap signal from mongo1..."
while true; do
  if [ -f /init-signal/done ]; then
    now_mtime="$(stat -c %Y /init-signal/done 2>/dev/null || true)"
    if [ -z "${stale_mtime:-}" ] || [ "$now_mtime" != "$stale_mtime" ]; then
      break
    fi
  fi
  echo "  ...waiting for signal..."
  sleep 2
done

echo "Signal received, restarting with auth + keyfile..."
stop_mongod_and_wait

exec mongod --config /etc/mongod.conf
