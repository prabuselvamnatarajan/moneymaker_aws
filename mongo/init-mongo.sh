#!/bin/bash
set -e

echo "Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

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
    mongod --shutdown --dbpath /data/db || true
    sleep 1
    exec mongod --config /etc/mongod.conf
  fi
  echo "Stale init signal (no replica set config) — clearing and waiting for re-bootstrap..."
  mongod --shutdown --dbpath /data/db || true
  sleep 1
  rm -f /init-signal/done
fi

echo "Starting MongoDB WITHOUT auth for bootstrap (secondary)..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "Waiting for bootstrap signal from mongo1..."
until [ -f /init-signal/done ]; do
  echo "  ...waiting for signal..."
  sleep 2
done

echo "Signal received, restarting with auth + keyfile..."
mongod --shutdown --dbpath /data/db || true
sleep 2

exec mongod --config /etc/mongod.conf
