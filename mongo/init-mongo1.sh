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

# Stale /init-signal/done (e.g. after PVC wipe while hostPath signal remains) must
# not skip bootstrap — that leaves ReplicaSetNoPrimary and crashes app pods.
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
  echo "Stale init signal (no replica set config) — clearing and re-bootstrapping..."
  mongod --shutdown --dbpath /data/db || true
  sleep 1
  rm -f /init-signal/done
fi

echo "Starting MongoDB WITHOUT auth for bootstrap..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "Waiting for mongod to be ready..."
until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  sleep 1
done

echo "Waiting for mongo2 to be reachable..."
until mongosh --host mongo2 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo2 not ready, waiting..."
  sleep 2
done

echo "Waiting for mongo3 to be reachable..."
until mongosh --host mongo3 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo3 not ready, waiting..."
  sleep 2
done

# Bitnami-inspired: primary-only initiate, treat already-initialized as repairable
echo "Bootstrapping replica set..."
mongosh --quiet --eval '
  function forceDesiredConfig() {
    var cfg = {
      _id: "rs0",
      version: 1,
      members: [
        { _id: 0, host: "mongo1:27017", priority: 2 },
        { _id: 1, host: "mongo2:27017", priority: 1 },
        { _id: 2, host: "mongo3:27017", priority: 1 }
      ]
    };
    try {
      var cur = rs.conf();
      cfg.version = (cur.version || 1) + 1;
    } catch (e) {}
    return rs.reconfig(cfg, { force: true });
  }

  try {
    rs.initiate({
      _id: "rs0",
      members: [ { _id: 0, host: "mongo1:27017", priority: 2 } ]
    });
    print("rs.initiate(primary-only) ok");
  } catch (e) {
    if (String(e).indexOf("already initialized") >= 0 || (e.code === 23)) {
      print("Replica set already initialized — repairing config if needed");
      forceDesiredConfig();
    } else {
      throw e;
    }
  }

  var primary = false;
  for (var i = 0; i < 90; i++) {
    try {
      var h = db.hello();
      if (h.isWritablePrimary || h.primary) { primary = true; break; }
    } catch (e) {}
    sleep(2000);
  }
  if (!primary) {
    forceDesiredConfig();
    sleep(5000);
  }

  for (var j = 0; j < 60; j++) {
    try { if (db.hello().isWritablePrimary) break; } catch (e) {}
    sleep(2000);
  }

  function ensureMember(host) {
    var st = rs.status();
    var found = false;
    st.members.forEach(function(m) { if (m.name === host) found = true; });
    if (!found) { print("rs.add(" + host + ")"); rs.add(host); }
    else { print(host + " already a member"); }
  }

  if (db.hello().isWritablePrimary) {
    ensureMember("mongo2:27017");
    ensureMember("mongo3:27017");
  } else {
    forceDesiredConfig();
  }

  printjson(rs.status().members.map(function(m) { return { n: m.name, s: m.stateStr }; }));
'

echo "Creating root user..."
mongosh admin --quiet --eval '
  try {
    db.createUser({
      user: "root",
      pwd: "example",
      roles: [ { role: "root", db: "admin" } ]
    });
    print("root created");
  } catch (e) {
    print("createUser skipped:", e.codeName || e);
  }
'

echo "Stopping bootstrap mongod..."
mongod --shutdown --dbpath /data/db || true
sleep 2

# Only signal secondaries after we have a writable primary (best-effort check on last run).
echo "Writing signal for mongo2/mongo3..."
touch /init-signal/done

echo "Bootstrap complete. Restarting with auth + keyfile..."
exec mongod --config /etc/mongod.conf
